import { describe, test, expect } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { createKv } from '../src/store/kv'
import { createChainRegistry, LIVE_MAX, LIVE_WARN, type ChainType } from '../src/chain/registry'
import { createChainPersistence, deleteChainDb } from '../src/chain/idb'
import { runInBrowser } from '../src/bench/run'

const a = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const B = '0x000000000000000000000000000000000000dEaD' as const
const sign = (nonce: number) =>
  a.signTransaction({
    type: 'eip1559', chainId: 31337, nonce, to: B, value: 1n, gas: 21_000n,
    maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
  })

// One in-memory persistence per chain id, shared across registries (like IndexedDB).
function env() {
  const stores = new Map<string, any>()
  const deps = (kv = createKv()) => ({
    kv,
    host: (id: string) => ({
      persistence: {
        load: async () => stores.get(id) ?? null,
        save: async (s: any) => void stores.set(id, structuredClone(s)),
      },
    }),
    purge: async (id: string) => void stores.delete(id),
  })
  return { stores, deps }
}

for (const type of ['plain', 'sequencer'] as ChainType[]) {
  describe(type, () => {
    test('create, send, balance', async () => {
      const reg = createChainRegistry(env().deps())
      const h = await reg.create('c', type, [a.address])
      expect(await h.approach.getBalance(a.address)).toBe(10n ** 21n)
      const r = await h.send(await sign(0))
      expect(r.status).toBe('success')
      expect(await h.approach.getBalance(B)).toBe(1n)
      expect((await reg.list()).map(c => c.name)).toEqual(['c'])
      await h.dispose()
    })

    test('reopens chain with history', async () => {
      const e = env()
      const kv = createKv()
      const one = await createChainRegistry(e.deps(kv)).create('c', type, [a.address])
      const r1 = await one.send(await sign(0))
      await one.send(await sign(1))
      const bn = await one.request('eth_blockNumber')
      await one.dispose()

      const reg2 = createChainRegistry(e.deps(kv))
      const [info] = await reg2.list()
      const two = await reg2.open(info!.id)
      expect(await two.request('eth_blockNumber')).toBe(bn)
      expect(await two.request('eth_getTransactionReceipt', [r1.hash])).toMatchObject({ status: '0x1' })
      expect(await two.approach.getBalance(B)).toBe(2n)
      await two.dispose()
    })

    test('concurrent open builds one node', async () => {
      const e = env()
      const kv = createKv()
      const one = await createChainRegistry(e.deps(kv)).create('c', type, [a.address])
      await one.dispose()
      let built = 0
      const d = e.deps(kv)
      const reg = createChainRegistry({ ...d, host: id => (built++, d.host(id)) })
      const [x, y] = await Promise.all([reg.open(one.info.id), reg.open(one.info.id)])
      expect(x).toBe(y)
      expect(built).toBe(1)
      await x.dispose()
    })

    test('failed open is not cached', async () => {
      const reg = createChainRegistry(env().deps())
      await expect(reg.open('nope')).rejects.toThrow('unknown chain')
      await expect(reg.open('nope')).rejects.toThrow('unknown chain')
    })

    test('remove deletes persisted data', async () => {
      const e = env()
      const reg = createChainRegistry(e.deps())
      const h = await reg.create('c', type, [a.address])
      await reg.remove(h.info.id)
      expect(await reg.list()).toEqual([])
      expect(e.stores.size).toBe(0)
      await expect(reg.open(h.info.id)).rejects.toThrow()
    })

    test('send returns rejected for garbage', async () => {
      const reg = createChainRegistry(env().deps())
      const h = await reg.create('c', type, [a.address])
      expect((await h.send('0xdeadbeef')).status).toBe('rejected')
      await h.dispose()
    })
  })
}

