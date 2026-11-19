import { test, expect } from 'bun:test'
import { createKv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'
import { createSnapshotStore } from '../src/chain/snapshots'
import { createContractsRegistry } from '../src/contracts/registry'
import { createWebAssets } from '../src/assets/registry'
import type { Asset } from '@evmb/assets'

const ADDR = '0x00000000000000000000000000000000000000aa' as const
const ADDR2 = '0x00000000000000000000000000000000000000bb' as const
const tok = (chainId: string, address: `0x${string}` = ADDR): Asset => ({
  id: `${chainId}:${address}`, chainId, kind: 'erc20', address, symbol: 'GBP', name: 'Pound', decimals: 6,
  origin: 'launched', mintable: true, addedAt: '2026-11-19T00:00:00Z',
})
const source = { kind: 'snapshot', snapshotName: 's', fromChainName: 'orig', height: 0 } as const

function env() {
  const stores = new Map<string, any>()
  const kv = createKv()
  const deps = (over: object = {}) => ({
    kv,
    host: (id: string) => ({
      persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) },
    }),
    purge: async (id: string) => void stores.delete(id),
    ...over,
  })
  return { kv, deps, assets: createWebAssets(kv) }
}

test('snapshot then fork: fork has the token under its own id, parent unchanged', async () => {
  const e = env()
  const reg = createChainRegistry(e.deps())
  const h = await reg.create('orig', 'plain', [])
  await e.assets.add(tok(h.info.id))
  const s = await createSnapshotStore(e.kv).take(h)
  expect(s.assets.map(a => a.address)).toEqual([ADDR])
  const f = await reg.createFrom(s.dump, { name: 'fork', type: 'plain', contracts: [], assets: s.assets, source })
  const fl = (await e.assets.list(f.info.id)).filter(a => a.kind === 'erc20')
  expect(fl.map(a => [a.id, a.chainId])).toEqual([[`${f.info.id}:${ADDR}`, f.info.id]])
  expect((await e.assets.list(h.info.id)).filter(a => a.kind === 'erc20').map(a => a.id)).toEqual([`${h.info.id}:${ADDR}`])
  await f.dispose(); await h.dispose()
})

test('restore drops an asset added after the snapshot', async () => {
  const e = env()
  const reg = createChainRegistry(e.deps())
  const h = await reg.create('orig', 'plain', [])
  await e.assets.add(tok(h.info.id))
  const s = await createSnapshotStore(e.kv).take(h)
  await e.assets.add(tok(h.info.id, ADDR2))
  await reg.restoreTo(h.info.id, s, { saveFirst: false })
  expect((await e.assets.list(h.info.id)).filter(a => a.kind === 'erc20').map(a => a.address)).toEqual([ADDR])
  // an old snapshot with no assets restores to none
  await reg.restoreTo(h.info.id, { ...s, assets: undefined } as any, { saveFirst: false })
  expect((await e.assets.list(h.info.id)).filter(a => a.kind === 'erc20')).toEqual([])
  await h.dispose()
})

test('remove deletes contract and asset rows', async () => {
  const e = env()
  const reg = createChainRegistry(e.deps())
  const h = await reg.create('orig', 'plain', [])
  await createContractsRegistry(e.kv).add(h.info.id, { address: ADDR, name: 'C', abi: [], deployer: ADDR, txHash: `0x${'1'.repeat(64)}` })
  await e.assets.add(tok(h.info.id))
  await reg.remove(h.info.id)
  expect(await e.kv.list(`contracts:${h.info.id}`)).toEqual([])
  expect(await e.kv.list(`assets:${h.info.id}`)).toEqual([])
})

test('createFrom rollback leaves no assets rows', async () => {
  const e = env()
  const reg = createChainRegistry(e.deps())
  const src = await reg.create('orig', 'plain', [])
  const dump = await src.approach.snapshot!()
  await src.dispose()
  const seen: string[] = []
  const kv = { ...e.kv, set: async (ns: string, k: string, v: unknown, o?: any) => {
    if (ns === 'chains') throw new Error('disk full')
    if (ns.startsWith('assets:')) seen.push(ns)
    return e.kv.set(ns, k, v, o)
  } } as typeof e.kv
  const r2 = createChainRegistry(e.deps({ kv }))
  await expect(r2.createFrom(dump, { name: 'f', type: 'plain', contracts: [], assets: [tok('x')], source })).rejects.toThrow('disk full')
  expect(seen.length).toBe(1)
  for (const ns of seen) expect(await e.kv.list(ns)).toEqual([])
})
