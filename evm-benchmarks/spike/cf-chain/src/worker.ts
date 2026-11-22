import { DurableObject } from 'cloudflare:workers'
// @ts-ignore wrangler bundles .wasm as a compiled WebAssembly.Module
import wasm from 'revm-wasm/revm.wasm'
import { decodeFunctionResult, encodeFunctionData, erc20Abi, parseTransaction, recoverTransactionAddress, toFunctionSelector, type Hex } from 'viem'
import {
  ACCESS, AUTH_PARAMS, accessView, applyBlock, makeChain, recoverSigner, verifyReadToken,
  type AccessConfig, type BlockRecord, type Chain, type Genesis,
} from './chain'

interface Env { CHAIN: DurableObjectNamespace<ChainDO> }

const json = (v: unknown, status = 200, timing = '') => new Response(JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x), {
  status, headers: { 'content-type': 'application/json', ...(timing ? { 'server-timing': timing } : {}) },
})
const ZERO = '0x0000000000000000000000000000000000000000'
const CLAIM = toFunctionSelector('claim(string)')
const isAddr = (a: string | undefined): a is Hex => !!a && /^0x[0-9a-fA-F]{40}$/.test(a)
type Caller = { addr: string | null; via: 'sig' | 'token' | 'anon'; authMs: number }
const CHUNK = 1_000_000 // DO SQLite caps a single value at 2 MB
const SKEW_S = 300

export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url)
    if (url.pathname === '/chains' && req.method === 'POST') {
      const id = crypto.randomUUID()
      const fwd = new Request(req)
      fwd.headers.set('x-chain-id', id)
      return env.CHAIN.get(env.CHAIN.idFromName(id)).fetch(fwd)
    }
    const m = url.pathname.match(/^\/chains\/([\w-]+)(\/|$)/)
    if (!m) return json({ error: 'not found' }, 404)
    return env.CHAIN.get(env.CHAIN.idFromName(m[1]!)).fetch(req)
  },
}

