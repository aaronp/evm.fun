import { describe, test, expect } from 'bun:test'
import { lensFocus, lensPos, lensSizes } from '../src/explorer/lens'

const M = 12, S = 2.5, L = 860
describe('lens', () => {
  test('sizes sum to len and peak at round(f)', () => {
    const s = lensSizes(40, 12.4, M, S, L)
    expect(Math.abs(s.reduce((a, b) => a + b, 0) - L)).toBeLessThan(1e-9)
    expect(s.indexOf(Math.max(...s))).toBe(12)
  })
  test('one item fills the lens', () => expect(lensSizes(1, 0, M, S, L)).toEqual([L]))
  test('zero items throws', () => expect(() => lensSizes(0, 0, M, S, L)).toThrow())
  test('pos spans 0..len', () => {
    const s = lensSizes(30, 5, M, S, L)
    expect(lensPos(s, 0)).toBe(0)
    expect(Math.abs(lensPos(s, 30) - L)).toBeLessThan(1e-6)
  })
  test('focus inverts pos', () => {
    for (const f of [0, 3.7, 10, 19]) {
      const p = lensPos(lensSizes(20, f, M, S, L), f + 0.5)
      expect(Math.abs(lensFocus(20, p, M, S, L) - f)).toBeLessThan(0.01)
    }
  })
})
