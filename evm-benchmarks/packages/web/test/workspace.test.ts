import { describe, test, expect } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { bookSchema, memoryStore, priceKey } from '@evmb/orderbook'
import { createKv } from '../src/store/kv'
import { createChainRegistry, LIVE_MAX } from '../src/chain/registry'
import { createSnapshotStore } from '../src/chain/snapshots'
import { createContractsRegistry } from '../src/contracts/registry'
import { createWebAssets } from '../src/assets/registry'
import { buildWorkspace, encodeWorkspace } from '../src/workspace/build'
import { validateWorkspace } from '../src/workspace/validate'
import type { WorkspaceFile } from '../src/workspace/types'
import { bundled } from '../walkthroughs'

const ENGINE = 'test-engine'
const KEY = `0x${'11'.repeat(32)}` as const
const acct = { label: 'alice', address: privateKeyToAccount(KEY).address, privateKey: KEY }
const B = '0x000000000000000000000000000000000000dEaD' as const
const sign = (nonce: number) => privateKeyToAccount(KEY).signTransaction({
  type: 'eip1559', chainId: 31337, nonce, to: B, value: 1n, gas: 21_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
})
const rec = { address: `0x${'12'.repeat(20)}` as const, name: 'Swap', abi: [], deployer: acct.address, txHash: `0x${'34'.repeat(32)}` as const }

function env() {
  const stores = new Map<string, any>()
  const kv = createKv()
  const registry = createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
    purge: async (id: string) => void stores.delete(id),
  })
  const local = new Map<string, string>()
  const book = memoryStore(bookSchema)
  const storage = { getItem: (k: string) => local.get(k) ?? null }
  const ws = { registry, kv, accounts: [acct], book, storage, engine: ENGINE }
  const disposeAll = async () => { for (const c of await registry.list()) await registry.peek(c.id)?.dispose() }
  return { kv, registry, local, book, ws, disposeAll }
}

describe('buildWorkspace', () => {
  test('includes accounts, saved chains with ids, records, snapshots, walkthroughs, order-book rows, selection — not benchmark chains', async () => {
    const e = env()
    const a = await e.registry.create('alpha', 'plain', [acct.address])
    await a.send(await sign(0))
    const b = await e.registry.create('beta', 'sequencer', [])
    const bench = await e.registry.create('bench', 'plain', [])
    await e.kv.del('chains', bench.info.id) // as addEphemeral leaves it: live, never stored
    bench.info.ephemeral = true
    await createContractsRegistry(e.kv).add(a.info.id, rec)
    await createWebAssets(e.kv).add({ id: 'gbp', chainId: a.info.id, kind: 'erc20', address: rec.address, symbol: 'GBP', name: 'Pound', decimals: 6, origin: 'launched', mintable: true, addedAt: 'now' } as any)
    const snaps = createSnapshotStore(e.kv)
    const snap = await snaps.take(a, 'first')
    await snaps.take(bench, 'bench snap')
    const edit = { ...bundled[0]!, title: 'Edited' }
    await e.kv.set('walkthroughEdits', edit.id, edit)
    const run = { walkthrough: edit.id, started: 'now', edited: true, values: {}, steps: {} }
    await e.kv.set('walkthroughRuns', edit.id, run)
    e.local.set('evmb.walkthrough.active', edit.id)
    e.local.set('evmb.selectedChain', b.info.id)
    e.local.set('evmb.theme', 'dark') // per-browser: never in the file
    const order = { id: 'o1', scope: a.info.id, venue: '0xv', base: '0xb', quote: '0xq', side: 'sell', price: 5n, owner: '0xa', seq: 1, priceKey: priceKey('sell', 5n) }
    await e.book.put('orders', 'o1', order)
    await e.book.put('meta', 'seq', { n: 1 })

    const f = await buildWorkspace({ ...e.ws, account: acct.address })
    expect(f.format).toBe('evm.fun/workspace')
    expect(f.version).toBe(1)
    expect(f.engine).toBe(ENGINE)
    expect(f.accounts).toEqual([acct])
    expect(f.chains.map(c => [c.id, c.chain.name, c.chain.type])).toEqual([[a.info.id, 'alpha', 'plain'], [b.info.id, 'beta', 'sequencer']])
    const fa = f.chains[0]!
    expect(fa.format).toBe('evm.fun/chain')
    expect(fa.contracts.map(c => c.address)).toEqual([rec.address])
    expect(fa.assets?.map(x => x.symbol)).toEqual(['GBP'])
    expect(f.snapshots.map(s => s.id)).toEqual([snap.id])
    expect(f.walkthroughs.edits).toEqual([edit])
    expect(f.walkthroughs.runs).toEqual([run])
    expect(f.activeWalkthrough).toBe(edit.id)
    expect(f.selection).toEqual({ chain: b.info.id, account: acct.address })
    expect(f.orderbook).toContainEqual({ table: 'orders', key: 'o1', value: order })
    expect(f.orderbook).toContainEqual({ table: 'meta', key: 'seq', value: { n: 1 } })
    expect(JSON.stringify(f, (_k, v) => typeof v === 'bigint' ? String(v) : v)).not.toContain('evmb.theme')

    // the encoded file validates and the chain's state survives (1 block, bigint price kept)
    const text = encodeWorkspace(f)
    const r = validateWorkspace(text, { engine: ENGINE, crossEngineOk: false })
    if (!('ok' in r)) throw new Error(r.errors.join('\n'))
    expect(r.ok.chains[0]!.id).toBe(a.info.id)
    expect((r.ok.orderbook.find(x => x.key === 'o1')!.value as any).price).toBe(5n)
    expect(r.ok.chains[0]!.dump).toEqual(fa.dump)
    await e.disposeAll()
  })

  test(`${LIVE_MAX + 1} chains build one at a time; live chains stay live, closed ones stay closed`, async () => {
    const e = env()
    const ids: string[] = []
    for (let i = 0; i <= LIVE_MAX; i++) {
      const h = await e.registry.create('c' + i, 'plain', [])
      ids.push(h.info.id)
      if (i < 3) await e.registry.close(h.info.id) // three closed, six live
    }
    expect(e.registry.liveCount()).toBe(LIVE_MAX - 2)
    const f = await buildWorkspace(e.ws)
    expect(f.chains.map(c => c.id)).toEqual(ids)
    expect(e.registry.liveCount()).toBe(LIVE_MAX - 2)
    expect(ids.map(id => !!e.registry.peek(id))).toEqual(ids.map((_, i) => i >= 3))
    await e.disposeAll()
  })
})

