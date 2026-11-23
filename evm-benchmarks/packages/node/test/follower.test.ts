import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ChainHost, handle, type ChainHandleLike } from '../src/router'
import { NodeClient, accessTx, claimTx, inviteTx, setupTxs, GRANT_READER } from '../src/client'
import { Follower, FollowerRemoved } from '../src/follower'
import { bunSql } from './bunSql'
import { wasm } from './workload'
import { createNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'

const acct = (n: string) => privateKeyToAccount(keccak256(toBytes(n)))
const admin = acct('f-admin'), phone = acct('f-phone')
const hosts = new Map<string, ChainHost>()
const chainHost = (id: string): ChainHandleLike => {
  let h = hosts.get(id)
  if (!h) hosts.set(id, (h = new ChainHost(bunSql(), wasm, { rootAdmin: admin.address, chain: chainHost })))
  return h
}
let srv: ReturnType<typeof Bun.serve>, url: string, access: `0x${string}`, cid: string
const as = (a: typeof admin, name?: string) => new NodeClient(url, a, { name })
const followers: Follower[] = []
const open = async (c: NodeClient) => {
  const f = await Follower.open(c, cid, wasm)
  followers.push(f)
  return f
}
/** n admin blocks, one setReadOpen tx each */
const mineBlocks = async (n: number) => {
  const a = as(admin)
  for (let i = 0; i < n; i++) await a.submit(cid, [await accessTx(admin, await a.nonce(cid), access, 'setReadOpen', false)])
}
const cloudHead = async () => (await as(admin).state(cid)).head

beforeAll(async () => {
  srv = Bun.serve({ port: 0, fetch: (r) => handle(r, { chain: chainHost }) })
  url = `http://localhost:${srv.port}`
  const n = await createNode({ chainId: 31337, computeStateRoot: true, miningConfig: { type: 'manual' }, engine: await createRevmEngine({ wasm }) })
  const dump = await n.dumpState()
  await n.dispose()
  cid = (await as(admin).createChain({ dump, setup: await setupTxs(admin, 0, 31337) })).chainId
  access = (await as(admin).info(cid)).access
  // the cloud node rebuilds every 100 blocks, so following crosses rebuild boundaries (rebuildEvery is not a ChainHost option)
  ;(hosts.get(cid)!.service as any).node.cfg.rebuildEvery = 100
})
afterAll(async () => {
  for (const f of followers) await f.dispose()
  for (const h of hosts.values()) await (h.service as any)?.node.dispose()
  srv.stop(true)
})

describe('Follower', () => {
  test('follows 250 admin-submitted blocks across pages and rebuild boundaries (rebuildEvery 100 on the cloud side) with matching root and hash', async () => {
    const f = await open(as(admin, 'laptop'))
    expect(f.head).toEqual(await cloudHead())
    await mineBlocks(120)
    expect(await f.sync()).toEqual(await cloudHead()) // two pages, past the first rebuild
    await mineBlocks(130)
    const head = await f.sync() // two pages, past the second rebuild
    expect(head).toEqual(await cloudHead())
    expect(head.number).toBeGreaterThanOrEqual(251)
    expect(await f.read((n) => n.getStateRoot())).toBe(head.stateRoot)
    expect(f.status).toBe('following')
    expect((hosts.get(cid)!.service as any).node.blocksSinceRebuild).toBeLessThan(100) // the cloud node did rebuild
  }, 120_000)

  let reader: Follower
  test('a joined reader follows', async () => {
    const a = as(admin)
    await a.submit(cid, [await inviteTx(admin, await a.nonce(cid), access, 'phone-code', 600, 1, GRANT_READER)])
    const p = as(phone, 'phone')
    await p.join(cid, await claimTx(phone, 0, 'phone-code', access))
    reader = await open(p)
    await mineBlocks(3)
    expect(await reader.sync()).toEqual(await cloudHead())
  })

  test('after removal, sync → FollowerRemoved and read throws', async () => {
    const a = as(admin), f = reader
    await a.submit(cid, [await accessTx(admin, await a.nonce(cid), access, 'removeReader', phone.address)])
    const e = await f.sync().catch((x) => x)
    expect(e).toBeInstanceOf(FollowerRemoved)
    expect(f.status).toBe('removed')
    expect(await f.sync().catch((x) => x)).toBe(e)
    await expect(f.read((n) => n.getStateRoot())).rejects.toBe(e)
  })

  test('a tampered block (test stub returning a wrong stateRoot) → mismatch', async () => {
    const real = as(admin)
    const bad = '0x' + '11'.repeat(32)
    const stub = {
      state: (id: string) => real.state(id),
      blocks: async (id: string, after: number) => {
        const r = await real.blocks(id, after)
        if (r.blocks[0]) r.blocks[0].header.stateRoot = bad
        return r
      },
    } as unknown as NodeClient
    const f = await open(stub)
    await mineBlocks(1)
    const e = await f.sync().catch((x) => x)
    expect(f.status).toBe('mismatch')
    expect(e.message).toContain(`block ${f.head.number + 1}`)
    expect(e.message).toContain(bad)
    expect(e.message).toContain((await cloudHead()).stateRoot)
    expect(await f.sync().catch((x) => x)).toBe(e)
    await expect(f.read((n) => n.getStateRoot())).rejects.toBe(e)
  })
})
