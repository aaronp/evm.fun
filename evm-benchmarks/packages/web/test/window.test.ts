import { describe, test, expect } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { createKv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'
import type { ChainHandle } from '../src/chain/handle'
import { blockMatches, blockWindow, windowContains, type Header } from '../src/explorer/window'

const a = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const B = '0x000000000000000000000000000000000000dEaD' as const
const sign = (nonce: number) =>
  a.signTransaction({ type: 'eip1559', chainId: 31337, nonce, to: B, value: 1n, gas: 21_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n })
const deps = (kv = createKv()) => ({ kv, host: () => ({}) as never })

const H = (number: number, hash: string): Header => ({ number, hash: hash as Header['hash'], parentHash: '0x00', timestamp: 0, txCount: 0 })

describe('blockWindow', () => {
  test('plain chain with 7 txs: 8 headers newest first, genesis parent, limit honoured', async () => {
    const reg = createChainRegistry(deps())
    const h = await reg.create('c', 'plain', [a.address])
    for (let i = 0; i < 7; i++) await h.send(await sign(i))
    const w = await blockWindow(h)
    expect(w.total).toBe(8)
    expect(w.headers.map(x => x.number)).toEqual([7, 6, 5, 4, 3, 2, 1, 0])
    expect(w.headers[7]!.parentHash).toBe(`0x${'0'.repeat(64)}`)
    expect(w.headers[0]!.txCount).toBe(1)
    expect((await blockWindow(h, 3)).headers.map(x => x.number)).toEqual([7, 6, 5])
    await h.dispose()
  }, 30_000)

  test('a throwing handle gives an empty window', async () => {
    const bad = { request: async () => { throw new Error('boom') } } as unknown as ChainHandle
    expect(await blockWindow(bad)).toEqual({ headers: [], total: 0 })
  })
})

describe('blockMatches', () => {
  const hash = `0xAbCd${'1'.repeat(60)}`
  test('empty matches all; digits match the number exactly', () => {
    expect(blockMatches(H(3, hash), '')).toBe(true)
    expect(blockMatches(H(3, 'zz'), '3')).toBe(true)
    expect(blockMatches(H(13, 'zz'), '3')).toBe(false)
  })
  test('hash prefix with or without 0x, case-insensitive', () => {
    expect(blockMatches(H(1, hash), '0xabcd')).toBe(true)
    expect(blockMatches(H(1, hash), '0x')).toBe(true) // a bare 0x matches every block
    expect(blockMatches(H(1, hash), 'ABCD1')).toBe(true)
    expect(blockMatches(H(1, hash), 'abce')).toBe(false)
  })
  test('garbage matches nothing', () => expect(blockMatches(H(1, hash), 'xyz')).toBe(false))
})

test('windowContains', () => {
  const hs = [H(5, 'a'), H(4, 'b')]
  expect(windowContains(hs, 4)).toBe(true)
  expect(windowContains(hs, 3)).toBe(false)
  expect(windowContains([], 0)).toBe(false)
})

test('recordHeight does not write back a chain deleted mid-request', async () => {
  const kv = createKv()
  const reg = createChainRegistry(deps(kv))
  const h = await reg.create('c', 'plain', [])
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  h.request = async () => { await gate; return '0x5' }
  const rec = reg.recordHeight(h.info.id)
  await reg.remove(h.info.id)
  release()
  await rec
  expect(await kv.get('chains', h.info.id)).toBeFalsy()
})
