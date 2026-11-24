import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { ChainHost, handle, type ChainHandleLike } from '../src/router'
import { NodeClient, accessTx, setupTxs } from '../src/client'
import { Follower, FollowerMismatch } from '../src/follower'
import { MemoryFollowerStore } from '../src/followerStore'
import { bunSql } from './bunSql'
import { wasm } from './workload'

const admin = privateKeyToAccount(keccak256(toBytes('fs-admin')))
const hosts = new Map<string, ChainHost>()
const chainHost = (id: string): ChainHandleLike => {
  let h = hosts.get(id)
  if (!h) hosts.set(id, (h = new ChainHost(bunSql(), wasm, { rootAdmin: admin.address, chain: chainHost })))
  return h
}
let srv: ReturnType<typeof Bun.serve>, client: NodeClient, access: `0x${string}`, cid: string
const followers: Follower[] = []
const keep = (f: Follower) => (followers.push(f), f)
const mine = async (n: number) => {
  for (let i = 0; i < n; i++) await client.submit(cid, [await accessTx(admin, await client.nonce(cid), access, 'setReadOpen', false)])
}
const offline = { state: async () => { throw new Error('network used') }, blocks: async () => { throw new Error('network used') } } as unknown as NodeClient

beforeAll(async () => {
  srv = Bun.serve({ port: 0, fetch: (r) => handle(r, { chain: chainHost }) })
  client = new NodeClient(`http://localhost:${srv.port}`, admin)
  const n = await createNode({ chainId: 31337, computeStateRoot: true, miningConfig: { type: 'manual' }, engine: await createRevmEngine({ wasm }) })
  const dump = await n.dumpState()
  await n.dispose()
  cid = (await client.createChain({ dump, setup: await setupTxs(admin, 0, 31337) })).chainId
  access = (await client.info(cid)).access
})
afterAll(async () => {
  for (const f of followers) await f.dispose()
  for (const h of hosts.values()) await (h.service as any)?.node.dispose()
  srv.stop(true)
})

describe('Follower with a store', () => {
  test('open without a stored copy boots from the cloud and stores it', async () => {
    const store = new MemoryFollowerStore()
    const f = keep(await Follower.open(client, cid, wasm, { store }))
    expect((await store.loadConfirmed(cid))?.head).toEqual(f.head)
  })

  test('sync stores the new confirmed head, bounded, and it reloads offline', async () => {
    const store = new MemoryFollowerStore()
    const f = keep(await Follower.open(client, cid, wasm, { store, key: 'k1' }))
    await mine(3)
    const head = await f.sync()
    const saved = (await store.loadConfirmed('k1'))!
    expect(saved.head).toEqual(head)
    expect(saved.dump.receipts).toEqual({})
    expect(saved.dump.transactions).toEqual({})
    const g = keep(await Follower.open(offline, cid, wasm, { store, key: 'k1' }))
    expect(g.head).toEqual(head)
  })

  test('open with a stored copy makes no request', async () => {
    const store = new MemoryFollowerStore()
    const f = keep(await Follower.open(client, cid, wasm, { store }))
    const g = keep(await Follower.open(offline, cid, wasm, { store }))
    expect(g.head).toEqual(f.head)
  })

  test('a stored copy with a wrong root is a FollowerMismatch', async () => {
    const store = new MemoryFollowerStore()
    await Follower.open(client, cid, wasm, { store }).then((f) => f.dispose())
    const c = (await store.loadConfirmed(cid))!
    await store.saveConfirmed(cid, { ...c, head: { ...c.head, stateRoot: `0x${'11'.repeat(32)}` } })
    await expect(Follower.open(offline, cid, wasm, { store })).rejects.toThrow(/network used/)
    await expect(Follower.open(offline, cid, wasm, { store })).rejects.toBeInstanceOf(FollowerMismatch)
  })

  test('a reopened-from-store follower syncs new cloud blocks to the cloud head', async () => {
    const store = new MemoryFollowerStore()
    keep(await Follower.open(client, cid, wasm, { store }))
    await mine(2)
    const g = keep(await Follower.open(offline, cid, wasm, { store }))
    ;(g as any).client = client // back online
    expect(await g.sync()).toEqual((await client.state(cid)).head)
    expect(await g.read((n) => n.getStateRoot())).toBe(g.head.stateRoot)
  })

  test('a failed save is retried by the next sync, even with an empty page', async () => {
    const store = new MemoryFollowerStore()
    const f = keep(await Follower.open(client, cid, wasm, { store }))
    await mine(1)
    const save = store.saveConfirmed.bind(store)
    let fail = true
    store.saveConfirmed = async (k, c) => { if (fail) { fail = false; throw new Error('disk full') } return save(k, c) }
    await expect(f.sync()).rejects.toThrow('disk full')
    const head = await f.sync()
    expect((await store.loadConfirmed(cid))?.head).toEqual(head)
  })

  test('open disposes the booted node when the first save throws', async () => {
    const store = new MemoryFollowerStore()
    store.saveConfirmed = async () => { throw new Error('disk full') }
    await expect(Follower.open(client, cid, wasm, { store })).rejects.toThrow('disk full')
  })

  test('an unusable stored copy falls back to the cloud and is overwritten', async () => {
    const store = new MemoryFollowerStore()
    await Follower.open(client, cid, wasm, { store }).then((f) => f.dispose())
    const c = (await store.loadConfirmed(cid))!
    await store.saveConfirmed(cid, { ...c, head: { ...c.head, stateRoot: `0x${'11'.repeat(32)}` } })
    const f = keep(await Follower.open(client, cid, wasm, { store }))
    expect((await store.loadConfirmed(cid))?.head).toEqual(f.head)
    expect(f.head.stateRoot).not.toBe(`0x${'11'.repeat(32)}`)
  })

  test('a stored head that disagrees with the dump is unusable', async () => {
    const store = new MemoryFollowerStore()
    await Follower.open(client, cid, wasm, { store }).then((f) => f.dispose())
    const c = (await store.loadConfirmed(cid))!
    await store.saveConfirmed(cid, { ...c, head: { ...c.head, hash: `0x${'22'.repeat(32)}` } })
    await expect(Follower.open(offline, cid, wasm, { store })).rejects.toThrow(/network used/)
  })

  test('the store returns copies, not live objects', async () => {
    const store = new MemoryFollowerStore()
    const tx = { hash: '0x01', raw: '0x', from: '0x00', nonce: 0, seq: 0, first: { status: 'success', logs: [] }, status: 'pending' } as any
    await store.putPending('k', tx)
    tx.status = 'confirmed'
    expect((await store.listPending('k'))[0]!.status).toBe('pending')
  })

  test('pending records are keyed by seq: a put with a new hash replaces, delete takes the seq', async () => {
    const store = new MemoryFollowerStore()
    const tx = { hash: '0x01', raw: '0x', from: '0x00', nonce: 0, seq: 3, first: { status: 'success', logs: [] }, status: 'pending' } as any
    await store.putPending('k', tx)
    await store.putPending('k', { ...tx, hash: '0x02', nonce: 1 })
    expect((await store.listPending('k')).map((t) => t.hash)).toEqual(['0x02'])
    await store.deletePending('k', 3)
    expect(await store.listPending('k')).toEqual([])
  })
})
