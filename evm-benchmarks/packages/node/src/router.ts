// HTTP routing for the chain worker, independent of Durable Objects.
// `handle` does CORS and finds the chain; each chain is a `ChainHost` (one Durable Object in the worker, or an
// in-process object in tests) that authenticates, keeps its own single-use request nonces, and runs its ChainService.
import type { Hex } from 'viem'
import type { SerializedState } from 'webevm'
import { recoverSigner, SKEW_S } from './auth'
import type { Sql } from './sql'
import { ChainService, ServiceError } from './service'
import type { NodeConfig } from './node'
import type { CreateChainRequest } from './client'

/** A request as a chain sees it (plain data, so it crosses a Durable Object RPC boundary). */
export interface ChainRequest { method: string; url: string; body: string; ts: string; nonce: string; sig: string; ip: string }
/** A response as plain data; `handle` turns it into JSON with CORS headers. */
export interface Reply { status: number; body: unknown }
type RootInfo = { chainId: 'root'; admin: string; access: string; head: number }

/** What the router needs from a chain; a Durable Object stub of `ChainDO`, or a `ChainHost` itself. */
export interface ChainHandleLike {
  serve(r: ChainRequest): Promise<Reply>
  create(chainId: string, signer: string, dump: SerializedState, setup: [Hex, Hex]): Promise<Reply>
  rootInfo(): Promise<RootInfo | null>
}

export interface RouterDeps { chain(id: string): ChainHandleLike }

const ORIGINS = [/^https:\/\/mychain\.dev$/, /^https:\/\/aaronp\.github\.io$/, /^http:\/\/localhost(:\d+)?$/]

