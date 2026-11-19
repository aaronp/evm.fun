import { describe, test, expect } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { createKv } from '../src/store/kv'
import { createChainRegistry, LIVE_MAX, type ChainType } from '../src/chain/registry'
import { createSnapshotStore } from '../src/chain/snapshots'
import { createContractsRegistry } from '../src/contracts/registry'
import { decodeChainFile, encodeChainFile, MAX_NAME } from '../src/chain/chainFile'
import { forkName } from '../src/chain/snapshotUi'

const a = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const B = '0x000000000000000000000000000000000000dEaD' as const
const sign = (nonce: number, value = 1n) =>
  a.signTransaction({
    type: 'eip1559', chainId: 31337, nonce, to: B, value, gas: 21_000n,
    maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
  })
const rec = (n: number) => ({
  address: `0x${String(n).repeat(40)}` as const, name: `C${n}`, abi: [], deployer: a.address, txHash: `0x${String(n).repeat(64)}` as const,
})
const source = { kind: 'snapshot', snapshotName: 's', fromChainName: 'orig', height: 0 } as const

function env() {
  const stores = new Map<string, any>()
  const kv = createKv()
  const deps = () => ({
    kv,
    host: (id: string) => ({
      persistence: {
        load: async () => stores.get(id) ?? null,
        save: async (s: any) => void stores.set(id, structuredClone(s)),
      },
    }),
    purge: async (id: string) => void stores.delete(id),
  })
  return { stores, kv, deps }
}
const height = async (h: { request: (m: string, p?: unknown[]) => Promise<unknown> }) => Number(BigInt((await h.request('eth_blockNumber')) as string))
const block = (h: any, n: number) => h.request('eth_getBlockByNumber', ['0x' + n.toString(16), false]) as Promise<any>

