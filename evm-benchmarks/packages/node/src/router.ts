// HTTP routing for the chain worker, independent of Durable Objects.
// `handle` does CORS and finds the chain; each chain is a `ChainHost` (one Durable Object in the worker, or an
// in-process object in tests) that authenticates, keeps its own single-use request nonces, and runs its ChainService.
import type { Hex } from 'viem'
import type { SerializedState } from 'webevm'
import { recoverSigner, SKEW_S } from './auth'
import type { Sql } from './sql'
import { ChainService, ServiceError, checkSetup } from './service'
import type { NodeConfig } from './node'
import { MAX_CREATE_BYTES, type CreateChainRequest } from './client'

/** A request as a chain sees it (plain data, so it crosses a Durable Object RPC boundary). */
export interface ChainRequest { method: string; url: string; body: string; ts: string; nonce: string; sig: string; ip: string; name?: string }
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

/** Body cap for every route but POST /chains (submit, signed GETs): a few txs. */
const MAX_BODY_BYTES = 64 * 1024

const ORIGINS = [/^https:\/\/mychain\.dev$/, /^https:\/\/aaronp\.github\.io$/, /^http:\/\/localhost(:\d+)?$/]

function cors(origin: string | null): Record<string, string> {
  if (!origin || !ORIGINS.some((o) => o.test(origin))) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-ts, x-nonce, x-sig, x-node-name',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

export async function handle(req: Request, deps: RouterDeps): Promise<Response> {
  const headers = cors(req.headers.get('origin'))
  const json = (r: Reply) => new Response(JSON.stringify(r.body), { status: r.status, headers: { ...headers, 'content-type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  const url = new URL(req.url)
  // size caps before auth or parsing, so an oversize body never reaches a Durable Object
  const max = req.method === 'POST' && url.pathname === '/chains' ? MAX_CREATE_BYTES : MAX_BODY_BYTES
  const tooBig = { status: 413, body: { error: `body over ${max} bytes` } }
  if (Number(req.headers.get('content-length') ?? 0) > max) return json(tooBig)
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json({ status: 200, body: { ok: true, root: await deps.chain('root').rootInfo() } })
    // POST /chains goes to the root chain: it checks the code, then creates the new chain
    const id = url.pathname === '/chains' ? 'root' : url.pathname.match(/^\/chains\/([\w-]{1,64})(\/[\w-]*)?$/)?.[1]
    if (!id) return json({ status: 404, body: { error: 'not found' } })
    const h = (k: string) => req.headers.get(k) ?? ''
    // ponytail: a chunked body without content-length is read in full before this check; stream-count it if that matters
    const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text()
    if (body.length > max) return json(tooBig)
    return json(await deps.chain(id).serve({
      method: req.method, url: req.url, body, ts: h('x-ts'), nonce: h('x-nonce'), sig: h('x-sig'), ip: h('cf-connecting-ip') || 'unknown', name: h('x-node-name').trim().slice(0, 32) || undefined,
    }))
  } catch (e) {
    console.error(e)
    return json({ status: 500, body: { error: 'internal error' } })
  }
}

const now = () => Math.floor(Date.now() / 1000)
const FAIL_WINDOW_S = 600
const MAX_FAILS = 10

/** One chain: its sql, its service once created, its request nonces and (on root) the failed-redeem counter. */
export class ChainHost implements ChainHandleLike {
  service: ChainService | null = null
  #boot?: Promise<void>
  #tables = false

  constructor(private sql: Sql, private wasm: NodeConfig['wasm'], private cfg: { rootAdmin: string; chain(id: string): ChainHandleLike }) {}

  /** Boot the stored chain once, if any (a Durable Object learns its chain id from its first call). Writes nothing if none. */
  #ready(chainId: string): Promise<void> {
    const stored = () => this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").length > 0
    // a failed boot is not cached, so a transient failure doesn't 500 this DO until eviction
    this.#boot ??= (stored() ? ChainService.open(this.sql, this.wasm, { chainId }) : Promise.resolve(null)).then(
      (s) => { this.service = s },
      (e) => { this.#boot = undefined; throw e },
    )
    return this.#boot
  }

  /** This host's own tables, created on first write, so a request to an unknown chain id stores nothing. */
  #own() {
    if (this.#tables) return
    this.sql.exec('CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, ts INTEGER NOT NULL)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS fails (ip TEXT NOT NULL, at INTEGER NOT NULL)')
    this.#tables = true
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
    if (!r.sig || !r.nonce || !Number.isFinite(Number(r.ts)) || Math.abs(t - Number(r.ts)) > SKEW_S) return null
    let signer: string
    try { signer = await recoverSigner(r.method, new URL(r.url), r.body, r) } catch { return null }
    this.#own()
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
    const known = url.pathname === '/chains' ? isRoot && r.method === 'POST' : ['GET ', 'POST submit', 'GET nonce', 'GET state', 'GET blocks', 'GET nodes', 'POST join', ...(isRoot ? ['GET codes'] : [])].includes(route)
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
      case 'GET state':
        await this.#reader(s, signer)
        return { status: 200, body: await s.state() }
      case 'GET blocks': {
        await this.#reader(s, signer)
        const a = url.searchParams.get('after') ?? '0'
        if (!/^\d{1,15}$/.test(a)) throw new ServiceError(400, 'after must be a non-negative integer')
        const out = s.blocks(Number(a))
        // the cursor is what this reply delivers, never a client-supplied number
        s.touch(signer, r.name, out.blocks.at(-1)?.header.number ?? out.head.number, now())
        return { status: 200, body: out }
      }
      case 'GET nodes':
        await this.#reader(s, signer)
        return { status: 200, body: await s.nodes() }
      case 'POST join': {
        const { claim } = parse<{ claim: Hex }>(r.body)
        if (typeof claim !== 'string') throw new ServiceError(400, 'claim must be a hex string')
        return { status: 200, body: await this.#limited(r.ip, () => s.join(signer, claim, now())) }
      }
      case 'GET nonce':
        return { status: 200, body: { nonce: await s.nonceOf(signer) } }
      default: // GET codes
        if (signer !== this.cfg.rootAdmin.toLowerCase()) throw new ServiceError(403, 'only the root admin can list codes')
        return { status: 200, body: await s.codes() }
    }
  }

  async #reader(s: ChainService, signer: string) {
    if (!(await s.canRead(signer))) throw new ServiceError(403, `${signer} is not a reader of this chain`)
  }

  /** Run a code check under the per-IP failure limit; a throw counts as a failure. */
  async #limited<T>(ip: string, f: () => Promise<T>): Promise<T> {
    const t = now()
    this.sql.exec('DELETE FROM fails WHERE at < ?', t - FAIL_WINDOW_S)
    if (Number(this.sql.exec('SELECT count(*) AS n FROM fails WHERE ip = ?', ip)[0]!.n) >= MAX_FAILS)
      throw new ServiceError(429, 'too many failed codes; try again in a few minutes')
    try {
      return await f()
    } catch (e) {
      this.sql.exec('INSERT INTO fails VALUES (?, ?)', ip, t)
      throw e
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
    // stateless set-up checks first, so a malformed upload never spends the code (a bad dump or a reverting tx still can)
    await checkSetup(signer, setup)
    const t = now()
    const { codeHash: hash } = await this.#limited(r.ip, () => this.service!.redeem(signer, claim, t))
    // ponytail: if the create below fails the code is spent (design risk R53); it is recorded as failed and the admin issues another
    const id = crypto.randomUUID()
    const record = (chainId: string) => this.service!.recordRedeem(hash, signer, chainId, now())
    let out: Reply
    try {
      out = await this.cfg.chain(id).create(id, signer, dump, setup)
    } catch (e) {
      record(`failed: ${e instanceof Error ? e.message : String(e)}`)
      throw e
    }
    record(out.status === 201 ? id : `failed: ${(out.body as { error?: string }).error ?? out.status}`)
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
