import { describe, expect, test } from 'bun:test'
import { parsePrice, priceText, quoteFor, tickOf } from '../src'

describe('quoteFor', () => {
  test('GBP 2 dp base / USD 6 dp quote: exact and both roundings', () => {
    expect(quoteFor(500000n, 1270500n, 2, 'up')).toBe(6352500000n) // 5,000.00 GBP at 1.2705 = 6,352.50 USD
    expect(quoteFor(500000n, 1270500n, 2, 'down')).toBe(6352500000n)
    expect(quoteFor(1n, 1270550n, 2, 'up')).toBe(12706n) // 0.01 GBP × 1.27055 = 0.0127055 USD
    expect(quoteFor(1n, 1270550n, 2, 'down')).toBe(12705n)
  })
  test('18 dp base: one wei rounds up to one unit, down to zero', () => {
    expect(quoteFor(1n, 1270000n, 18, 'up')).toBe(1n)
    expect(quoteFor(1n, 1270000n, 18, 'down')).toBe(0n)
    expect(quoteFor(10n ** 18n, 1270000n, 18, 'up')).toBe(1270000n)
    expect(quoteFor(3n * 10n ** 17n + 1n, 1270000n, 18, 'down')).toBe(381000n)
    expect(quoteFor(3n * 10n ** 17n + 1n, 1270000n, 18, 'up')).toBe(381001n)
  })
})

describe('tick and text', () => {
  test('tickOf', () => {
    expect(tickOf(6)).toBe(100n)
    expect(tickOf(18)).toBe(10n ** 14n)
    expect(tickOf(2)).toBe(1n)
  })
  test('priceText shows 4 dp', () => {
    expect(priceText(1270000n, 6)).toBe('1.2700')
    expect(priceText(1270500n, 6)).toBe('1.2705')
    expect(priceText(127n, 2)).toBe('1.2700')
    expect(priceText(12n * 10n ** 17n, 18)).toBe('1.2000')
    expect(priceText(-30_000n, 6)).toBe('-0.0300') // a difference keeps its sign (was "0.-300")
  })
  test('parsePrice', () => {
    expect(parsePrice('1.2705', 6)).toBe(1270500n)
    expect(parsePrice('1.27', 6)).toBe(1270000n)
    expect(parsePrice('2', 6)).toBe(2000000n)
    expect(parsePrice(' 1.2 ', 2)).toBe(120n)
    expect(() => parsePrice('1.27051', 6)).toThrow()
    expect(() => parsePrice('1.275', 2)).toThrow() // finer than the 2 dp quote can hold
    expect(parsePrice('1.270', 2)).toBe(127n)
    for (const bad of ['', 'abc', '-1', '1.', '0', '0.0000']) expect(() => parsePrice(bad, 6)).toThrow()
  })
})