for (const type of ['plain', 'sequencer'] as ChainType[]) {
  describe(type, () => {
    test('take records height, contracts, bytes', async () => {
      const e = env()
      const reg = createChainRegistry(e.deps())
      const h = await reg.create('orig', type, [a.address])
      await h.send(await sign(0))
      await createContractsRegistry(e.kv).add(h.info.id, rec(1))
      const snaps = createSnapshotStore(e.kv)
      const s = await snaps.take(h)
      expect(s.height).toBe(1)
      expect(s.name).toBe('orig @ block 1')
      expect(s.contracts.map(c => c.name)).toEqual(['C1'])
      expect(s.bytes).toBeGreaterThan(0)
      expect((await snaps.list(h.info.id)).map(x => x.id)).toEqual([s.id])
      expect(await snaps.list('other')).toEqual([])
      expect((await snaps.get(s.id))?.id).toBe(s.id)
      await snaps.remove(s.id)
      expect(await snaps.list(h.info.id)).toEqual([])
      await h.dispose()
    })

    test('createFrom forks: same hashes up to height, then diverges', async () => {
      const e = env()
      const reg = createChainRegistry(e.deps())
      const h = await reg.create('orig', type, [a.address])
      await h.send(await sign(0))
      await h.send(await sign(1))
      const s = await createSnapshotStore(e.kv).take(h)
      const f = await reg.createFrom(s.dump, { name: 'fork', type, contracts: [rec(2)], source: { ...source, height: s.height } })
      expect(f.info.id).not.toBe(h.info.id)
      expect(f.info.source).toMatchObject({ kind: 'snapshot' })
      expect(reg.peek(f.info.id)).toBe(f)
      expect((await reg.list()).map(c => c.name)).toEqual(['orig', 'fork'])
      expect((await createContractsRegistry(e.kv).list(f.info.id)).map(c => c.name)).toEqual(['C2'])
      for (let n = 0; n <= s.height; n++) expect((await block(f, n)).hash).toBe((await block(h, n)).hash)
      await h.send(await sign(2))
      await f.send(await sign(2, 5n))
      await f.send(await sign(3))
      expect(await height(h)).toBe(3)
      expect(await height(f)).toBe(4)
      // webevm block hashes don't cover tx content, so divergence shows in the tx hashes
      expect((await block(f, 3)).transactions).not.toEqual((await block(h, 3)).transactions)
      await h.dispose(); await f.dispose()
    })

    test('createFrom with a bad dump leaves no trace', async () => {
      const e = env()
      const reg = createChainRegistry(e.deps())
      await expect(reg.createFrom({ nope: 1 }, { name: 'x', type, contracts: [rec(3)], source })).rejects.toThrow()
      expect(await reg.list()).toEqual([])
      expect(reg.liveCount()).toBe(0)
      expect(await e.kv.list('chains')).toEqual([])
      expect(e.stores.size).toBe(0)
    })

    test('restoreTo with saveFirst saves, rewinds, replaces contracts, survives reload', async () => {
      const e = env()
      const reg = createChainRegistry(e.deps())
      const h = await reg.create('orig', type, [a.address])
      const cr = createContractsRegistry(e.kv)
      await h.send(await sign(0))
      await cr.add(h.info.id, rec(1))
      const snaps = createSnapshotStore(e.kv)
      const s = await snaps.take(h)
      await h.send(await sign(1))
      await h.send(await sign(2))
      await cr.add(h.info.id, rec(4))
      const { saved } = await reg.restoreTo(h.info.id, s, { saveFirst: true })
      expect(saved?.height).toBe(3)
      expect(saved?.contracts.map(c => c.name).sort()).toEqual(['C1', 'C4'])
      expect(await height(h)).toBe(1)
      expect((await cr.list(h.info.id)).map(c => c.name)).toEqual(['C1'])
      expect((await snaps.list(h.info.id)).length).toBe(2)
      expect((await reg.restoreTo(h.info.id, s, { saveFirst: false })).saved).toBeUndefined()
      await h.dispose()

      const reg2 = createChainRegistry(e.deps())
      const [info] = await reg2.list()
      const again = await reg2.open(info!.id)
      expect(await height(again)).toBe(1)
      expect(info!.lastHeight).toBe(1)
      await again.dispose()
    })

    test('restoreTo is refused while txs are pending', async () => {
      const e = env()
      const reg = createChainRegistry(e.deps())
      const h = await reg.create('orig', type, [a.address])
      const snaps = createSnapshotStore(e.kv)
      const s = await snaps.take(h)
      await h.send(await sign(0))
      h.approach.pending = () => 3
      await expect(reg.restoreTo(h.info.id, s, { saveFirst: true })).rejects.toThrow(/3 pending/)
      expect(await height(h)).toBe(1)
      expect((await snaps.list(h.info.id)).length).toBe(1) // no save-first either
      await h.dispose()
    })

    test('createFrom: storage failing after contracts are written leaves no trace', async () => {
      const e = env()
      const stores: string[] = []
      const kv = {
        ...e.kv,
        set: async (st: string, k: string, v: unknown) => {
          if (st.startsWith('contracts:')) stores.push(st)
          if (st === 'chains') throw new Error('disk full')
          return e.kv.set(st, k, v)
        },
      } as typeof e.kv
      const reg = createChainRegistry({ ...e.deps(), kv })
      const e2 = env() // the dump comes from a separate world so e's kv and stores start empty
      const src = await createChainRegistry(e2.deps()).create('o', type, [])
      const s0 = await createSnapshotStore(e2.kv).take(src)
      await src.dispose() // a live sequencer chain keeps verify workers alive past exit (R11 crash)
      await expect(reg.createFrom(s0.dump, { name: 'x', type, contracts: [rec(5)], source })).rejects.toThrow('disk full')
      expect(stores.length).toBe(1)
      expect(await e.kv.list(stores[0]!)).toEqual([])
      expect(await e.kv.list('chains')).toEqual([])
      expect(e.stores.size).toBe(0)
      expect(reg.liveCount()).toBe(0)
    })

    test('restoreTo refuses another chain\'s snapshot', async () => {
      const e = env()
      const reg = createChainRegistry(e.deps())
      const h = await reg.create('one', type, [])
      const g = await reg.create('two', type, [])
      const s = await createSnapshotStore(e.kv).take(g)
      const { restoreTo } = reg // works destructured
      await expect(restoreTo(h.info.id, s, { saveFirst: false })).rejects.toThrow('snapshot belongs to another chain')
      await h.dispose(); await g.dispose()
    })

    test('remove deletes the chain\'s snapshots only', async () => {
      const e = env()
      const reg = createChainRegistry(e.deps())
      const h = await reg.create('one', type, [a.address])
      const g = await reg.create('two', type, [a.address])
      const snaps = createSnapshotStore(e.kv)
      await snaps.take(h); await snaps.take(g)
      await reg.remove(h.info.id)
      expect(await snaps.list(h.info.id)).toEqual([])
      expect((await snaps.list(g.info.id)).length).toBe(1)
      await g.dispose()
    })
  })
}