describe('browser persistence', () => {
  test('chain works when IndexedDB is unavailable (memory fallback)', async () => {
    const p = createChainPersistence(undefined, 'x')
    const reg = createChainRegistry({ kv: createKv(), host: () => ({ persistence: p }) })
    const h = await reg.create('c', 'plain', [a.address])
    expect((await h.send(await sign(0))).status).toBe('success')
    await h.dispose()
  })

  test('chain works when the IndexedDB open fails', async () => {
    const idb = { open: () => { const r: any = {}; setTimeout(() => r.onerror?.(), 0); return r } } as any
    const reg = createChainRegistry({ kv: createKv(), host: () => ({ persistence: createChainPersistence(idb, 'x') }) })
    const h = await reg.create('c', 'plain', [a.address])
    expect((await h.send(await sign(0))).status).toBe('success')
    await h.dispose()
  })

  test('purge closes before deleting and waits past onblocked', async () => {
    const log: string[] = []
    const req: any = {}
    const idb = { deleteDatabase: () => (log.push('delete'), req) } as any
    let done = false
    const p = deleteChainDb(idb, 'x', { close: () => void log.push('close') }).then(() => (done = true))
    req.onblocked?.()
    await Promise.resolve()
    expect(done).toBe(false)
    req.onsuccess()
    await p
    expect(log).toEqual(['close', 'delete'])
  })
})

describe('live chain cap', () => {
  const spyEnv = () => {
    const e = env(), kv = createKv(), built: string[] = []
    const mk = () => { const d = e.deps(kv); return { ...d, host: (id: string) => (built.push(id), d.host(id)) } }
    return { kv, built, mk }
  }
  test('list and peek never construct an approach', async () => {
    const { built, mk } = spyEnv()
    const a = createChainRegistry(mk())
    const h = await a.create('c', 'plain', [])
    built.length = 0
    const b = createChainRegistry(mk()) // fresh registry over the same kv: nothing live
    expect((await b.list()).length).toBe(1)
    expect(b.peek(h.info.id)).toBeUndefined()
    expect(a.peek(h.info.id)).toBe(h)
    expect(built).toEqual([])
  })
  test('warn at LIVE_WARN, throw at LIVE_MAX without constructing', async () => {
    const { built, mk } = spyEnv()
    const reg = createChainRegistry(mk())
    for (let i = 0; i < LIVE_WARN + 1; i++) await reg.create(`c${i}`, 'plain', [])
    expect(reg.liveCount()).toBeGreaterThanOrEqual(LIVE_WARN)
    for (let i = reg.liveCount(); i < LIVE_MAX; i++) await reg.create(`c${i}`, 'plain', [])
    const n = built.length
    await expect(reg.create('x', 'plain', [])).rejects.toThrow('8 chains are already running in this tab — delete one or reload the page')
    const id = (await reg.list())[0]!.id
    await reg.remove(id); await reg.create('y', 'plain', []) // room again after delete
    expect(built.length).toBe(n + 1)
  })
})

describe('state history (swap failure reports replay at the parent block)', () => {
  const pastCall = async (request: (m: string, p?: unknown[]) => Promise<unknown>) => {
    const head = BigInt((await request('eth_blockNumber')) as string)
    expect(head).toBeGreaterThan(1n)
    return request('eth_call', [{ to: B, data: '0x' }, `0x${(head - 1n).toString(16)}`])
  }
  for (const type of ['plain', 'sequencer'] as ChainType[]) {
    test(`${type} playground chain answers eth_call at head-1`, async () => {
      const h = await createChainRegistry(env().deps()).create('c', type, [a.address])
      try {
        await h.send(await sign(0))
        await h.send(await sign(1))
        expect(await pastCall(h.request)).toBe('0x')
      } finally { await h.dispose() }
    })
  }
  test('benchmark path keeps no history: eth_call at head-1 is refused', async () => {
    const { handle } = await runInBrowser({ type: 'plain', scenario: 'eth-transfer', n: 4, senders: 2, host: {} })
    try {
      await expect(pastCall(handle.request)).rejects.toThrow('historical state not available')
    } finally { await handle.dispose() }
  })
})