describe('buildWorkspace at the cap and during an open', () => {
  test(`${LIVE_MAX} live chains + a saved one: build succeeds and exactly the original ${LIVE_MAX} stay live`, async () => {
    const e = env()
    const closed = await e.registry.create('closed', 'plain', [acct.address])
    await closed.send(await sign(0))
    await e.registry.close(closed.info.id)
    const liveIds: string[] = []
    for (let i = 0; i < LIVE_MAX; i++) liveIds.push((await e.registry.create('c' + i, 'plain', [])).info.id)
    const f = await buildWorkspace(e.ws)
    expect(f.chains.map(c => c.id)).toEqual([closed.info.id, ...liveIds])
    expect((f.chains[0]!.dump as any).blocks.length).toBeGreaterThan(1) // the closed chain's real state
    expect(e.registry.liveCount()).toBe(LIVE_MAX)
    expect(liveIds.every(id => e.registry.peek(id))).toBe(true)
    expect(e.registry.peek(closed.info.id)).toBeUndefined()
    await expect(e.registry.open(closed.info.id)).rejects.toThrow(/already running/) // normal opens keep the cap
    await e.disposeAll()
  })

  test('a chain the app is opening while build runs stays live', async () => {
    const e = env()
    const h = await e.registry.create('c', 'plain', [])
    await e.registry.close(h.info.id)
    const opening = e.registry.open(h.info.id) // app-style open, not awaited
    const [f, opened] = await Promise.all([buildWorkspace(e.ws), opening])
    expect(f.chains.map(c => c.id)).toEqual([h.info.id])
    expect(e.registry.peek(h.info.id)).toBe(opened)
    expect(Number(BigInt(await opened.request('eth_blockNumber') as string))).toBe(0) // not disposed
    await e.disposeAll()
  })

  test('an open that starts during a transient dump waits for it and gets its own live node', async () => {
    const e = env()
    const h = await e.registry.create('c', 'plain', [])
    await e.registry.close(h.info.id)
    let during: Promise<unknown> | undefined
    await e.registry.withChain(h.info.id, async t => {
      during = e.registry.open(h.info.id)
      await new Promise(r => setTimeout(r, 5))
      expect(e.registry.peek(h.info.id)).toBeUndefined() // still waiting for the transient
      return t.approach.snapshot!()
    })
    const opened = await during
    expect(e.registry.peek(h.info.id)).toBe(opened as any)
    await e.disposeAll()
  })
})