test('createFrom at the cap throws and builds nothing', async () => {
  const e = env()
  const reg = createChainRegistry(e.deps())
  const first = await reg.create('c0', 'plain', [])
  const s = await createSnapshotStore(e.kv).take(first)
  for (let i = 1; i < LIVE_MAX; i++) await reg.create('c' + i, 'plain', [])
  await expect(reg.createFrom(s.dump, { name: 'f', type: 'plain', contracts: [], source })).rejects.toThrow(/already running/)
  expect((await reg.list()).length).toBe(LIVE_MAX)
  expect(e.stores.size).toBe(LIVE_MAX)
  for (const c of await reg.list()) await reg.peek(c.id)?.dispose()
})

test('pruneSnapshots drops snapshots of chains that are gone (an unsaved benchmark chain after reload)', async () => {
  const e = env()
  const reg = createChainRegistry(e.deps())
  const kept = await reg.create('kept', 'plain', [])
  const eph = await reg.create('bench', 'plain', [])
  await e.kv.del('chains', eph.info.id) // as if it had been added with addEphemeral: never stored
  eph.info.ephemeral = true
  const snaps = createSnapshotStore(e.kv)
  const s1 = await snaps.take(kept)
  const s2 = await snaps.take(eph)
  // while the ephemeral chain is live its snapshot stays
  await reg.pruneSnapshots()
  expect((await snaps.list(eph.info.id)).map(x => x.id)).toEqual([s2.id])
  await kept.dispose()
  await eph.dispose()
  // "reload": a new registry over the same kv knows only stored chains
  await createChainRegistry(e.deps()).pruneSnapshots()
  expect((await snaps.list(kept.info.id)).map(x => x.id)).toEqual([s1.id])
  expect(await snaps.get(s2.id)).toBeUndefined()
})

test('take: writes strictly and says why a failed snapshot write failed', async () => {
  const e = env()
  const reg = createChainRegistry(e.deps())
  const h = await reg.create('orig', 'plain', [])
  let strict: unknown
  const kv = {
    ...e.kv,
    persistent: true,
    set: async (s: string, k: string, v: unknown, o?: { strict?: boolean }) => {
      if (s === 'snapshots') { strict = o?.strict; throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }) }
      return e.kv.set(s, k, v)
    },
  }
  await expect(createSnapshotStore(kv as any).take(h)).rejects.toThrow(/^Snapshot too large to save \(\d[\d,]* KB\)/)
  expect(strict).toBe(true)
  await h.dispose()
})

test('a 200-character chain name survives snapshot -> fork -> export -> import', async () => {
  const e = env()
  const reg = createChainRegistry(e.deps())
  const name = 'n'.repeat(200)
  const h = await reg.create(name, 'plain', [])
  const s = await createSnapshotStore(e.kv).take(h) // default name "<chain> @ block 0"
  expect(s.name.length).toBeLessThanOrEqual(MAX_NAME)
  const f = await reg.createFrom(s.dump, {
    name: forkName(s.name), type: 'plain', contracts: [],
    source: { kind: 'snapshot', snapshotName: s.name, fromChainName: name, height: s.height },
  })
  const text = encodeChainFile({
    format: 'evm.fun/chain', version: 1, exportedAt: new Date().toISOString(), chainId: 31337, engine: 'x',
    chain: { name: f.info.name, type: f.info.type }, dump: s.dump, contracts: [], source: f.info.source,
  })
  const d = decodeChainFile(text, { engine: 'x', crossEngineOk: true })
  expect(d.ok ? 'ok' : d.error).toBe('ok')
  await h.dispose()
  await f.dispose()
})
