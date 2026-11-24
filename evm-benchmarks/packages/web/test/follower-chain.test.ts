import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { keccak256, type LocalAccount } from 'viem'
import { ChainHost, handle, type ChainHandleLike } from '@evmb/node/src/router'
import { GRANT_READER, GRANT_WRITER, NodeClient, accessTx, claimTx, generateCode, inviteTx, setupTxs } from '@evmb/node/src/client'
import { bunSql } from '@evmb/node/test/bunSql'
import { freshDump, wasm } from '@evmb/node/scripts/bootstrap'
import { Follower } from '@evmb/node/src/follower'
import { kvFollowerStore, storedTxs, unsentChanges, unsentWarning } from '../src/cloud/followerStore'
import { createKv } from '../src/store/kv'
import { createChainRegistry, LIVE_MAX } from '../src/chain/registry'
import { createContractsRegistry } from '../src/contracts/registry'
import { createWebAssets } from '../src/assets/registry'
import { pendingSummary, type FollowerStatus } from '../src/cloud/followerChain'
import { getSyncInterval, setSyncInterval } from '../src/cloud/node'

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
  setSyncInterval(5)
})

const keys = new Map<string, { account: LocalAccount; label: string }>([[admin.address, { account: admin, label: 'laptop' }], [phone.address, { account: phone, label: 'phone' }]])
function env(o: { kv?: ReturnType<typeof createKv>; lock?: () => boolean; wasm?: () => Promise<any>; account?: (a: `0x${string}`) => { account: LocalAccount; label: string } | undefined } = {}) {
  const kv = o.kv ?? createKv()
  const keySubs = new Set<() => void>()
  const stores = new Map<string, any>()
  const events: string[] = []
  const registry = createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
    purge: async (id: string) => void stores.delete(id),
    follower: { lock: o.lock, wasm: o.wasm ?? (async () => wasm), account: o.account ?? ((a) => keys.get(a)), onAccountsChange: (cb) => (keySubs.add(cb), () => void keySubs.delete(cb)) },
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

  test('hiding the tab drops the timer; showing it re-arms', async () => {
    let state = 'visible', listener: (() => void) | undefined
    g.document = { get visibilityState() { return state }, addEventListener: (_: string, f: () => void) => (listener = f), removeEventListener: () => (listener = undefined) }
    try {
      const { registry } = env()
      jest.useFakeTimers()
      const h = await addFollower(registry, { name: 'd', follows: follows() })
      expect(jest.getTimerCount()).toBe(1)
      state = 'hidden'
      listener!()
      expect(jest.getTimerCount()).toBe(0)
      state = 'visible'
      listener!()
      expect(jest.getTimerCount()).toBe(1)
      jest.useRealTimers()
      await registry.remove(h.info.id)
      expect(listener).toBeUndefined()
    } finally { delete g.document }
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

  test('the sync interval setting re-arms a running follower; manual stops the timer and syncNow still works', async () => {
    expect(getSyncInterval()).toBe(5)
    const { registry } = env()
    // the timer's syncs are seen as fetches (submits can't run under fake timers: the worker stand-in uses timers)
    let calls = 0
    globalThis.fetch = ((...a: Parameters<typeof fetch>) => (calls++, realFetch(...a))) as typeof fetch
    jest.useFakeTimers()
    const h = await addFollower(registry, { name: 'd', follows: follows() })
    expect(jest.getTimerCount()).toBe(1)
    setSyncInterval(15)
    expect(getSyncInterval()).toBe(15)
    expect(jest.getTimerCount()).toBe(1)
    const n = calls
    jest.advanceTimersByTime(5_000) // the old 5 s timer was replaced: still pending, nothing ran
    expect(jest.getTimerCount()).toBe(1)
    jest.advanceTimersByTime(10_000)
    expect(jest.getTimerCount()).toBe(0) // fired; re-armed once the sync lands
    await syncNow(h) // joins the timer's sync
    expect(calls).toBe(n + 1) // one GET /blocks
    expect(jest.getTimerCount()).toBe(1)
    setSyncInterval('manual')
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    await mineBlocks(1)
    await syncNow(h)
    expect(await bn(h)).toBe((await cloudHead()).number)
    expect(status(h)).toMatchObject({ kind: 'following', behind: 0 })
    await registry.remove(h.info.id)
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
  const statuses = async (kv: ReturnType<typeof createKv>, id: string) => (await kvFollowerStore(kv).listPending(id)).map((t) => t.status)
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
})
