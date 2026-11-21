import { expect, test } from 'bun:test'
import type { Address } from 'viem'
import { amountOut, isqrt, orient, poolPrice, quoteAdd, quoteRemove, quoteSwap, type PoolState } from '../src'

const A = '0x00000000000000000000000000000000000000a1' as Address
const B = '0x00000000000000000000000000000000000000b2' as Address
/** 4 dp half-up, as the page shows prices */
const p4 = (raw: bigint, qd: number) => { const v = (raw * 10000n + 10n ** BigInt(qd) / 2n) / 10n ** BigInt(qd); return `${v / 10000n}.${String(v % 10000n).padStart(4, '0')}` }

// the screenshot: 100,000 GBP (2 dp) / 127,000 USD (6 dp)
const shot: PoolState = { address: A, base: A, quote: B, baseDecimals: 2, quoteDecimals: 6, reserveBase: 10_000_000n, reserveQuote: 127_000_000_000n, totalShares: 10n ** 23n }

test('isqrt is the floor square root (OZ Math.sqrt) on edge values', () => {
  for (const n of [0n, 1n, 2n, 3n, 4n, 8n, 9n, 10n, 15n, 16n, 17n, 99n, 100n, 101n]) {
    const r = isqrt(n)
    expect(r * r <= n && (r + 1n) * (r + 1n) > n).toBe(true)
  }
  for (const r of [1n, 2n, 3n, 10n ** 9n, 2n ** 64n - 1n, 2n ** 127n, 2n ** 128n - 1n]) {
    expect(isqrt(r * r)).toBe(r)
    expect(isqrt(r * r - 1n)).toBe(r - 1n)
    expect(isqrt(r * r + 1n)).toBe(r)
  }
  expect(isqrt(2n ** 256n - 1n)).toBe(2n ** 128n - 1n)
  let x = 0x9e3779b97f4a7c15n
  for (let i = 0; i < 500; i++) {
    x = (x * 6364136223846793005n + 1442695040888963407n) % 2n ** 256n
    const r = isqrt(x)
    expect(r * r <= x && (r + 1n) * (r + 1n) > x).toBe(true)
  }
})

test('quoteSwap pins the screenshot: 1,000 GBP in → 1,253.69 USD, price 1.2537, after 1.2450, impact 0.99%, fee 3 GBP', () => {
  const q = quoteSwap(shot, A, 100_000n, 50)
  expect(q.out).toBe(1_253_690_703n)
  expect(q.out).toBe(amountOut(100_000n, shot.reserveBase, shot.reserveQuote))
  expect(q.fee).toBe(300n)
  expect([q.priceNow, q.price, q.priceAfter]).toEqual([1_270_000n, 1_253_690n, 1_245_012n])
  expect([p4(q.priceNow, 6), p4(q.price, 6), p4(q.priceAfter, 6)]).toEqual(['1.2700', '1.2537', '1.2450'])
  expect(q.impactBps.toFixed(0)).toBe('99')
  expect(q.minOut).toBe(1_253_690_703n * 9950n / 10000n)
  expect(poolPrice(shot)).toBe(1_270_000n)
})

test('quoteSwap quote in: price is quote paid per base received, in the state orientation', () => {
  const q = quoteSwap(shot, B, 1_270_000_000n, 100) // 1,270 USD in
  expect(q.out).toBe(amountOut(1_270_000_000n, shot.reserveQuote, shot.reserveBase))
  expect(q.price).toBe(1_270_000_000n * 100n / q.out)
  expect(q.priceAfter).toBe((shot.reserveQuote + 1_270_000_000n) * 100n / (shot.reserveBase - q.out))
  expect(q.priceAfter > q.priceNow).toBe(true)
  expect(q.fee).toBe(3_810_000n)
  expect(q.minOut).toBe(q.out * 9900n / 10000n)
})

test('quoteSwap on an empty pool or zero input quotes nothing', () => {
  const empty = { ...shot, reserveBase: 0n, reserveQuote: 0n, totalShares: 0n }
  expect(quoteSwap(empty, A, 100n, 50)).toMatchObject({ out: 0n, price: 0n, priceNow: 0n, priceAfter: 0n, minOut: 0n })
  expect(quoteSwap(shot, A, 0n, 50)).toMatchObject({ out: 0n, price: 0n, impactBps: 0 })
})

test('quoteAdd first deposit: screenshot 50,000 GBP + 63,500 USD → 56,347.14 LP; too small → 0 shares', () => {
  const empty = { ...shot, reserveBase: 0n, reserveQuote: 0n, totalShares: 0n }
  const q = quoteAdd(empty, 5_000_000n, 63_500_000_000n)
  expect(q).toEqual({ shares: isqrt(5_000_000n * 10n ** 16n * 63_500_000_000n * 10n ** 12n) - 1000n, baseUsed: 5_000_000n, quoteUsed: 63_500_000_000n })
  expect((q.shares + 5n * 10n ** 15n) / 10n ** 16n).toBe(5_634_714n) // 56,347.14 LP, 2 dp half-up
  const e18 = { ...empty, baseDecimals: 18, quoteDecimals: 18 }
  expect(quoteAdd(e18, 1000n, 1000n).shares).toBe(0n) // √ = 1000: BadAmount
  expect(quoteAdd(e18, 1001n, 1001n).shares).toBe(1n)
})

test('quoteAdd later deposit takes the min, pulls ceil; quoteRemove floors', () => {
  const s = { ...shot, totalShares: 3n, reserveBase: 10n, reserveQuote: 20n }
  // base 7·3/10 = 2, quote 100·3/20 = 15 → shares 2, pulls ceil(2·10/3)=7, ceil(2·20/3)=14
  expect(quoteAdd(s, 7n, 100n)).toEqual({ shares: 2n, baseUsed: 7n, quoteUsed: 14n })
  expect(quoteAdd(s, 1n, 100n)).toEqual({ shares: 0n, baseUsed: 0n, quoteUsed: 0n })
  expect(quoteRemove(s, 2n)).toEqual({ base: 6n, quote: 13n })
  expect(quoteRemove({ ...s, totalShares: 0n }, 1n)).toEqual({ base: 0n, quote: 0n })
})

test('orient flips reserves, decimals and price when the pool base is the caller quote', () => {
  expect(orient(shot, A, B)).toBe(shot)
  const r = orient(shot, B, A)
  expect(r).toEqual({ ...shot, base: B, quote: A, baseDecimals: 6, quoteDecimals: 2, reserveBase: 127_000_000_000n, reserveQuote: 10_000_000n })
  expect(poolPrice(r)).toBe(78n) // 0.78 GBP per USD
  expect(quoteSwap(r, A, 100_000n, 0).out).toBe(quoteSwap(shot, A, 100_000n, 0).out)
  expect(() => orient(shot, A, A)).toThrow()
})
