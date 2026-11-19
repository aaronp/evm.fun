import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { encodeDeployData, encodeFunctionData, keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { MintableToken } from '@evmb/contracts'
import { createKv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'
import { signAndSend } from '../src/tx/send'
import approach02Factory from '@evmb/approach-02-seq-memory'
import { deriveAccounts, signTx } from '@evmb/core'
import { makeHandle, type ChainHandle } from '../src/chain/handle'
import { address, block, classify, latestBlocks, tx } from '../src/explorer/data'

const N = 600
let h: ChainHandle
const senders = deriveAccounts('explorer', 100)
const rx = deriveAccounts('explorer:rx', N)
let firstHash: `0x${string}`

beforeAll(async () => {
  const ap = approach02Factory({ block: '600', chunk: '600' }, {})
  h = makeHandle({ id: 'x', name: 'x', type: 'sequencer', createdAt: '' }, ap)
  await ap.setup({ prefund: Object.fromEntries(senders.map(a => [a.address, 10n ** 21n])) })
  const raws = await Promise.all(rx.map((r, i) => signTx(senders[i % 100]!, Math.floor(i / 100), { to: r.address, value: 1n, gas: 21_000n })))
  firstHash = keccak256(raws[0]!)
  await ap.submit(raws)
  const rs = await ap.awaitSettled(raws.map(r => keccak256(r)))
  expect(rs.every(r => r.status === 'success')).toBe(true)
}, 60_000)
afterAll(() => h.dispose())

describe('explorer data', () => {
  test('600 txs land in block 1, paged by 50', async () => {
    const b = (await block(h, 1, 0))!
    expect(b.txTotal).toBe(600)
    expect(b.txs).toHaveLength(50)
    expect((await block(h, 1, 11))!.txs).toHaveLength(50)
    expect((await block(h, 1, 12))!.txs).toHaveLength(0)
    expect(b.txs[0]!.hash).toBe(firstHash)
    expect((await latestBlocks(h, 0)).filter(x => x.txCount > 0)).toHaveLength(1)
  })
  test('block out of range is null', async () => {
    expect(await block(h, 999, 0)).toBeNull()
    expect(await block(h, -1, 0)).toBeNull()
    expect(await block(h, NaN, 0)).toBeNull()
  })
  test('tx found and unknown/malformed null', async () => {
    const t = (await tx(h, firstHash, []))!
    expect(t.receipt.status).toBe('0x1')
    expect(t.decodedLogs).toEqual([])
    expect(await tx(h, `0x${'ab'.repeat(32)}`, [])).toBeNull()
    expect(await tx(h, '0x12' as any, [])).toBeNull()
  })
  test('address', async () => {
    expect(await address(h, '0x000000000000000000000000000000000000dEaD', [])).toMatchObject({ balance: 0n, isContract: false, nonce: 0 })
    expect(await address(h, rx[0]!.address, [])).toMatchObject({ balance: 1n })
    expect((await address(h, senders[0]!.address, [])).nonce).toBe(6)
    expect(await address(h, 'nope' as any, [])).toBeNull()
  })
  test('classify', () => {
    expect(classify('12')).toBe('block')
    expect(classify(' 0 ')).toBe('block')
    expect(classify(`0x${'a'.repeat(64)}`)).toBe('tx')
    expect(classify(`0x${'a'.repeat(40)}`)).toBe('address')
    for (const q of ['', 'hello', '0x12', '-1', '1.5', '99999999999999999999999']) expect(classify(q)).toBe('invalid')
  })
  test('latestBlocks newest first, paged', async () => {
    const l = await latestBlocks(h, 0)
    expect(l.map(x => x.number)).toEqual([...l.map(x => x.number)].sort((a, b) => b - a))
    expect(l[0]!.number).toBeGreaterThanOrEqual(1)
    expect(l.reduce((n, b) => n + b.txCount, 0)).toBe(600)
    expect(await latestBlocks(h, 50)).toEqual([])
  })
})

describe('tolerance and decoding', () => {
  test('malformed node data never throws', async () => {
    const stub = (r: unknown) => ({ request: async () => r }) as unknown as ChainHandle
    const b = await block(stub({ number: '0x1', hash: '0x1', timestamp: '0x0', transactions: [{ hash: '0xaa', from: '0xbb' }, null, 'junk'] }), 1, 0)
    expect(b!.txs).toEqual([{ hash: '0xaa', from: '0xbb', to: null, value: 0n }])
    expect(await block(stub('garbage'), 1, 0)).toBeNull()
    const l = await latestBlocks({ request: async (m: string) => (m === 'eth_blockNumber' ? '0x0' : { hash: '0x1' }) } as any, 0)
    expect(l).toEqual([{ number: 0, hash: '0x1', timestamp: 0, txCount: 0 }])
    expect(await tx(stub({ input: 5, logs: 'x' }), `0x${'ab'.repeat(32)}`, [])).toMatchObject({ decodedLogs: [] })
    expect(await address(stub('zz'), `0x${'ab'.repeat(20)}`, [])).toMatchObject({ balance: 0n, nonce: 0, isContract: true })
  })

  test('decodes transfer input, Transfer log and token balances', async () => {
    const a = privateKeyToAccount(`0x${'11'.repeat(32)}`)
    const b = privateKeyToAccount(`0x${'22'.repeat(32)}`)
    const acct = { label: 'a', address: a.address, privateKey: `0x${'11'.repeat(32)}` as const }
    const stores = new Map<string, any>()
    const reg = createChainRegistry({
      kv: createKv(),
      host: id => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
    })
    const p = await reg.create('p', 'plain', [a.address])
    const dep = await signAndSend(p, acct, { data: encodeDeployData({ abi: MintableToken.abi, bytecode: MintableToken.bytecode, args: ['T', 'T'] }) })
    const to = dep.contractAddress!
    const call = (fn: string, args: unknown[]) => signAndSend(p, acct, { to, data: encodeFunctionData({ abi: MintableToken.abi, functionName: fn, args } as any) })
    await call('mint', [a.address, 100n])
    const r = await call('transfer', [b.address, 30n])
    expect(r.status).toBe('success')
    const t = (await tx(p, r.hash, [MintableToken.abi]))!
    expect(t.decodedInput!.functionName).toBe('transfer')
    expect(t.decodedInput!.args).toEqual([b.address, 30n])
    const ev = t.decodedLogs.find(l => l?.eventName === 'Transfer')!
    expect(ev.args).toMatchObject({ from: a.address, to: b.address, value: 30n })
    const ad = await address(p, b.address, [{ address: to, name: 'T', abi: MintableToken.abi }])
    expect(ad!.tokenBalances).toEqual([{ token: to, name: 'T', balance: 30n }])
    expect((await address(p, to, []))!.isContract).toBe(true)
    await p.dispose()
  })
})