describe('registry', () => {
  test('close disposes a live chain without deleting it; it opens again with its state', async () => {
    const e = env()
    const h = await e.registry.create('c', 'plain', [acct.address])
    await h.send(await sign(0))
    await e.registry.close(h.info.id)
    expect(e.registry.peek(h.info.id)).toBeUndefined()
    expect((await e.registry.list()).map(c => c.id)).toEqual([h.info.id])
    const again = await e.registry.open(h.info.id)
    expect(again).not.toBe(h)
    expect(Number(BigInt(await again.request('eth_blockNumber') as string))).toBe(1)
    await e.registry.close('missing') // no-op
    await e.disposeAll()
  })

  test('createFrom keeps a given id, and refuses one that exists without touching it', async () => {
    const e = env()
    const h = await e.registry.create('c', 'plain', [])
    const dump = await h.approach.snapshot!()
    const source = { kind: 'import', fileName: 'w.json', height: 0 } as const
    const kept = await e.registry.createFrom(dump, { name: 'k', type: 'plain', contracts: [rec], source, id: 'kept-id' })
    expect(kept.info.id).toBe('kept-id')
    expect(await e.kv.get('chains', 'kept-id')).toBeDefined()
    await expect(e.registry.createFrom(dump, { name: 'x', type: 'plain', contracts: [], source, id: h.info.id })).rejects.toThrow(/already exists/)
    expect(e.registry.peek(h.info.id)).toBe(h)
    expect((await e.registry.list()).map(c => c.name)).toEqual(['c', 'k'])
    const fresh = await e.registry.createFrom(dump, { name: 'f', type: 'plain', contracts: [], source })
    expect(fresh.info.id).not.toBe('kept-id')
    await e.disposeAll()
  })
})

describe('validateWorkspace', () => {
  const opts = { engine: ENGINE, crossEngineOk: false }
  let base: WorkspaceFile | undefined
  const good = async () => {
    if (base) return structuredClone(base)
    const e = env()
    const h = await e.registry.create('alpha', 'plain', [])
    await createSnapshotStore(e.kv).take(h)
    await e.kv.set('walkthroughEdits', bundled[0]!.id, bundled[0])
    base = await buildWorkspace(e.ws)
    await e.disposeAll()
    return structuredClone(base)
  }
  const errs = (f: unknown) => {
    const r = validateWorkspace(typeof f === 'string' ? f : encodeWorkspace(f as WorkspaceFile), opts)
    return 'errors' in r ? r.errors : []
  }

  test('a built file is ok', async () => {
    expect(errs(await good())).toEqual([])
  })

  test('refuses a bad envelope', async () => {
    expect(errs('{')[0]).toMatch(/JSON/)
    expect(errs('[]')[0]).toMatch(/object/)
    expect(errs({ ...(await good()), format: 'evm.fun/chain' })[0]).toMatch(/format/)
    expect(errs({ ...(await good()), version: 2 })[0]).toMatch(/newer/)
    expect(errs({ ...(await good()), accounts: 'x' })[0]).toMatch(/accounts/)
    expect(errs({ ...(await good()), orderbook: [1] })[0]).toMatch(/orderbook\[0\]/)
    expect(errs({ ...(await good()), walkthroughs: { edits: [], runs: [null] } })[0]).toMatch(/runs\[0\]/)
    expect(errs({ ...(await good()), selection: { chain: 'nope' } })[0]).toMatch(/selection/)
  })

  test('refuses bad accounts: label, hex, key ↔ address', async () => {
    const f = await good()
    expect(errs({ ...f, accounts: [{ ...acct, label: 'x'.repeat(201) }] })[0]).toMatch(/accounts\[0\]\.label/)
    expect(errs({ ...f, accounts: [{ ...acct, privateKey: '0x12' }] })[0]).toMatch(/accounts\[0\]\.privateKey/)
    expect(errs({ ...f, accounts: [{ ...acct, address: B }] })[0]).toMatch(/does not match/)
    expect(errs({ ...f, accounts: [acct, acct] })[0]).toMatch(/duplicate/i)
  })

  test('refuses a bad chain with a message naming it', async () => {
    const f = await good()
    f.chains[0]!.dump = { nope: 1 }
    expect(errs(f)[0]).toMatch(/^Chain "alpha": Invalid dump/)
    const g = await good()
    g.chains.push({ ...g.chains[0]!, chain: { name: 'twin', type: 'plain' } })
    expect(errs(g).join()).toMatch(/duplicate chain id/i)
    const h = await good()
    h.chains[0]!.id = '../x'
    expect(errs(h)[0]).toMatch(/id/)
    const k = await good()
    k.engine = 'other'
    k.chains[0]!.engine = 'other'
    expect(errs(k).join()).toMatch(/Engine mismatch/)
  })

  test('refuses snapshots of chains not in the file, bad snapshot dumps, and invalid walkthrough edits', async () => {
    const f = await good()
    f.snapshots[0]!.chainId = 'other'
    expect(errs(f)[0]).toMatch(/snapshots\[0\].*not in this file/)
    const g = await good()
    g.snapshots[0]!.dump = 1
    expect(errs(g)[0]).toMatch(/snapshots\[0\]/)
    const h = await good()
    h.walkthroughs.edits = [{ ...bundled[0]!, steps: 'x' } as any]
    expect(errs(h)[0]).toMatch(/walkthroughs\.edits\[0\]/)
  })
})
