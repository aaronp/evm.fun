import { describe, test, expect } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { createKv } from '../src/store/kv'
import { createChainRegistry, type ChainType } from '../src/chain/registry'

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
