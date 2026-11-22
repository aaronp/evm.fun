import { DurableObject } from 'cloudflare:workers'
// @ts-ignore wrangler bundles .wasm as a compiled WebAssembly.Module
import wasm from 'revm-wasm/revm.wasm'
import { AUTH_PARAMS, applyBlock, makeChain, recoverSigner, type BlockRecord, type Chain, type Genesis } from './chain'

interface Env { CHAIN: DurableObjectNamespace<ChainDO> }

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
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
      CREATE TABLE IF NOT EXISTS members(addr TEXT PRIMARY KEY, role TEXT NOT NULL);
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
  role(addr: string) { return this.sql.exec<{ role: string }>('SELECT role FROM members WHERE addr=?', addr).toArray()[0]?.role }
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

  async fetch(req: Request) {
    const url = new URL(req.url)
    const body = req.method === 'GET' ? '' : await req.text()
    const signer = await this.authenticate(req, url, body)
    if (!signer) return json({ error: 'bad or missing signature' }, 401)

    if (url.pathname === '/chains') return this.serial(() => this.create(req.headers.get('x-chain-id')!, signer, JSON.parse(body)))
    if (!this.chain) return json({ error: 'no such chain' }, 404)
    const role = this.role(signer)
    if (!role) return json({ error: 'not a member', signer }, 403)

    const sub = url.pathname.split('/').slice(3).join('/')
    switch (`${req.method} ${sub}`) {
      case 'GET ':
        return json({
          chainId: this.meta('chainId'), genesis: JSON.parse(this.meta('genesis')!), head: this.head(), bootMs: this.bootMs, instance: this.instance, engine: this.chain.node.engine.id,
          members: this.sql.exec('SELECT addr, role FROM members').toArray(),
        })
      case 'GET blocks': {
        const after = Number(url.searchParams.get('after') ?? -1)
        const rows = this.sql.exec<any>('SELECT * FROM blocks WHERE number > ? ORDER BY number LIMIT 100', after).toArray()
        return json(rows.map((r) => ({
          number: r.number, hash: r.hash, parentHash: r.parent_hash, timestamp: r.timestamp, stateRoot: r.state_root,
          proposer: r.proposer, txs: JSON.parse(r.txs), receipts: JSON.parse(r.receipts), snapshotBytes: r.snapshot_bytes,
        })))
      }
      case 'POST submit': return this.serial(() => this.submit(signer, JSON.parse(body)))
      case 'POST members':
        if (role !== 'owner') return json({ error: 'owner only' }, 403)
        return this.serial(async () => this.members(JSON.parse(body)))
      case 'GET subscribe': {
        if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426)
        const { 0: client, 1: server } = new WebSocketPair()
        this.ctx.acceptWebSocket(server, [signer]) // hibernation API; tagged so removal can kick it
        return new Response(null, { status: 101, webSocket: client })
      }
    }
    return json({ error: 'not found' }, 404)
  }

  async create(chainId: string, owner: string, { genesis, accessPolicy }: { genesis: Genesis; accessPolicy?: { members?: string[] } }) {
    if (this.meta('genesis')) return json({ error: 'exists' }, 409)
    if (!Number.isSafeInteger(genesis?.chainId) || !Number.isSafeInteger(genesis?.timestamp) || typeof genesis.alloc !== 'object')
      return json({ error: 'bad genesis' }, 400)
    const chain = await makeChain(genesis, wasm)
    const g = (await chain.node.request({ method: 'eth_getBlockByNumber', params: ['0x0', false] })) as { hash: string; parentHash: string }
    const root = await chain.node.getStateRoot()
    const snap = JSON.stringify(await chain.node.dumpState())
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('INSERT INTO meta VALUES (?, ?), (?, ?)', 'chainId', chainId, 'genesis', JSON.stringify(genesis))
      this.sql.exec('INSERT INTO members VALUES (?, ?)', owner, 'owner')
      for (const a of accessPolicy?.members ?? []) this.sql.exec('INSERT OR IGNORE INTO members VALUES (?, ?)', a.toLowerCase(), 'member')
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
    if (p.expectedHead !== head.hash) return json({ error: 'stale head', head }, 409)
    if (!Array.isArray(p.txs) || !p.txs.length) return json({ error: 'no txs' }, 400)
    const now = Math.floor(Date.now() / 1000)
    // proposer may pick the timestamp (so its optimistic local block matches ours); must be monotone and not far future
    const ts = p.timestamp ?? Math.max(now, head.timestamp)
    if (ts < head.timestamp || ts > now + 30) return json({ error: 'bad timestamp', head }, 400)

    const t0 = performance.now()
    let block: BlockRecord
    try {
      block = await applyBlock(this.chain!, ts, p.txs)
    } catch (e) {
      await this.chain!.node.loadState(JSON.parse(this.snapshot)) // drop anything half-queued
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
    for (const ws of this.ctx.getWebSockets()) try { ws.send(msg) } catch {}
    return json({ block: { ...block, proposer }, timings: { executeMs: t1 - t0, dumpMs: t2 - t1, persistMs: t3 - t2, snapshotBytes: snap.length } })
  }

  members({ add = [], remove = [] }: { add?: string[]; remove?: string[] }) {
    this.ctx.storage.transactionSync(() => {
      for (const a of add) this.sql.exec('INSERT OR IGNORE INTO members VALUES (?, ?)', a.toLowerCase(), 'member')
      for (const a of remove) this.sql.exec("DELETE FROM members WHERE addr=? AND role != 'owner'", a.toLowerCase())
    })
    for (const a of remove) for (const ws of this.ctx.getWebSockets(a.toLowerCase())) ws.close(4003, 'removed')
    return json({ members: this.sql.exec('SELECT addr, role FROM members').toArray() })
  }

  webSocketMessage() {}
  webSocketClose(ws: WebSocket, code: number) { try { ws.close(code) } catch {} }
}
