import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { keccak256, type LocalAccount } from 'viem'
import { ChainHost, handle, type ChainHandleLike } from '@evmb/node/src/router'
import { GRANT_DEPLOY, GRANT_READER, GRANT_WRITER, NodeClient, accessTx, claimTx, generateCode, inviteTx, setupTxs } from '@evmb/node/src/client'
import { bunSql } from '@evmb/node/test/bunSql'
import { freshDump, wasm } from '@evmb/node/scripts/bootstrap'
import { Follower } from '@evmb/node/src/follower'
import { deletePrompt, kvFollowerStore, storedTxs, unsentChanges, unsentWarning } from '../src/cloud/followerStore'
import { createKv } from '../src/store/kv'
import { createChainRegistry, LIVE_MAX } from '../src/chain/registry'
import { createContractsRegistry } from '../src/contracts/registry'
import { createWebAssets } from '../src/assets/registry'
import { pendingSummary, type FollowerStatus } from '../src/cloud/followerChain'
import { getSyncInterval, setSyncInterval } from '../src/cloud/node'

/** A socket that never reaches a server: tests open/close/drop it by hand. */
class FakeWS {
  static all: FakeWS[] = []
  closed?: number
  #l: Record<string, ((e: any) => void)[]> = {}
  constructor(public url: string) { FakeWS.all.push(this) }
  addEventListener(t: string, f: (e: any) => void) { (this.#l[t] ??= []).push(f) }
  send() {}
  close(code = 1000) { this.closed ??= code }
  emit(t: string, e: any = {}) { for (const f of this.#l[t] ?? []) f(e) }
}
const open = () => FakeWS.all.filter((w) => w.closed === undefined)
const until = async (c: () => boolean) => { for (let i = 0; i < 600 && !c(); i++) await new Promise((r) => setTimeout(r, 5)); expect(c()).toBe(true) }

// The worker stand-in (as cloud-deploy.test.ts): packages/node's router over in-process ChainHosts on bun:sqlite.
const admin = privateKeyToAccount(generatePrivateKey())
const phone = privateKeyToAccount(generatePrivateKey())
const hosts = new Map<string, ChainHost>()
const chainHost = (id: string): ChainHandleLike => {
  let h = hosts.get(id)
  if (!h) hosts.set(id, (h = new ChainHost(bunSql(), wasm, { rootAdmin: admin.address, chain: chainHost })))
  return h
}
let srv: ReturnType<typeof Bun.serve>, url: string, cid: string, access: `0x${string}`
const adminClient = () => new NodeClient(url, admin)
const g = globalThis as any
const realFetch = globalThis.fetch

/** n admin blocks on the deployed chain */
async function mineBlocks(n: number) {
  const c = adminClient()
  for (let i = 0; i < n; i++) await c.submit(cid, [await accessTx(admin, await c.nonce(cid), access, 'setReadOpen', false)])
}
const cloudHead = async () => (await adminClient().state(cid)).head

beforeAll(async () => {
  const m = new Map<string, string>()
  g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
  srv = Bun.serve({ port: 0, fetch: (r) => handle(r, { chain: chainHost }) })
  url = `http://localhost:${srv.port}`
  const c = adminClient()
  await c.createChain({ dump: await freshDump(), setup: await setupTxs(admin, 0, 31337) })
  const rootAccess = (await c.health()).root!.access
  // the admin deploys a chain with a code, as evm.fun's Deploy does
  const code = generateCode()
  await c.submit('root', [await inviteTx(admin, await c.nonce('root'), rootAccess, code, 600, 1)])
  cid = (await c.createChain({ dump: await freshDump(), setup: await setupTxs(admin, 0, 31337), claim: await claimTx(admin, await c.nonce('root'), code, rootAccess) })).chainId
  access = (await c.info(cid)).access
})
afterAll(() => {
  srv.stop(true)
  delete g.localStorage
})
afterEach(() => {
  globalThis.fetch = realFetch
  jest.useRealTimers()
  setSyncInterval('live')
  FakeWS.all = []
})

const keys = new Map<string, { account: LocalAccount; label: string }>([[admin.address, { account: admin, label: 'laptop' }], [phone.address, { account: phone, label: 'phone' }]])
function env(o: { kv?: ReturnType<typeof createKv>; lock?: () => boolean; lockWait?: (name: string, fn: () => Promise<void>, signal: AbortSignal) => void; wasm?: () => Promise<any>; account?: (a: `0x${string}`) => { account: LocalAccount; label: string } | undefined } = {}) {
  FakeWS.all = []
  const kv = o.kv ?? createKv()
  const keySubs = new Set<() => void>()
  const stores = new Map<string, any>()
  const events: string[] = []
  const registry = createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
    purge: async (id: string) => void stores.delete(id),
    follower: { lock: o.lock, lockWait: o.lockWait, WebSocket: FakeWS as never, wasm: o.wasm ?? (async () => wasm), account: o.account ?? ((a) => keys.get(a)), onAccountsChange: (cb) => (keySubs.add(cb), () => void keySubs.delete(cb)) },
  })
  registry.watch((id) => events.push(id))
  return { kv, stores, registry, events, keysChanged: () => keySubs.forEach((cb) => cb()) }
}
const follows = (account = admin.address, chainId = cid) => ({ nodeUrl: url, chainId, account })
const status = (h: { approach: unknown }) => (h.approach as { status(): FollowerStatus }).status()
const syncNow = (h: { approach: unknown }) => (h.approach as { syncNow(): Promise<void> }).syncNow()
/** As Join does: store the pointer, then open it. */
async function addFollower(registry: ReturnType<typeof createChainRegistry>, o: { name: string; follows: ReturnType<typeof follows> }) {
  const id = crypto.randomUUID()
  await registry.putFollower({ id, name: o.name, createdAt: new Date().toISOString(), follows: o.follows, contracts: [] })
  return registry.open(id)
}
const statuses = async (kv: ReturnType<typeof createKv>, id: string) => (await kvFollowerStore(kv).listPending(id)).map((t) => t.status)
const bn = async (h: { request(m: string, p?: unknown[]): Promise<unknown> }) => Number(BigInt((await h.request('eth_blockNumber', [])) as string))

describe('follower chains', () => {
  test('a follower opens at the cloud head and eth_blockNumber/eth_getBalance answer', async () => {
    const { registry, kv, events } = env()
    const h = await addFollower(registry, { name: 'deployed', follows: follows() })
    const head = await cloudHead()
    expect(h.info).toMatchObject({ name: 'deployed', type: 'follower', follows: follows() })
    expect(await bn(h)).toBe(head.number)
    expect(BigInt((await h.request('eth_getBalance', [admin.address, 'latest'])) as string)).toBeGreaterThanOrEqual(0n)
    expect(status(h)).toEqual({ kind: 'following', block: head.number, behind: 0 })
    expect(events).toContain(h.info.id) // onHead/onStatus reach watchers
    expect((await kv.get<any>('chains', h.info.id)).follows).toEqual(follows())
    expect(registry.liveCount()).toBe(1) // counts toward the cap
    await registry.remove(h.info.id)
    expect(registry.liveCount()).toBe(0)
    expect(await registry.list()).toEqual([])
  })

  test('mine, snapshot and restore on a follower throw: its blocks come from the cloud', async () => {
    const { registry } = env()
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    const why = `Follows ${url}: its blocks come from there`
    await expect(h.mine(1)).rejects.toThrow(why)
    await expect(h.approach.snapshot!()).rejects.toThrow(why)
    await expect(h.approach.restore!({})).rejects.toThrow(why)
    await registry.remove(h.info.id)
  })

  test('syncNow picks up blocks the admin submits', async () => {
    const { registry } = env()
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    await mineBlocks(2)
    await syncNow(h)
    const head = await cloudHead()
    expect(await bn(h)).toBe(head.number)
    expect(status(h)).toEqual({ kind: 'following', block: head.number, behind: 0 })
    await registry.remove(h.info.id)
  })

  test('removal → status removed', async () => {
    const { registry } = env()
    const c = adminClient(), code = generateCode()
    await c.submit(cid, [await inviteTx(admin, await c.nonce(cid), access, code, 600, 1, GRANT_READER)])
    await new NodeClient(url, phone).join(cid, await claimTx(phone, 0, code, access))
    const h = await addFollower(registry, { name: 'd', follows: follows(phone.address) })
    expect(status(h).kind).toBe('following')
    await c.submit(cid, [await accessTx(admin, await c.nonce(cid), access, 'removeReader', phone.address)])
    await syncNow(h)
    expect(status(h)).toEqual({ kind: 'removed', detail: 'Removed from d: your copy is no longer updated' })
    await expect(h.request('eth_blockNumber', [])).rejects.toThrow()
    await registry.remove(h.info.id)
  })

  test('missing account → needs-key, no request sent, no wasm; importing the key recovers without reopening', async () => {
    let present = false, compiles = 0
    const { registry, keysChanged } = env({ wasm: async () => (compiles++, wasm), account: (a) => (present ? keys.get(a) : undefined) })
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    expect(status(h)).toEqual({ kind: 'needs-key', detail: `Needs ${admin.address}'s key` })
    await syncNow(h)
    expect(compiles).toBe(0)
    present = true
    keysChanged() // e.g. Accounts → Import key
    await syncNow(h) // joins the sync the change started
    expect(status(h)).toMatchObject({ kind: 'following', behind: 0 })
    expect(compiles).toBe(1)
    expect(registry.peek(h.info.id)).toBe(h)
    await registry.remove(h.info.id)
  })

  test('a wasm compile that fails once → unreachable, then the next sync recovers', async () => {
    let n = 0
    const { registry } = env({ wasm: async () => { if (n++ === 0) throw new Error('compile failed'); return wasm } })
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    expect(status(h).kind).toBe('unreachable')
    await syncNow(h)
    expect(status(h)).toMatchObject({ kind: 'following', behind: 0 })
    expect(n).toBe(2)
    await registry.remove(h.info.id)
  })

  test('no status or head events from a poll that finds nothing new', async () => {
    const { registry, events } = env()
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    const n = events.length
    await syncNow(h)
    await syncNow(h)
    expect(events.length).toBe(n)
    await mineBlocks(1)
    await syncNow(h)
    expect(events.length).toBe(n + 2) // status (block) and head
    await registry.remove(h.info.id)
  })

  test('missing account → needs-key, no request sent', async () => {
    const { registry } = env()
    let calls = 0
    globalThis.fetch = ((...a: Parameters<typeof fetch>) => (calls++, realFetch(...a))) as typeof fetch
    const stranger = privateKeyToAccount(generatePrivateKey()).address
    const h = await addFollower(registry, { name: 'd', follows: follows(stranger) })
    await syncNow(h)
    expect(status(h)).toEqual({ kind: 'needs-key', detail: `Needs ${stranger}'s key` })
    expect(calls).toBe(0)
    await expect(h.request('eth_blockNumber', [])).rejects.toThrow(`Needs ${stranger}'s key`)
    await registry.remove(h.info.id)
  })

  test('network error on an open follower → offline, then following again', async () => {
    const { registry } = env()
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    await syncNow(h)
    expect(status(h)).toMatchObject({ kind: 'offline' })
    globalThis.fetch = realFetch
    await mineBlocks(1)
    await syncNow(h)
    expect(status(h)).toEqual({ kind: 'following', block: (await cloudHead()).number, behind: 0 })
    await registry.remove(h.info.id)
  })

  test('default setting is live and opens one socket', async () => {
    expect(getSyncInterval()).toBe('live')
    const { registry } = env()
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    await until(() => FakeWS.all.length === 1)
    expect(FakeWS.all[0].url).toContain(`/chains/${cid}/subscribe`)
    await syncNow(h)
    expect(FakeWS.all.length).toBe(1)
    await registry.remove(h.info.id)
  })

  test('a stored 15 reads as live', () => {
    for (const v of ['5', '15', '60', 'junk']) { g.localStorage.setItem('evmb.syncInterval', v); expect(getSyncInterval()).toBe('live') }
    g.localStorage.setItem('evmb.syncInterval', 'manual')
    expect(getSyncInterval()).toBe('manual')
    g.localStorage.removeItem('evmb.syncInterval')
  })

  test('manual opens no socket; Sync now still syncs', async () => {
    setSyncInterval('manual')
    const { registry } = env()
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    await mineBlocks(1)
    await syncNow(h)
    expect(FakeWS.all).toEqual([])
    expect(await bn(h)).toBe((await cloudHead()).number)
    expect(status(h)).toMatchObject({ kind: 'following', behind: 0 })
    await registry.remove(h.info.id)
  })

  test('switching manual → live connects, live → manual closes it', async () => {
    setSyncInterval('manual')
    const { registry } = env()
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    expect(FakeWS.all).toEqual([])
    setSyncInterval('live')
    await until(() => open().length === 1)
    setSyncInterval('manual')
    expect(open()).toEqual([])
    setSyncInterval('live')
    await until(() => open().length === 1)
    expect(FakeWS.all.length).toBe(2)
    await registry.remove(h.info.id)
  })

  test('socket down shows offline with lastSynced and keeps pending txs; back up resyncs', async () => {
    const { registry } = env()
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    await until(() => FakeWS.all.length === 1)
    const ws = FakeWS.all[0]
    ws.emit('open')
    await until(() => status(h).kind === 'following')
    const raw = await admin.signTransaction({ type: 'eip1559', chainId: 31337, nonce: Number(BigInt((await h.request('eth_getTransactionCount', [admin.address, 'latest'])) as string)), to: phone.address, value: 0n, gas: 30_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    await (h.approach as any).submit([raw]) // runs locally; its sync can't reach the cloud
    expect((h.approach as any).pendingTxs().map((t: any) => t.status)).toEqual(['pending'])
    ws.emit('close', { code: 1006 })
    const off = status(h) as Extract<FollowerStatus, { kind: 'offline' }>
    expect(off.kind).toBe('offline')
    expect(typeof off.lastSynced).toBe('number')
    expect(off.detail).toContain('Offline — last synced')
    expect(off.detail).toContain('Changes are kept')
    expect((h.approach as any).pendingTxs().map((t: any) => t.status)).toEqual(['pending'])
    globalThis.fetch = realFetch
    await until(() => FakeWS.all.length === 2) // backoff, then a fresh socket
    FakeWS.all[1].emit('open')
    await until(() => status(h).kind === 'following')
    await registry.remove(h.info.id)
  })

  test('socket never opens but HTTP works: stays offline, no flap on retries', async () => {
    const { registry } = env()
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    await until(() => FakeWS.all.length === 1)
    FakeWS.all[0].emit('error') // failed connect: liveSync syncs, then backs off
    await syncNow(h)
    await new Promise((r) => setTimeout(r, 20))
    expect(status(h).kind).toBe('offline')
    await until(() => FakeWS.all.length === 2)
    FakeWS.all[1].emit('error')
    await syncNow(h)
    expect(status(h).kind).toBe('offline')
    FakeWS.all[2]?.emit('open')
    await registry.remove(h.info.id)
  })

  test('dispose closes the socket', async () => {
    const { registry } = env()
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    await until(() => open().length === 1)
    await registry.remove(h.info.id)
    expect(open()).toEqual([])
  })

  test('a 401 → clock; a 404 → gone', async () => {
    const { registry } = env()
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    globalThis.fetch = (async () => Response.json({ error: 'stale request' }, { status: 401 })) as unknown as typeof fetch
    await syncNow(h)
    expect(status(h)).toMatchObject({ kind: 'clock' })
    globalThis.fetch = realFetch
    const gone = await addFollower(registry, { name: 'g', follows: follows(admin.address, 'no-such-chain') })
    expect(status(gone)).toMatchObject({ kind: 'gone' })
    await registry.remove(h.info.id)
    await registry.remove(gone.info.id)
  })

  test('convertToFollower keeps id and records, drops local state', async () => {
    const { registry, kv, stores } = env()
    const plain = await registry.create('mine', 'plain', [admin.address])
    const id = plain.info.id
    const rec = { address: '0x00000000000000000000000000000000000000aa', name: 'T', abi: [], deployer: admin.address, txHash: `0x${'ab'.repeat(32)}` } as const
    await createContractsRegistry(kv).add(id, rec)
    const tok = { id: `${id}:${rec.address}`, chainId: id, kind: 'erc20', address: rec.address, symbol: 'GBP', name: 'Pound', decimals: 6, origin: 'launched', mintable: true, addedAt: '2026-11-19T00:00:00Z' } as const
    await createWebAssets(kv).replace(id, [tok as any])
    expect(stores.has(id)).toBe(true)
    const h = await registry.convertToFollower(id, follows())
    expect(h.info).toMatchObject({ id, name: 'mine', type: 'follower', follows: follows(), createdAt: plain.info.createdAt })
    expect(registry.peek(id)).toBe(h)
    expect(registry.liveCount()).toBe(1)
    expect(stores.has(id)).toBe(false)
    expect(await createContractsRegistry(kv).list(id)).toEqual([{ ...rec, chainId: id }] as any)
    expect((await createWebAssets(kv).list(id)).map((a: any) => a.id)).toEqual([tok.id, `${id}:native`])
    expect(await bn(h)).toBe((await cloudHead()).number)
    expect((await kv.get<any>('chains', id)).type).toBe('follower')
    await registry.close(id)
    const again = await registry.open(id) // a reload re-syncs as a follower
    await syncNow(again) // from the stored copy, open leaves the first sync running
    expect(status(again).kind).toBe('following')
    await registry.remove(id)
  })

  test('convertToFollower racing open(id) → one follower handle, no plain engine', async () => {
    const { registry, stores } = env()
    const plain = await registry.create('mine', 'plain', [admin.address])
    const id = plain.info.id
    await registry.close(id)
    const [a, b] = await Promise.all([registry.convertToFollower(id, follows()), registry.open(id)])
    expect(a).toBe(b)
    expect(a.info.type).toBe('follower')
    expect(registry.liveCount()).toBe(1)
    expect(stores.has(id)).toBe(false) // no plain engine saved state again
    await registry.remove(id)
  })

  test('convertToFollower refuses without the key (chain unchanged) and at the live cap', async () => {
    const { registry, kv, stores } = env()
    const plain = await registry.create('mine', 'plain', [admin.address])
    const id = plain.info.id
    const stranger = privateKeyToAccount(generatePrivateKey()).address
    await expect(registry.convertToFollower(id, follows(stranger))).rejects.toThrow(`Needs ${stranger}'s key`)
    expect(registry.peek(id)).toBe(plain)
    expect(stores.has(id)).toBe(true)
    expect((await kv.get<any>('chains', id)).type).toBe('plain')
    await registry.close(id)
    const others = []
    for (let i = 0; i < LIVE_MAX; i++) others.push(await registry.create(`c${i}`, 'plain', []))
    await expect(registry.convertToFollower(id, follows())).rejects.toThrow(`${LIVE_MAX} chains are already running`)
    expect(stores.has(id)).toBe(true)
    for (const c of others) await registry.remove(c.info.id)
    await registry.remove(id)
  })
})

test('signAndSend on a follower signs and sends like any chain', async () => {
  const { signAndSend } = await import('../src/tx/send')
  const sent: string[] = []
  const h = { info: { id: 'f', name: 'f', type: 'follower', createdAt: '', follows: { nodeUrl: 'https://node.example', chainId: 'c', account: admin.address } },
    request: async (m: string) => (m === 'eth_getBalance' ? `0x${(10n ** 24n).toString(16)}` : '0x0'),
    send: async (raw: string) => (sent.push(raw), { hash: '0x01', status: 'success', settledAt: 0 }) } as any
  const acct = { label: 'phone', address: phone.address, privateKey: generatePrivateKey() }
  expect((await signAndSend(h, acct, { to: admin.address, value: 1n })).status).toBe('success')
  expect(sent).toHaveLength(1)
})

describe('follower store and writing tab', () => {
  test('a follower with a stored copy opens with the node unreachable and reports offline with lastSynced', async () => {
    const kv = createKv()
    const a = env({ kv })
    const h1 = await addFollower(a.registry, { name: 'd', follows: follows() })
    const info = h1.info
    await a.registry.close(info.id)
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    const b = env({ kv })
    const h2 = await b.registry.open(info.id).catch(() => undefined)
    await syncNow(h2!)
    expect(status(h2!)).toMatchObject({ kind: 'offline' })
    const s = status(h2!) as any
    expect(s.lastSynced).toBeGreaterThan(0)
    expect(s.detail).toMatch(/^Offline — last synced .+\. Changes are kept and sent when you're back\.$/)
    expect(await bn(h2!)).toBeGreaterThanOrEqual(0)
  })

  test('a tab without the lock opens without a store and refuses sends with the other-tab message', async () => {
    const kv = createKv()
    const { registry } = env({ kv, lock: () => false })
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    expect(status(h).kind).toBe('following')
    expect(await kv.get('followerConfirmed', h.info.id)).toBeUndefined()
    const ap = h.approach as any
    expect(ap.canWrite()).toBe('Open in another tab: changes are made there.')
    await expect(ap.submit([])).rejects.toThrow('Open in another tab: changes are made there.')
    await registry.remove(h.info.id)
  })

  test('a tab with the lock stores its copy', async () => {
    const kv = createKv()
    const { registry } = env({ kv, lock: () => true })
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    expect((await kv.get<any>('followerConfirmed', h.info.id))?.head).toBeDefined()
    expect((h.approach as any).canWrite()).toBeUndefined()
    await registry.remove(h.info.id)
  })

  test('memory-only kv shows the not-saving notice text', async () => {
    const kv = createKv() // no IndexedDB under Bun: memory fallback
    expect(kv.persistent).toBe(false)
    const { registry } = env({ kv })
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    expect((h.approach as any).notice()).toBe("This browser isn't saving data: pending changes are lost if you close the tab.")
    await registry.remove(h.info.id)
  })

  /** A device that sent one tx (pending: it never synced) and was closed: its record sits in the store under `id`. */
  async function leavePending(kv: ReturnType<typeof createKv>, id: string) {
    await env({ kv }).registry.putFollower({ id, name: 'd', createdAt: new Date().toISOString(), follows: follows(), contracts: [] })
    const f = await Follower.open(new NodeClient(url, admin, { name: 'laptop' }), cid, wasm, { store: kvFollowerStore(kv), key: id })
    const nonce = await f.read(async (n) => Number(await n.request({ method: 'eth_getTransactionCount', params: [admin.address, 'latest'] })))
    await f.send(await admin.signTransaction({ type: 'eip1559', chainId: 31337, nonce, to: phone.address, value: 0n, gas: 30_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }))
    await f.dispose()
    expect((await kvFollowerStore(kv).listPending(id)).map((t) => t.status)).toEqual(['pending'])
  }
  const down = () => { globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch }

  test('chain delete removes the stored copy and every pending record', async () => {
    const kv = createKv()
    const id = crypto.randomUUID()
    await leavePending(kv, id)
    expect(await kv.get('followerConfirmed', id)).toBeDefined()
    await env({ kv }).registry.remove(id)
    expect(await kv.get('followerConfirmed', id)).toBeUndefined()
    expect(await kv.list(`followerPending:${id}`)).toEqual([])
  })

  test('a reload while offline shows its pending txs; back online they settle', async () => {
    const kv = createKv()
    const id = crypto.randomUUID()
    await leavePending(kv, id)
    down()
    const { registry } = env({ kv, lock: () => true })
    const h = await registry.open(id)
    await syncNow(h)
    expect(status(h)).toMatchObject({ kind: 'offline' })
    expect(await statuses(kv, id)).toEqual(['pending'])
    globalThis.fetch = realFetch
    await syncNow(h)
    expect(status(h).kind).toBe('following')
    expect(await statuses(kv, id)).toEqual(['confirmed'])
    await registry.close(id)
  })

  test('a read-only tab that later gets the lock reopens with the store; the other tab\'s pending records survive and settle', async () => {
    const kv = createKv()
    const id = crypto.randomUUID()
    await leavePending(kv, id) // tab A's record; tab A is gone
    let granted = false
    const { registry, events } = env({ kv, lock: () => granted })
    const h = await registry.open(id)
    const ap = h.approach as any
    expect(ap.canWrite()).toBe('Open in another tab: changes are made there.')
    expect(await bn(h)).toBeGreaterThanOrEqual(0) // the read-only view works
    granted = true
    const n = events.length
    await syncNow(h)
    expect(ap.canWrite()).toBeUndefined()
    expect(events.length).toBeGreaterThan(n) // onHead fired for the reopened copy
    expect(status(h).kind).toBe('following')
    expect(await statuses(kv, id)).toEqual(['confirmed'])
    await registry.close(id)
  })

  test('a queued lock request takes over the moment the other tab lets go, with no sync asked for', async () => {
    const kv = createKv()
    const id = crypto.randomUUID()
    await leavePending(kv, id)
    const waits: { fn: () => Promise<void>; signal: AbortSignal }[] = []
    const { registry } = env({ kv, lock: () => false, lockWait: (_n, fn, signal) => void waits.push({ fn, signal }) })
    const h = await registry.open(id)
    const ap = h.approach as any
    expect(ap.canWrite()).toBe('Open in another tab: changes are made there.')
    await syncNow(h); await syncNow(h)
    expect(waits.length).toBe(1) // one waiting request, however many syncs
    void waits[0]!.fn() // the browser grants the lock
    for (let i = 0; i < 100 && ap.canWrite(); i++) await new Promise((r) => setTimeout(r, 50))
    expect(ap.canWrite()).toBeUndefined()
    await registry.close(id)
    expect(waits[0]!.signal.aborted).toBe(true) // released on dispose
  })

  test('a rejected locks.request is treated as not granted and does not hang sync', async () => {
    const nav = globalThis.navigator as any
    Object.defineProperty(nav, 'locks', { configurable: true, value: { request: () => Promise.reject(new Error('SecurityError')) } })
    const warn = console.warn
    console.warn = () => {}
    try {
      const { registry } = env({ kv: createKv() })
      const h = await addFollower(registry, { name: 'd', follows: follows() })
      expect(status(h).kind).toBe('following')
      expect((h.approach as any).canWrite()).toBe('Open in another tab: changes are made there.')
      await registry.remove(h.info.id)
    } finally { console.warn = warn; delete nav.locks }
  })

  test('a lock not free at open (the closing tab is still handing it over) is asked for once more', async () => {
    let asks = 0
    const { registry } = env({ kv: createKv(), lock: () => ++asks > 1 })
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    expect(asks).toBe(2)
    expect((h.approach as any).canWrite()).toBeUndefined()
    await registry.remove(h.info.id)
  })

  test('openWaiting opens the follower chains with stored pending txs, which then send them', async () => {
    const kv = createKv()
    const id = crypto.randomUUID()
    await leavePending(kv, id)
    const { registry } = env({ kv, lock: () => true })
    await registry.putFollower({ id: crypto.randomUUID(), name: 'idle', createdAt: new Date().toISOString(), follows: follows(), contracts: [] }) // nothing stored: stays closed
    await registry.openWaiting()
    expect(registry.liveCount()).toBe(1)
    const h = registry.peek(id)!
    await syncNow(h)
    expect(await statuses(kv, id)).toEqual(['confirmed'])
    await registry.close(id)
  })

  test('openWaiting leaves a slot under the live-chain limit; what it skips is still in the store', async () => {
    const kv = createKv()
    const id = crypto.randomUUID()
    await leavePending(kv, id)
    const { registry } = env({ kv, lock: () => true })
    const others = []
    for (let i = 0; i < LIVE_MAX - 1; i++) others.push(await registry.create(`c${i}`, 'plain', []))
    await registry.openWaiting()
    expect(registry.peek(id)).toBeUndefined()
    expect((await storedTxs(kv, [{ id, name: 'd' }])).map((c) => c.txs.map((t) => t.status))).toEqual([['pending']])
    for (const c of others) await registry.remove(c.info.id)
  })

  test('unsentChanges counts pending records per follower chain', async () => {
    const kv = createKv()
    const id = crypto.randomUUID()
    await leavePending(kv, id)
    expect(await unsentChanges(kv, [{ id, name: 'phone chain' }, { id: 'other', name: 'x' }])).toEqual([{ name: 'phone chain', count: 1 }])
    expect(unsentWarning([{ name: 'a', count: 2 }, { name: 'b', count: 1 }])).toBe('3 unsent changes on a, b will be lost.')
    expect(unsentWarning([])).toBeUndefined()
  })

  test('the Delete confirm warns about unsent changes like New/Open', async () => {
    const kv = createKv()
    const id = crypto.randomUUID()
    await leavePending(kv, id)
    expect(await deletePrompt(kv, { id, name: 'phone chain' })).toBe('Delete chain "phone chain"? 1 unsent changes on phone chain will be lost.')
    expect(await deletePrompt(kv, { id: 'other', name: 'x' })).toBe('Delete chain "x"?')
  })
})

describe('writing from a follower', () => {
  const ap = (h: { approach: unknown }) => h.approach as any
  const nonceOf = async (h: { request(m: string, p?: unknown[]): Promise<unknown> }, a: string) => Number(BigInt((await h.request('eth_getTransactionCount', [a, 'latest'])) as string))
  const sign = (from: LocalAccount, nonce: number, to = phone.address) =>
    from.signTransaction({ type: 'eip1559', chainId: 31337, nonce, to, value: 0n, gas: 30_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
  const until = async (ok: () => boolean) => { for (let i = 0; !ok(); i++) { if (i > 400) throw new Error('timed out'); await Bun.sleep(5) } }
  const down = () => { globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch }
  /** a fresh key joined to the chain with `grants` */
  async function member(grants: number) {
    const k = privateKeyToAccount(generatePrivateKey()), c = adminClient(), code = generateCode()
    await c.submit(cid, [await inviteTx(admin, await c.nonce(cid), access, code, 600, 1, grants)])
    await new NodeClient(url, k).join(cid, await claimTx(k, 0, code, access))
    return k
  }
  const withKey = (k: LocalAccount) => (a: `0x${string}`) => (a === k.address ? { account: k, label: 'tablet' } : keys.get(a))

  test("a writer follower's send returns the local receipt at once and counts as pending", async () => {
    const { registry } = env({ lock: () => true })
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    const raw = await sign(admin, await nonceOf(h, admin.address))
    // a sync stuck on a dead network
    const held: (() => void)[] = []
    globalThis.fetch = ((...a: Parameters<typeof fetch>) => new Promise((res, rej) => held.push(() => void realFetch(...a).then(res, rej)))) as typeof fetch
    const stuck = syncNow(h)
    await until(() => held.length > 0)
    const t0 = performance.now()
    const r = await h.send(raw)
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(r).toMatchObject({ hash: keccak256(raw), status: 'success' })
    expect(h.approach.pending!()).toBe(1)
    expect(ap(h).pendingTxs().map((t: any) => t.status)).toEqual(['pending'])
    globalThis.fetch = realFetch
    held.forEach((f) => f())
    await stuck
    await registry.remove(h.info.id)
  })

  test('settled records update pending() and notify', async () => {
    const { registry, events } = env({ lock: () => true })
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    const n = events.length
    await h.send(await sign(admin, await nonceOf(h, admin.address)))
    expect(events.length).toBeGreaterThan(n) // the new pending record
    const m = events.length
    await syncNow(h)
    await syncNow(h) // after the one the send started
    expect(h.approach.pending!()).toBe(0)
    expect(ap(h).pendingTxs().map((t: any) => t.status)).toEqual(['confirmed'])
    expect(events.length).toBeGreaterThan(m)
    await registry.remove(h.info.id)
  })

  test('a reader follower\'s send throws "This device can only read <name>."', async () => {
    const reader = await member(GRANT_READER)
    const { registry } = env({ lock: () => true, account: withKey(reader) })
    const h = await addFollower(registry, { name: 'Shop', follows: follows(reader.address) })
    expect(ap(h).canWrite()).toBe('This device can only read Shop.')
    expect(ap(h).notice()).toBe('This device can only read Shop.')
    await expect(h.send(await sign(reader, 0))).rejects.toThrow('This device can only read Shop.')
    expect(h.approach.pending!()).toBe(0)
    await registry.remove(h.info.id)
  })

  test("a device without deploy: a creation send throws the local message, a call goes through", async () => {
    const w = await member(GRANT_WRITER | GRANT_READER)
    const { registry } = env({ lock: () => true, account: withKey(w) })
    const h = await addFollower(registry, { name: 'Shop', follows: follows(w.address) })
    const create = await w.signTransaction({ type: 'eip1559', chainId: 31337, nonce: 1, data: '0x00', value: 0n, gas: 100_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
    await expect(h.send(create)).rejects.toThrow("This device can't deploy contracts on Shop.")
    expect(h.approach.pending!()).toBe(0)
    await h.send(await sign(w, 1))
    expect(h.approach.pending!()).toBe(1)
    await registry.remove(h.info.id)
  })

  test('a deploy refused locally is re-read: after the admin grants deploy, the next creation goes through', async () => {
    const w = await member(GRANT_WRITER | GRANT_READER)
    const { registry } = env({ lock: () => true, account: withKey(w) })
    const h = await addFollower(registry, { name: 'Shop', follows: follows(w.address) })
    const create = (nonce: number) => w.signTransaction({ type: 'eip1559', chainId: 31337, nonce, data: '0x00', value: 0n, gas: 100_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
    await expect(h.send(await create(1))).rejects.toThrow("can't deploy contracts on Shop")
    const c = adminClient()
    await c.submit(cid, [await accessTx(admin, await c.nonce(cid), access, 'addDeployer', w.address)])
    await syncNow(h)
    await h.send(await create(1))
    expect(h.approach.pending!()).toBe(1)
    await registry.remove(h.info.id)
  })

  test('a malformed raw tx is not refused by the local deploy check', async () => {
    const w = await member(GRANT_WRITER | GRANT_READER)
    const { registry } = env({ lock: () => true, account: withKey(w) })
    const h = await addFollower(registry, { name: 'Shop', follows: follows(w.address) })
    await syncNow(h) // deploy === false is known before the malformed send
    await h.send(await sign(w, 1)).catch(() => {})
    await expect(h.send('0xdeadbeef' as never)).rejects.toThrow(/invalid RLP/) // the local node's refusal, not the pre-check's parse error
    await registry.remove(h.info.id)
  })

  test('deploy removed with a creation pending: it settles refused with the reason, the call is unaffected', async () => {
    const w = await member(GRANT_WRITER | GRANT_READER | GRANT_DEPLOY)
    const { registry } = env({ lock: () => true, account: withKey(w) })
    const h = await addFollower(registry, { name: 'Shop', follows: follows(w.address) })
    const c = adminClient()
    await c.submit(cid, [await accessTx(admin, await c.nonce(cid), access, 'removeDeployer', w.address)])
    const create = await w.signTransaction({ type: 'eip1559', chainId: 31337, nonce: 1, data: '0x00', value: 0n, gas: 100_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
    await h.send(create)
    await h.send(await sign(w, 2))
    await syncNow(h)
    await syncNow(h)
    const txs = ap(h).pendingTxs()
    expect(txs.find((t: any) => t.status === 'refused')).toMatchObject({ status: 'refused', reason: `${w.address.toLowerCase()} can't deploy contracts on this chain` })
    expect(txs.filter((t: any) => t.status === 'refused')).toHaveLength(1)
    expect(txs.map((t: any) => t.status)).toContain('confirmed') // the call, re-signed at the nonce the refusal freed
    expect(ap(h).canWrite()).toBeUndefined() // still a writer
    const create2 = await w.signTransaction({ type: 'eip1559', chainId: 31337, nonce: 3, data: '0x00', value: 0n, gas: 100_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
    await expect(h.send(create2)).rejects.toThrow("This device can't deploy contracts on Shop.") // learned from the refusal
    await registry.remove(h.info.id)
  })

  test('a writer removed from the write list: its send is refused by the cloud, then the device knows it can only read', async () => {
    const w = await member(GRANT_WRITER | GRANT_READER)
    const { registry } = env({ lock: () => true, account: withKey(w) })
    const h = await addFollower(registry, { name: 'Shop', follows: follows(w.address) })
    expect(ap(h).canWrite()).toBeUndefined()
    const c = adminClient()
    await c.submit(cid, [await accessTx(admin, await c.nonce(cid), access, 'removeWriter', w.address)])
    await h.send(await sign(w, await nonceOf(h, w.address)))
    await syncNow(h)
    await syncNow(h)
    expect(ap(h).pendingTxs()[0]).toMatchObject({ status: 'refused', reason: `${w.address} is not a writer on this chain` })
    expect(ap(h).canWrite()).toBe('This device can only read Shop.')
    await registry.remove(h.info.id)
  })

  test("a refused nonce re-sign uses the browser account's key", async () => {
    const k = privateKeyToAccount(generatePrivateKey()) // a page's account, not the device key
    let asked = 0
    const { registry } = env({ lock: () => true, account: (a) => (a === k.address ? (asked++, { account: k, label: 'k' }) : keys.get(a)) })
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    down()
    const raw = await sign(k, 0)
    await h.send(raw)
    await syncNow(h) // offline: still pending
    globalThis.fetch = realFetch
    await adminClient().submit(cid, [await sign(k, 0, admin.address)]) // k's nonce 0 used on another device first
    await syncNow(h)
    const [t] = ap(h).pendingTxs()
    expect(t).toMatchObject({ status: 'confirmed', nonce: 1 })
    expect(t.hash).not.toBe(keccak256(raw))
    expect(asked).toBeGreaterThan(0)
    await registry.remove(h.info.id)
  })

  test('dismiss clears a conflicted record', async () => {
    const kv = createKv()
    const id = crypto.randomUUID()
    const { registry, events } = env({ kv, lock: () => true })
    await registry.putFollower({ id, name: 'd', createdAt: new Date().toISOString(), follows: follows(), contracts: [] })
    const hash = `0x${'cd'.repeat(32)}` as const
    await kvFollowerStore(kv).putPending(id, { hash, raw: '0x00', from: admin.address, nonce: 0, seq: 0, status: 'conflicted', block: 1, settledAt: 1,
      first: { status: 'success', logs: [] }, cloud: { status: 'reverted', logs: [] } })
    const h = await registry.open(id)
    expect(pendingSummary(ap(h).pendingTxs())).toEqual({ pending: 0, conflicted: 1 })
    const n = events.length
    await ap(h).dismiss(hash)
    expect(ap(h).pendingTxs()).toEqual([])
    expect(events.length).toBeGreaterThan(n)
    expect(await kvFollowerStore(kv).listPending(id)).toEqual([])
    await registry.remove(id)
  })

  test('a chain deleted in the cloud (404): status gone, pending refused and dismissable, sends refused', async () => {
    const { registry } = env({ lock: () => true })
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    down()
    await h.send(await sign(admin, await nonceOf(h, admin.address)))
    await syncNow(h)
    await syncNow(h) // offline: still pending
    globalThis.fetch = (async () => Response.json({ error: 'no such chain' }, { status: 404 })) as unknown as typeof fetch
    await syncNow(h)
    expect(status(h)).toEqual({ kind: 'gone', detail: 'This chain no longer exists' })
    const [t] = ap(h).pendingTxs()
    // the offline submit may have reached the cloud, so the reason says so
    expect(t).toMatchObject({ status: 'refused', reason: 'chain deleted in the cloud — it may have been mined before it was deleted' })
    expect(h.approach.pending!()).toBe(0)
    expect(ap(h).canWrite()).toBe('This chain no longer exists')
    await expect(h.send(await sign(admin, 0))).rejects.toThrow('This chain no longer exists')
    await ap(h).dismiss(t.hash)
    expect(ap(h).pendingTxs()).toEqual([])
    await registry.remove(h.info.id)
  })

  test('with a stored copy, open returns without waiting on a hanging network; reads and sends work; a timeout is offline', async () => {
    const kv = createKv()
    const a = env({ kv, lock: () => true })
    const h1 = await addFollower(a.registry, { name: 'd', follows: follows() })
    const id = h1.info.id
    await a.registry.close(id)
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch // a network that never answers
    const { registry } = env({ kv, lock: () => true })
    const h = await Promise.race([registry.open(id), Bun.sleep(2000).then(() => { throw new Error('open waited on the network') })])
    expect(await bn(h)).toBeGreaterThanOrEqual(0)
    const r = await Promise.race([h.send(await sign(admin, await nonceOf(h, admin.address))), Bun.sleep(2000).then(() => { throw new Error('send waited on the network') })])
    expect(r.status).toBe('success')
    expect(await statuses(kv, id)).toEqual(['pending'])
    // the client's timeout, as a browser reports it
    globalThis.fetch = (async () => { throw new DOMException('The operation timed out.', 'TimeoutError') }) as unknown as typeof fetch
    // h's first sync stays hung (until the client's 30 s timeout): check the classification on a second open
    const b = env({ kv, lock: () => true })
    const h2 = await b.registry.open(id)
    await syncNow(h2)
    expect(status(h2)).toMatchObject({ kind: 'offline' })
    expect((status(h2) as any).detail).toMatch(/^Offline — last synced .+\. Changes are kept and sent when you're back\.$/)
    globalThis.fetch = (async () => { throw new DOMException('aborted', 'AbortError') }) as unknown as typeof fetch
    await syncNow(h2)
    expect(status(h2)).toMatchObject({ kind: 'offline' })
    await b.registry.close(id)
  })

  test('a store write that fails during a re-sign throws (kv strict); after a reload the transfer is mined exactly once', async () => {
    const kv = createKv()
    const k = privateKeyToAccount(generatePrivateKey())
    const keyed = (a: `0x${string}`) => (a === k.address ? { account: k, label: 'k' } : keys.get(a))
    const { registry } = env({ kv, lock: () => true, account: keyed })
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    const id = h.info.id
    down()
    const raw = await sign(k, 0)
    await h.send(raw)
    await syncNow(h); await syncNow(h) // offline: pending
    globalThis.fetch = realFetch
    await adminClient().submit(cid, [await sign(k, 0, admin.address)]) // k's nonce 0 used on another device first
    // IndexedDB fails from the re-sign on (only a strict write sees it: a lax one drops to memory and resolves)
    const set = kv.set
    kv.set = async (s, key, v, opts) => {
      if (s.startsWith('followerPending') && (v as any).nonce === 1) { if (opts?.strict) throw new Error('QuotaExceededError'); return }
      return set(s, key, v, opts)
    }
    await syncNow(h)
    expect(status(h)).toEqual({ kind: 'unreachable', detail: 'QuotaExceededError' }) // the failed write surfaced, as itself
    expect((await statuses(kv, id))).toEqual(['pending']) // the stored record is still the nonce-0 tx
    await registry.close(id) // "reload"
    kv.set = set
    const b = env({ kv, lock: () => true, account: keyed })
    const h2 = await b.registry.open(id)
    await syncNow(h2); await syncNow(h2)
    expect(ap(h2).pendingTxs().map((t: any) => [t.status, t.nonce])).toEqual([['confirmed', 1]])
    // mined once: k sent nonce 0 (other device) and nonce 1 (this transfer), nothing more
    expect(await nonceOf(h2, k.address)).toBe(2)
    await b.registry.remove(id)
  })

  test('memory-fallback kv: a follower still stores and sends (writes go to memory)', async () => {
    const kv = createKv()
    expect(kv.persistent).toBe(false)
    const { registry } = env({ kv, lock: () => true })
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    await h.send(await sign(admin, await nonceOf(h, admin.address)))
    expect(await statuses(kv, h.info.id)).toEqual(['pending'])
    await syncNow(h); await syncNow(h)
    expect(await statuses(kv, h.info.id)).toEqual(['confirmed'])
    await registry.remove(h.info.id)
  })

  test('a 404 other than the worker\'s "no such chain" (a proxy, an unknown route) keeps txs pending: unreachable, not gone', async () => {
    const { registry } = env({ lock: () => true })
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    await h.send(await sign(admin, await nonceOf(h, admin.address)))
    globalThis.fetch = (async () => new Response('<html>Not Found</html>', { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch
    await syncNow(h); await syncNow(h)
    expect(status(h)).toEqual({ kind: 'unreachable', detail: `${url}: Not Found` }) // retrying, not gone
    expect(ap(h).pendingTxs().map((t: any) => t.status)).toEqual(['pending'])
    expect(ap(h).canWrite()).toBeUndefined()
    globalThis.fetch = realFetch
    await syncNow(h); await syncNow(h)
    expect(ap(h).pendingTxs().map((t: any) => t.status)).toEqual(['confirmed'])
    await registry.remove(h.info.id)
  })
})
