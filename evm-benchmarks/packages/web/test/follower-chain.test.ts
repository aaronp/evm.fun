import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { LocalAccount } from 'viem'
import { ChainHost, handle, type ChainHandleLike } from '@evmb/node/src/router'
import { GRANT_READER, NodeClient, accessTx, claimTx, generateCode, inviteTx, setupTxs } from '@evmb/node/src/client'
import { bunSql } from '@evmb/node/test/bunSql'
import { freshDump, wasm } from '@evmb/node/scripts/bootstrap'
import { createKv } from '../src/store/kv'
import { createChainRegistry, LIVE_MAX } from '../src/chain/registry'
import { createContractsRegistry } from '../src/contracts/registry'
import { createWebAssets } from '../src/assets/registry'
import type { FollowerStatus } from '../src/cloud/followerChain'
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
function env(o: { wasm?: () => Promise<any>; account?: (a: `0x${string}`) => { account: LocalAccount; label: string } | undefined } = {}) {
  const kv = createKv()
  const keySubs = new Set<() => void>()
  const stores = new Map<string, any>()
  const events: string[] = []
  const registry = createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
    purge: async (id: string) => void stores.delete(id),
    follower: { wasm: o.wasm ?? (async () => wasm), account: o.account ?? ((a) => keys.get(a)), onAccountsChange: (cb) => (keySubs.add(cb), () => void keySubs.delete(cb)) },
  })
  registry.watch((id) => events.push(id))
  return { kv, stores, registry, events, keysChanged: () => keySubs.forEach((cb) => cb()) }
}
const follows = (account = admin.address, chainId = cid) => ({ nodeUrl: url, chainId, account })
const status = (h: { approach: unknown }) => (h.approach as { status(): FollowerStatus }).status()
const syncNow = (h: { approach: unknown }) => (h.approach as { syncNow(): Promise<void> }).syncNow()
const bn = async (h: { request(m: string, p?: unknown[]): Promise<unknown> }) => Number(BigInt((await h.request('eth_blockNumber', [])) as string))

describe('follower chains', () => {
  test('addFollower opens at the cloud head and eth_blockNumber/eth_getBalance answer', async () => {
    const { registry, kv, events } = env()
    const h = await registry.addFollower({ name: 'deployed', follows: follows() })
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

  test('send on a follower throws the read-only reason; mine and snapshot too', async () => {
    const { registry } = env()
    const h = await registry.addFollower({ name: 'd', follows: follows() })
    const why = `Read-only until B: this chain lives on ${url}`
    await expect(h.send('0x00')).rejects.toThrow(why)
    await expect(h.mine(1)).rejects.toThrow(why)
    await expect(h.approach.snapshot!()).rejects.toThrow(why)
    await expect(h.approach.restore!({})).rejects.toThrow(why)
    await registry.remove(h.info.id)
  })

  test('syncNow picks up blocks the admin submits', async () => {
    const { registry } = env()
    const h = await registry.addFollower({ name: 'd', follows: follows() })
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
    const h = await registry.addFollower({ name: 'd', follows: follows(phone.address) })
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
    const h = await registry.addFollower({ name: 'd', follows: follows() })
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
    const h = await registry.addFollower({ name: 'd', follows: follows() })
    expect(status(h).kind).toBe('unreachable')
    await syncNow(h)
    expect(status(h)).toMatchObject({ kind: 'following', behind: 0 })
    expect(n).toBe(2)
    await registry.remove(h.info.id)
  })

  test('no status or head events from a poll that finds nothing new', async () => {
    const { registry, events } = env()
    const h = await registry.addFollower({ name: 'd', follows: follows() })
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
      const h = await registry.addFollower({ name: 'd', follows: follows() })
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
    const h = await registry.addFollower({ name: 'd', follows: follows(stranger) })
    await syncNow(h)
    expect(status(h)).toEqual({ kind: 'needs-key', detail: `Needs ${stranger}'s key` })
    expect(calls).toBe(0)
    await expect(h.request('eth_blockNumber', [])).rejects.toThrow(`Needs ${stranger}'s key`)
    await registry.remove(h.info.id)
  })

  test('network error → unreachable, then following again', async () => {
    const { registry } = env()
    const h = await registry.addFollower({ name: 'd', follows: follows() })
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    await syncNow(h)
    expect(status(h)).toMatchObject({ kind: 'unreachable', detail: `Can't reach ${url}` })
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
    const h = await registry.addFollower({ name: 'd', follows: follows() })
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
    const h = await registry.addFollower({ name: 'd', follows: follows() })
    globalThis.fetch = (async () => Response.json({ error: 'stale request' }, { status: 401 })) as unknown as typeof fetch
    await syncNow(h)
    expect(status(h)).toMatchObject({ kind: 'clock' })
    globalThis.fetch = realFetch
    const gone = await registry.addFollower({ name: 'g', follows: follows(admin.address, 'no-such-chain') })
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
