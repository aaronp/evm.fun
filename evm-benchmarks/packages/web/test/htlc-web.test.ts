import { test, expect } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { hashOf, newSecret } from '@evmb/htlc'
import { createKv, kv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'
import { contractsRegistry } from '../src/contracts/registry'
import { deployHashLock, hashLockFor } from '../src/htlc/locate'
import { ANSWERS, createAnswers, createSecrets } from '../src/htlc/secrets'
import { makeHandle } from '../src/chain/handle'
import type { Account } from '../src/store/accounts'

const key = `0x${'11'.repeat(32)}` as const
const me: Account = { label: 'me', address: privateKeyToAccount(key).address, privateKey: key }

function registry() {
  const stores = new Map<string, any>()
  return createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
  })
}
const head = async (h: { request(m: string, p?: unknown[]): Promise<unknown> }) => BigInt((await h.request('eth_blockNumber', [])) as string)

for (const type of ['plain', 'sequencer'] as const) {
  test(`mine(5) advances a ${type} chain by 5 empty blocks and returns the new head`, async () => {
    const h = await registry().create('c', type, [me.address])
    try {
      const h0 = await head(h)
      expect(await h.mine(5)).toBe(h0 + 5n)
      expect(await head(h)).toBe(h0 + 5n)
      const b = (await h.request('eth_getBlockByNumber', ['latest', false])) as { transactions: unknown[] }
      expect(b.transactions).toEqual([])
    } finally { await h.dispose() }
  })
}

test('mine works on a benchmark chain too', async () => {
  const reg = registry()
  const h = await reg.create('bench', 'sequencer', [me.address])
  try {
    reg.addEphemeral(h)
    const h0 = await head(h)
    expect(await h.mine(3)).toBe(h0 + 3n)
  } finally { await h.dispose() }
})

test('no HashLock record → undefined; deployHashLock adds a record that hashLockFor finds; the newer of two wins', async () => {
  const h = await registry().create('c', 'plain', [me.address])
  try {
    expect(await hashLockFor(h)).toBeUndefined()
    let sent = 0
    const first = await deployHashLock(h, me, () => sent++)
    expect(sent).toBe(1)
    expect((await contractsRegistry.list(h.info.id)).map(r => r.name)).toEqual(['HashLock'])
    expect(await hashLockFor(h)).toBe(first)
    const second = await deployHashLock(h, me)
    expect(await hashLockFor(h)).toBe(second)
  } finally { await h.dispose() }
})

test('deployHashLock on a benchmark chain throws and records nothing', async () => {
  const reg = registry()
  const h = await reg.create('bench', 'plain', [me.address])
  try {
    reg.addEphemeral(h)
    await expect(deployHashLock(h, me)).rejects.toThrow('Benchmark chains keep no contract records')
    expect(await contractsRegistry.list(h.info.id)).toEqual([])
  } finally { await h.dispose() }
})

test('secrets: put → get → all round trip, keyed by hash; lockId set later; a secret under the wrong hash is refused', async () => {
  const s = createSecrets(createKv())
  const secret = newSecret(), hash = hashOf(secret)
  expect(await s.get(hash)).toBeUndefined()
  await s.put(hash, { secret, chain: 'c1', lockId: '' })
  await s.put(hash, { secret, chain: 'c1', lockId: '7' })
  expect(await s.get(hash)).toEqual({ secret, chain: 'c1', lockId: '7' })
  expect(await s.get(hash.toUpperCase().replace('0X', '0x') as `0x${string}`)).toEqual({ secret, chain: 'c1', lockId: '7' })
  expect(await s.all()).toEqual([{ hash, secret, chain: 'c1', lockId: '7' }])
  await expect(s.put(hashOf(newSecret()), { secret, chain: 'c1', lockId: '' })).rejects.toThrow(/hash/)
})

test('answers.all skips rows from before answers were objects', async () => {
  const k = createKv(), an = createAnswers(k), hash = hashOf(newSecret())
  await k.set(ANSWERS, '0xold', '123')
  await an.put(hash, 7n)
  expect(await an.all()).toEqual([{ hash, headA: '7' }])
})

test('a chain whose approach has no mine says so', async () => {
  const h = makeHandle({ id: 'x', name: 'x', type: 'plain', createdAt: '' }, { request: async () => '0x1' } as any)
  await expect(h.mine(1)).rejects.toThrow("This chain can't advance blocks")
})
