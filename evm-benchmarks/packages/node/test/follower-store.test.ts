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
    await expect(Follower.open(offline, cid, wasm, { store })).rejects.toBeInstanceOf(FollowerMismatch)
  })
})
