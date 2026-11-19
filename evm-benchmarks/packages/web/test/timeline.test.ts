import { describe, test, expect } from 'bun:test'
import { markRadius, timeScale } from '../src/explorer/timeline'
import type { Header } from '../src/explorer/window'

const h = (timestamp: number): Header => ({ number: 0, hash: '0x00', parentHash: '0x00', timestamp, txCount: 0 })

describe('timeScale', () => {
  test('endpoints map to pad and width-pad', () => {
    const x = timeScale([h(100), h(200), h(150)], 600)
    expect(x(100)).toBe(16)
    expect(x(200)).toBe(584)
    expect(x(150)).toBe(300)
  })
  test('single block and equal timestamps map to the centre', () => {
    expect(timeScale([h(5)], 600)(5)).toBe(300)
    expect(timeScale([h(5), h(5)], 600)(5)).toBe(300)
  })
  test('empty window does not throw', () => expect(timeScale([], 600)(0)).toBe(300))
})

describe('markRadius', () => {
  test('0 gives 3, maxTx gives 14, monotonic', () => {
    expect(markRadius(0, 10)).toBe(3)
    expect(markRadius(10, 10)).toBe(14)
    const r = [0, 1, 2, 5, 10].map(n => markRadius(n, 10))
    expect(r).toEqual([...r].sort((a, b) => a - b))
  })
  test('maxTx 0 gives 3', () => expect(markRadius(0, 0)).toBe(3))
})
