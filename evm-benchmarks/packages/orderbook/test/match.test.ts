import { describe, expect, test } from 'bun:test'
import { levels, match, worstPrice, type Resting } from '../src'

const ask = (id: string, price: bigint, remaining: bigint, seq: number): Resting =>
  ({ id, owner: '0x0000000000000000000000000000000000000001', side: 'sell', price, remaining, seq })
const bid = (id: string, price: bigint, remaining: bigint, seq: number): Resting => ({ ...ask(id, price, remaining, seq), side: 'buy' })

describe('match', () => {
  const asks = [ask('a', 100n, 5n, 2), ask('b', 100n, 5n, 3), ask('c', 101n, 10n, 1), ask('d', 103n, 10n, 4)]

  test('price-time: same price fills lower seq first, at the resting price', () => {
    const r = match({ side: 'buy', price: 102n, amount: 7n }, asks, 20)
    expect(r.fills).toEqual([{ id: 'a', price: 100n, amount: 5n }, { id: 'b', price: 100n, amount: 2n }])
    expect(r).toMatchObject({ filled: 7n, levels: 1, thin: false })
  })

  test('limit stops at its price', () => {
    const r = match({ side: 'buy', price: 101n, amount: 100n }, asks, 20)
    expect(r.fills.map(f => f.id)).toEqual(['a', 'b', 'c'])
    expect(r).toMatchObject({ filled: 20n, levels: 2, thin: false })
    const s = match({ side: 'sell', price: 99n, amount: 100n }, [bid('x', 100n, 3n, 1), bid('y', 98n, 3n, 2)], 20)
    expect(s.fills).toEqual([{ id: 'x', price: 100n, amount: 3n }])
  })

  test('maxLevels cap sets thin on a market order', () => {
    const r = match({ side: 'buy', amount: 25n }, asks, 2)
    expect(r).toMatchObject({ filled: 20n, levels: 2, thin: true })
    expect(match({ side: 'buy', amount: 25n }, asks, 20)).toMatchObject({ filled: 25n, levels: 3, thin: false })
    expect(match({ side: 'buy', amount: 99n }, asks, 20)).toMatchObject({ filled: 30n, thin: true })
  })

  test('skips empty resting orders', () => {
    const r = match({ side: 'buy', amount: 1n }, [ask('z', 99n, 0n, 1), ...asks], 1)
    expect(r.fills).toEqual([{ id: 'a', price: 100n, amount: 1n }])
  })
})

describe('worstPrice', () => {
  test('± 100 bps from the furthest level needed', () => {
    const fills = [{ id: 'a', price: 1270000n, amount: 1n }, { id: 'b', price: 1280000n, amount: 1n }]
    expect(worstPrice(fills, 'buy', 100)).toBe(1292800n)
    expect(worstPrice([...fills].reverse(), 'sell', 100)).toBe(1257300n)
    expect(worstPrice([{ id: 'a', price: 101n, amount: 1n }], 'buy', 100)).toBe(103n) // rounds away from the book
    expect(worstPrice([{ id: 'a', price: 101n, amount: 1n }], 'sell', 100)).toBe(99n)
  })
})

describe('levels', () => {
  test('aggregates by price, totals cumulate best first, capped at depth', () => {
    const asks = [ask('a', 100n, 5n, 2), ask('b', 100n, 5n, 3), ask('z', 101n, 0n, 9), ask('c', 101n, 10n, 1), ask('d', 103n, 10n, 4)]
    expect(levels(asks, 2)).toEqual([
      { price: 100n, size: 10n, total: 10n, orders: 2 },
      { price: 101n, size: 10n, total: 20n, orders: 1 },
    ])
    expect(levels(asks, 10)).toHaveLength(3)
  })
})
