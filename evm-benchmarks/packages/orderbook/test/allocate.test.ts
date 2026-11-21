import { describe, expect, test } from 'bun:test'
import { allocate, quoteFor, type Resting } from '../src'

const o = (id: string, side: 'buy' | 'sell', price: bigint, remaining: bigint, seq: number): Resting =>
  ({ id, owner: '0x0000000000000000000000000000000000000001', side, price, remaining, seq })

describe('allocate', () => {
  test('Review Focus 1: two 5,000 GBP asks, 6,000 available → 5,000 + 1,000', () => {
    const asks = [o('new', 'sell', 1270000n, 500000n, 2), o('old', 'sell', 1260000n, 500000n, 1)]
    const m = allocate(asks, 600000n, x => x.remaining)
    expect(m.get('old')).toBe(500000n)
    expect(m.get('new')).toBe(100000n)
  })

  test('oldest first; uncovered orders get 0', () => {
    const asks = [o('a', 'sell', 1n, 5n, 3), o('b', 'sell', 1n, 5n, 1), o('c', 'sell', 1n, 5n, 2)]
    const m = allocate(asks, 7n, x => x.remaining)
    expect([m.get('b'), m.get('c'), m.get('a')]).toEqual([5n, 2n, 0n])
  })

  test('buy orders: quote needed rounded up; partial cover never needs more than available', () => {
    const give = (x: Resting) => quoteFor(x.remaining, x.price, 2, 'up')
    const bids = [o('a', 'buy', 1270550n, 3n, 1), o('b', 'buy', 1270000n, 100n, 2)]
    const needA = give(bids[0]!) // 38117 (38116.5 up)
    expect(needA).toBe(38117n)
    expect(allocate(bids, needA - 1n, give).get('a')).toBe(2n)
    const m = allocate(bids, needA + 500000n, give)
    expect(m.get('a')).toBe(3n)
    const b = m.get('b')!
    expect(quoteFor(b, 1270000n, 2, 'up')).toBeLessThanOrEqual(500000n)
    expect(b).toBe(39n) // 39 × 12700 = 495,300 ≤ 500,000 < 40 × 12700
  })
})
