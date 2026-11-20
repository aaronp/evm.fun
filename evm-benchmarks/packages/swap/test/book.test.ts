import { expect, test } from 'bun:test'
import type { Address } from 'viem'
import { book, priceText, quoteFor, type Offer } from '../src'

const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const [GBP, USD, EUR, M] = [A(1), A(2), A(3), A(9)]
const gbp = { address: GBP, decimals: 2 }, usd = { address: USD, decimals: 6 }
// GBP 100.00 for N USD  => ask at N/100
const ask = (id: number, gbpAmt: bigint, usdAmt: bigint, status: Offer['status'] = 'open'): Offer =>
  ({ id: BigInt(id), maker: M, giveToken: GBP, giveAmt: gbpAmt, getToken: USD, getAmt: usdAmt, status })
const bid = (id: number, usdAmt: bigint, gbpAmt: bigint, status: Offer['status'] = 'open'): Offer =>
  ({ id: BigInt(id), maker: M, giveToken: USD, giveAmt: usdAmt, getToken: GBP, getAmt: gbpAmt, status })

test('book: asks ascending, bids descending, ties lowest id, other pairs and closed offers ignored', () => {
  const offers = [
    ask(1, 10_000n, 128_000_000n), ask(2, 10_000n, 127_000_000n), ask(3, 20_000n, 254_000_000n), // 1.28, 1.27, 1.27
    bid(4, 125_000_000n, 10_000n), bid(5, 126_000_000n, 10_000n), bid(6, 252_000_000n, 20_000n), // 1.25, 1.26, 1.26
    { ...ask(7, 10_000n, 100_000_000n), getToken: EUR }, ask(8, 10_000n, 1_000_000n, 'filled'), bid(9, 1n, 1n, 'cancelled'),
  ]
  const b = book(offers, gbp, usd)
  expect(b.asks.map(r => r.id)).toEqual([2n, 3n, 1n])
  expect(b.bids.map(r => r.id)).toEqual([5n, 6n, 4n])
  expect(b.bestAsk?.id).toBe(2n)
  expect(b.bestBid?.id).toBe(5n)
  expect(b.asks[0]).toMatchObject({ side: 'ask', base: 10_000n, quote: 127_000_000n })
  expect(b.bids[0]).toMatchObject({ side: 'bid', base: 10_000n, quote: 126_000_000n })
  expect(priceText(b.bestAsk!.price)).toBe('1.2700')
  expect(priceText(b.bestBid!.price)).toBe('1.2600')
  // spread exact: 1.27 - 1.26 = 0.01
  expect(priceText(b.spread!, 4)).toBe('0.0100')
  expect(b.spread!.num * 100n).toBe(b.spread!.den)
  expect(b.escrowed).toEqual({ base: 40_000n, quote: 125_000_000n + 126_000_000n + 252_000_000n })
})
test('book: empty / one-sided has no spread', () => {
  expect(book([], gbp, usd)).toMatchObject({ asks: [], bids: [], spread: undefined, escrowed: { base: 0n, quote: 0n } })
  expect(book([ask(1, 100n, 1_270_000n)], gbp, usd).spread).toBeUndefined()
})
test('book: 18-decimal quote', () => {
  const b = book([ask(1, 100n, 1_270_000_000_000_000_000n)], gbp, { address: USD, decimals: 18 })
  expect(priceText(b.bestAsk!.price)).toBe('1.2700')
})
test('priceText rounds half-up at 4 dp and handles negatives', () => {
  expect(priceText({ num: 1n, den: 3n })).toBe('0.3333')
  expect(priceText({ num: 2n, den: 3n })).toBe('0.6667')
  expect(priceText({ num: 12_345n, den: 100_000n })).toBe('0.1235')
  expect(priceText({ num: -1n, den: 100n })).toBe('-0.0100')
  expect(priceText({ num: 5n, den: 1n }, 0)).toBe('5')
})
test('quoteFor: 1.27 x 1,000.00 GBP = 1,270.000000 USD; half-up at the last quote digit', () => {
  expect(quoteFor(100_000n, '1.27', 2, 6)).toBe(1_270_000_000n)
  // 0.01 GBP at 0.5 -> 0.01 GBP at 0.00005 -> 0.5 unit -> 1
  expect(quoteFor(1n, '0.00005', 2, 6)).toBe(1n)
  expect(quoteFor(1n, '0.00004', 2, 6)).toBe(0n)
  expect(quoteFor(1n, '0.00015', 2, 6)).toBe(2n)
  expect(quoteFor(100n, '1.000000000000000001', 2, 18)).toBe(1_000_000_000_000_000_001n)
})
test('quoteFor rejects bad prices', () => {
  for (const p of ['0', '0.0', '-1', 'abc', '', '1.0000000000000000001', '1e3'])
    expect(() => quoteFor(100n, p, 2, 6)).toThrow('Invalid price')
})