export class ChainDO extends DurableObject<Env> {
  sql = this.ctx.storage.sql
  chain?: Chain
  snapshot = '' // last persisted dumpState JSON, used to roll back a refused block
  bootMs = 0
  instance = crypto.randomUUID() // proves a restart really built a new object
  queue: Promise<unknown> = Promise.resolve()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS blocks(number INTEGER PRIMARY KEY, hash TEXT NOT NULL, parent_hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL, state_root TEXT NOT NULL, proposer TEXT, txs TEXT NOT NULL, receipts TEXT NOT NULL,
        snapshot_bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot(i INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nonces(nonce TEXT PRIMARY KEY, ts INTEGER NOT NULL);`)
    ctx.blockConcurrencyWhile(() => this.boot())
  }

  async boot() {
    const g = this.meta('genesis')
    if (!g) return
    const t0 = performance.now()
    this.chain = await makeChain(JSON.parse(g), wasm)
    this.snapshot = this.sql.exec<{ data: string }>('SELECT data FROM snapshot ORDER BY i').toArray().map((r) => r.data).join('')
    await this.chain.node.loadState(JSON.parse(this.snapshot))
    this.bootMs = performance.now() - t0
  }

  meta(k: string) { return this.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k=?', k).toArray()[0]?.v }
  // access is read from chain state on every call: an eth_call against the DO's own node, no cache
  canRead(addr: string | null) { return accessView(this.chain!.node, 'canRead', [addr ?? ZERO]) as Promise<boolean> }
  canWrite(addr: string) { return accessView(this.chain!.node, 'canWrite', [addr]) as Promise<boolean> }
  head() { return this.sql.exec<{ number: number; hash: string; timestamp: number }>('SELECT number, hash, timestamp FROM blocks ORDER BY number DESC LIMIT 1').one() }
  /** Explicit mutex: one mutation at a time across all the awaits inside execution. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  async authenticate(req: Request, url: URL, body: string) {
    const a = Object.fromEntries(AUTH_PARAMS.map((p) => [p, req.headers.get(`x-${p}`) ?? url.searchParams.get(p) ?? ''])) as Record<typeof AUTH_PARAMS[number], string>
    const now = Math.floor(Date.now() / 1000)
    if (!a.sig || Math.abs(now - Number(a.ts)) > SKEW_S) return null
    let signer: string
    try { signer = await recoverSigner(req.method, url, body, a) } catch { return null }
    // replay guard: each signed request is single-use
    if (this.sql.exec('SELECT 1 FROM nonces WHERE nonce=?', a.nonce).toArray().length) return null
    this.sql.exec('DELETE FROM nonces WHERE ts < ?', now - 2 * SKEW_S)
    this.sql.exec('INSERT INTO nonces VALUES (?, ?)', a.nonce, now)
    return signer
  }

  /** Who is calling: an EIP-191 signed request (x-sig / ?sig), a self-issued bearer read token, or nobody. */
  async caller(req: Request, url: URL, body: string): Promise<Caller | Response> {
    const t0 = performance.now()
    if (req.headers.get('x-sig') || url.searchParams.get('sig')) {
      const addr = await this.authenticate(req, url, body)
      return addr ? { addr, via: 'sig', authMs: performance.now() - t0 } : json({ error: 'bad or missing signature' }, 401)
    }
    const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? url.searchParams.get('token') // ?token= for WebSocket
    if (token) {
      const v = await verifyReadToken(token, this.meta('chainId') ?? '')
      return 'address' in v ? { addr: v.address, via: 'token', authMs: performance.now() - t0 } : json({ error: v.error }, 401)
    }
    return { addr: null, via: 'anon', authMs: 0 }
  }

  async fetch(req: Request) {
    const url = new URL(req.url)
    const body = req.method === 'GET' ? '' : await req.text()
    const c = await this.caller(req, url, body)
    if (c instanceof Response) return c

    if (url.pathname === '/chains') {
      if (c.via !== 'sig') return json({ error: 'create needs a signed request' }, 401)
      return this.serial(() => this.create(req.headers.get('x-chain-id')!, c.addr!, JSON.parse(body)))
    }
    if (!this.chain) return json({ error: 'no such chain' }, 404)
    const parts = url.pathname.split('/').slice(3)
    const route = `${req.method} ${parts[0] ?? ''}`

    if (route === 'POST submit') {
      if (c.via !== 'sig') return json({ error: 'submit needs a signed request' }, 401)
      return this.serial(() => this.submit(c.addr!, JSON.parse(body)))
    }
    if (req.method !== 'GET') return json({ error: 'not found' }, 404)

    // every GET is a read: anonymous only while readOpen, otherwise canRead(caller) from chain state
    const t0 = performance.now()
    const ok = await this.canRead(c.addr)
    const aclMs = performance.now() - t0
    if (!ok) return c.addr ? json({ error: 'not a reader', caller: c.addr }, 403) : json({ error: 'reads are restricted: sign the request or send a bearer token' }, 401)
    const timing = `auth;dur=${c.authMs.toFixed(3)}, acl;dur=${aclMs.toFixed(3)}`
    const r = await this.read(req, parts, url, c)
    if (r instanceof Response) return r
    return json(r, 200, timing)
  }

  async read(req: Request, parts: string[], url: URL, c: Caller): Promise<unknown> {
    const node = this.chain!.node
    const [what, a, b, d] = parts
    switch (what ?? '') {
      case '': return {
        chainId: this.meta('chainId'), genesis: JSON.parse(this.meta('genesis')!), head: this.head(), bootMs: this.bootMs, instance: this.instance, engine: node.engine.id,
        access: { address: ACCESS, admin: await accessView(node, 'admin', []), readOpen: await accessView(node, 'readOpen', []) }, caller: c.addr, via: c.via,
      }
      case 'head': return this.head()
      case 'blocks': {
        const after = Number(url.searchParams.get('after') ?? -1)
        const rows = this.sql.exec<any>('SELECT * FROM blocks WHERE number > ? ORDER BY number LIMIT 100', after).toArray()
        return rows.map((r) => ({
          number: r.number, hash: r.hash, parentHash: r.parent_hash, timestamp: r.timestamp, stateRoot: r.state_root,
          proposer: r.proposer, txs: JSON.parse(r.txs), receipts: JSON.parse(r.receipts), snapshotBytes: r.snapshot_bytes,
        }))
      }
      case 'access': // GET access/:address -> what that key may do now
        if (!isAddr(a)) return json({ error: 'bad address' }, 400)
        return { address: a.toLowerCase(), canRead: await this.canRead(a), canWrite: await this.canWrite(a) }
      case 'balance':
        if (!isAddr(a)) return json({ error: 'bad address' }, 400)
        return { address: a.toLowerCase(), block: this.head().number, wei: BigInt(await node.request({ method: 'eth_getBalance', params: [a, 'latest'] }) as string) }
      case 'call': { // GET call/:contract?data=0x… -> raw eth_call
        const data = url.searchParams.get('data') ?? '0x'
        if (!isAddr(a) || !/^0x([0-9a-fA-F]{2})*$/.test(data)) return json({ error: 'bad contract or data' }, 400)
        try { return { block: this.head().number, result: await node.request({ method: 'eth_call', params: [{ to: a, data }, 'latest'] }) } }
        catch (e) { return json({ error: (e as Error).message }, 400) }
      }
      case 'erc20': { // GET erc20/:token/balanceOf/:address
        if (b !== 'balanceOf' || !isAddr(a) || !isAddr(d)) return json({ error: 'expected erc20/:token/balanceOf/:address' }, 400)
        const ret = await node.request({ method: 'eth_call', params: [{ to: a, data: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [d] }) }, 'latest'] })
        return { token: a.toLowerCase(), address: d.toLowerCase(), block: this.head().number, balance: decodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', data: ret as Hex }) }
      }
      case 'bench': { // spike instrumentation: average in-DO cost of the access checks
        const n = Math.min(Number(url.searchParams.get('n') ?? 1000), 5000)
        const tok = url.searchParams.get('token') ?? ''
        const time = async (f: () => Promise<unknown>, k = n) => { const t0 = performance.now(); for (let i = 0; i < k; i++) await f(); return (performance.now() - t0) / k }
        return {
          n, canReadMs: await time(() => this.canRead(c.addr)), canWriteMs: await time(() => this.canWrite(c.addr ?? ZERO)),
          tokenVerifyMs: tok ? await time(() => verifyReadToken(tok, this.meta('chainId')!), 200) : null,
        }
      }
      case 'subscribe': {
        if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426)
        const { 0: client, 1: server } = new WebSocketPair()
        this.ctx.acceptWebSocket(server, [c.addr ?? 'anon']) // tagged so a revoke can kick it
        return new Response(null, { status: 101, webSocket: client })
      }
    }
    return json({ error: 'not found' }, 404)
  }

  async create(chainId: string, owner: string, { genesis, access }: { genesis: Genesis; access?: Omit<AccessConfig, 'admin'> }) {
    if (this.meta('genesis')) return json({ error: 'exists' }, 409)
    if (!Number.isSafeInteger(genesis?.chainId) || !Number.isSafeInteger(genesis?.timestamp) || typeof genesis.alloc !== 'object')
      return json({ error: 'bad genesis' }, 400)
    // creator's key becomes the ChainAccess admin, written into genesis state
    genesis = { ...genesis, access: { admin: owner, readOpen: !!access?.readOpen, readers: (access?.readers ?? []).map((a) => a.toLowerCase()), writers: (access?.writers ?? []).map((a) => a.toLowerCase()) } }
    const chain = await makeChain(genesis, wasm)
    const g = (await chain.node.request({ method: 'eth_getBlockByNumber', params: ['0x0', false] })) as { hash: string; parentHash: string }
    const root = await chain.node.getStateRoot()
    const snap = JSON.stringify(await chain.node.dumpState())
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('INSERT INTO meta VALUES (?, ?), (?, ?)', 'chainId', chainId, 'genesis', JSON.stringify(genesis))
      this.sql.exec('INSERT INTO blocks VALUES (0, ?, ?, ?, ?, NULL, ?, ?, ?)', g.hash, g.parentHash, genesis.timestamp, root, '[]', '[]', snap.length)
      this.writeSnapshot(snap)
    })
    this.chain = chain
    this.snapshot = snap
    return json({ chainId, head: this.head() }, 201)
  }

  writeSnapshot(snap: string) {
    this.sql.exec('DELETE FROM snapshot')
    for (let i = 0; i * CHUNK < snap.length; i++) this.sql.exec('INSERT INTO snapshot VALUES (?, ?)', i, snap.slice(i * CHUNK, (i + 1) * CHUNK))
  }

  async submit(proposer: string, p: { expectedHead: string; timestamp?: number; txs: `0x${string}`[] }) {
    const head = this.head()
    if (!Array.isArray(p.txs) || !p.txs.length) return json({ error: 'no txs' }, 400)
    // admission, against head state (so a list change applies from the next block):
    //  - every tx sender must be a writer, except a claim(code) that would succeed (join code)
    //  - the request signer must be a writer, unless the block is only such claims
    const ta = performance.now()
    let allClaims = true
    const claims: number[] = [] // indexes of non-writer claim(code) txs; the block is refused unless each succeeds
    for (const [i, raw] of p.txs.entries()) {
      let from: string, tx: ReturnType<typeof parseTransaction>
      try { tx = parseTransaction(raw); from = (await recoverTransactionAddress({ serializedTransaction: raw as any })).toLowerCase() }
      catch { return json({ error: 'unparseable tx' }, 400) }
      if (await this.canWrite(from)) { allClaims = false; continue }
      if (tx.to?.toLowerCase() !== ACCESS || !tx.data?.startsWith(CLAIM)) return json({ error: 'tx sender not a writer', sender: from }, 403)
      claims.push(i)
    }
    if (!allClaims && !(await this.canWrite(proposer))) return json({ error: 'signer not a writer', signer: proposer }, 403)
    const admitMs = performance.now() - ta
    if (p.expectedHead !== head.hash) return json({ error: 'stale head', head }, 409)
    const now = Math.floor(Date.now() / 1000)
    // proposer may pick the timestamp (so its optimistic local block matches ours); must be monotone and not far future
    const ts = p.timestamp ?? Math.max(now, head.timestamp)
    if (ts < head.timestamp || ts > now + 30) return json({ error: 'bad timestamp', head }, 400)

    const t0 = performance.now()
    let block: BlockRecord
    try {
      block = await applyBlock(this.chain!, ts, p.txs)
      // a reverted claim would still be mined (and is free): refuse it instead, so non-writers cannot spam blocks
      if (claims.some((i) => (block.receipts[i] as { status: string }).status !== '0x1')) {
        await this.boot()
        return json({ error: 'claim failed (bad, used or expired code)' }, 403)
      }
    } catch (e) {
      // ponytail: rebuild the node instead of loadState(snapshot) on the live one: webevm 0.9.1 loadState keeps
      // accounts that are absent from the snapshot (a new sender's nonce survived the rollback). ~10 ms per refusal.
      await this.boot()
      return json({ error: `rejected: ${(e as Error).message}` }, 400)
    }
    const t1 = performance.now()
    const snap = JSON.stringify(await this.chain!.node.dumpState())
    const t2 = performance.now()
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('INSERT INTO blocks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', block.number, block.hash, block.parentHash,
        block.timestamp, block.stateRoot, proposer, JSON.stringify(block.txs), JSON.stringify(block.receipts), snap.length)
      this.writeSnapshot(snap)
    })
    const t3 = performance.now()
    this.snapshot = snap
    const msg = JSON.stringify({ type: 'head', number: block.number, hash: block.hash })
    // re-check every subscriber against the new state; a key that lost read access is closed 4003
    const tags = new Set(this.ctx.getWebSockets().flatMap((ws) => this.ctx.getTags(ws)))
    for (const tag of tags) {
      const ok = await this.canRead(tag === 'anon' ? null : tag)
      for (const ws of this.ctx.getWebSockets(tag)) try { ok ? ws.send(msg) : ws.close(4003, 'read access revoked') } catch {}
    }
    return json({ block: { ...block, proposer }, timings: { admitMs, executeMs: t1 - t0, dumpMs: t2 - t1, persistMs: t3 - t2, snapshotBytes: snap.length } })
  }

  webSocketMessage() {}
  webSocketClose(ws: WebSocket, code: number) { try { ws.close(code) } catch {} }
}