function cors(origin: string | null): Record<string, string> {
  if (!origin || !ORIGINS.some((o) => o.test(origin))) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-ts, x-nonce, x-sig',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

export async function handle(req: Request, deps: RouterDeps): Promise<Response> {
  const headers = cors(req.headers.get('origin'))
  const json = (r: Reply) => new Response(JSON.stringify(r.body), { status: r.status, headers: { ...headers, 'content-type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  const url = new URL(req.url)
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json({ status: 200, body: { ok: true, root: await deps.chain('root').rootInfo() } })
    // POST /chains goes to the root chain: it checks the code, then creates the new chain
    const id = url.pathname === '/chains' ? 'root' : url.pathname.match(/^\/chains\/([\w-]{1,64})(\/[\w-]*)?$/)?.[1]
    if (!id) return json({ status: 404, body: { error: 'not found' } })
    const h = (k: string) => req.headers.get(k) ?? ''
    const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text()
    return json(await deps.chain(id).serve({
      method: req.method, url: req.url, body, ts: h('x-ts'), nonce: h('x-nonce'), sig: h('x-sig'), ip: h('cf-connecting-ip') || 'unknown',
    }))
  } catch (e) {
    return json({ status: 500, body: { error: (e as Error).message } })
  }
}

const now = () => Math.floor(Date.now() / 1000)
const FAIL_WINDOW_S = 600
const MAX_FAILS = 10

/** One chain: its sql, its service once created, its request nonces and (on root) the failed-redeem counter. */
export class ChainHost implements ChainHandleLike {
  service: ChainService | null = null
  #boot?: Promise<void>

  constructor(private sql: Sql, private wasm: NodeConfig['wasm'], private cfg: { rootAdmin: string; chain(id: string): ChainHandleLike }) {
    sql.exec('CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, ts INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS fails (ip TEXT NOT NULL, at INTEGER NOT NULL)')
  }

  /** Boot the stored chain once, if any (a Durable Object learns its chain id from its first call). */
  #ready(chainId: string): Promise<void> {
    this.#boot ??= ChainService.open(this.sql, this.wasm, { chainId }).then((s) => { this.service = s })
    return this.#boot
  }

  async rootInfo(): Promise<RootInfo | null> {
    await this.#ready('root')
    if (!this.service) return null
    const i = await this.service.info()
    return { chainId: 'root', admin: i.admin, access: i.access, head: i.head.number }
  }

  /** The signer of a valid, fresh, never-seen signed request; its nonce is spent here. */
  async #auth(r: ChainRequest): Promise<string | null> {
    const t = now()
    if (!r.sig || !r.nonce || Math.abs(t - Number(r.ts)) > SKEW_S) return null
    let signer: string
    try { signer = await recoverSigner(r.method, new URL(r.url), r.body, r) } catch { return null }
    if (this.sql.exec('SELECT 1 FROM nonces WHERE nonce = ?', r.nonce).length) return null
    this.sql.exec('DELETE FROM nonces WHERE ts < ?', t - 2 * SKEW_S)
    this.sql.exec('INSERT INTO nonces VALUES (?, ?)', r.nonce, t)
    return signer
  }

  async serve(r: ChainRequest): Promise<Reply> {
    try {
      return await this.#serve(r)
    } catch (e) {
      if (e instanceof ServiceError) return { status: e.status, body: { error: e.message } }
      throw e
    }
  }

  async #serve(r: ChainRequest): Promise<Reply> {
    const url = new URL(r.url)
    const [, , id = 'root', ...rest] = url.pathname.split('/')
    const route = `${r.method} ${rest.join('/')}`
    const isRoot = id === 'root'
    await this.#ready(id)
    const known = url.pathname === '/chains' ? isRoot : ['GET ', 'POST submit', ...(isRoot ? ['GET nonce', 'GET codes'] : [])].includes(route)
    if (!known) return { status: 404, body: { error: 'not found' } }
    if (url.pathname !== '/chains' && !this.service) return { status: 404, body: { error: 'no such chain' } }
    const signer = await this.#auth(r)
    if (!signer) return { status: 401, body: { error: 'bad, missing, expired or replayed signature' } }
    const s = this.service!

    if (url.pathname === '/chains') return this.#createChain(signer, r)
    switch (route) {
      case 'GET ':
        if (!(await s.canRead(signer))) throw new ServiceError(403, `${signer} is not a reader of this chain`)
        return { status: 200, body: await s.info() }
      case 'POST submit': {
        const { txs } = parse<{ txs: Hex[] }>(r.body)
        if (!Array.isArray(txs) || !txs.length) throw new ServiceError(400, 'txs must be a non-empty array')
        return { status: 200, body: { head: await s.submit(signer, txs, now()) } }
      }
      case 'GET nonce':
        return { status: 200, body: { nonce: await s.nonceOf(signer) } }
      default: // GET codes
        if (signer !== this.cfg.rootAdmin.toLowerCase()) throw new ServiceError(403, 'only the root admin can list codes')
        return { status: 200, body: await s.codes() }
    }
  }

  /** Root only. No claim: the root admin creates `root`. With a claim: redeem it here, then create a new chain. */
  async #createChain(signer: string, r: ChainRequest): Promise<Reply> {
    const { dump, setup, claim } = parse<CreateChainRequest>(r.body)
    const url = (id: string) => new URL(`/chains/${id}`, r.url).href
    const done = (out: Reply, id: string) => (out.status === 201 ? { status: 201, body: { ...(out.body as object), url: url(id) } } : out)
    if (!claim) {
      if (signer !== this.cfg.rootAdmin.toLowerCase()) throw new ServiceError(403, 'only the root admin can create a chain without a code')
      if (this.service) throw new ServiceError(409, 'the root chain already exists')
      return done(await this.create('root', signer, dump, setup), 'root')
    }
    if (!this.service) throw new ServiceError(404, 'no root chain yet')
    const t = now()
    this.sql.exec('DELETE FROM fails WHERE at < ?', t - FAIL_WINDOW_S)
    if (Number(this.sql.exec('SELECT count(*) AS n FROM fails WHERE ip = ?', r.ip)[0]!.n) >= MAX_FAILS)
      throw new ServiceError(429, 'too many failed codes; try again in a few minutes')
    let hash: Hex
    try {
      ;({ codeHash: hash } = await this.service.redeem(signer, claim, t))
    } catch (e) {
      this.sql.exec('INSERT INTO fails VALUES (?, ?)', r.ip, t)
      throw e
    }
    // ponytail: if the create below fails the code is spent (design risk); the admin issues another
    const id = crypto.randomUUID()
    const out = await this.cfg.chain(id).create(id, signer, dump, setup)
    if (out.status === 201) this.service.recordRedeem(hash, signer, id, now())
    return done(out, id)
  }

  /** Create this chain from `dump` + the two set-up txs; the reply carries the new chain's dump. */
  async create(chainId: string, signer: string, dump: SerializedState, setup: [Hex, Hex]): Promise<Reply> {
    try {
      await this.#ready(chainId)
      const s = await ChainService.create(this.sql, this.wasm, { chainId, signer, dump, setup, timestamp: now() })
      this.service = s
      const info = await s.info()
      return { status: 201, body: { chainId, head: info.head, dump: await s.dump() } }
    } catch (e) {
      if (e instanceof ServiceError) return { status: e.status, body: { error: e.message } }
      throw e
    }
  }
}

function parse<T>(body: string): T {
  try {
    const v = JSON.parse(body)
    if (v && typeof v === 'object') return v as T
  } catch {}
  throw new ServiceError(400, 'body must be a JSON object')
}
