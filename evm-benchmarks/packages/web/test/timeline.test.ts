import { describe, test, expect } from 'bun:test'
import { markRadius, ticks, timeScale, timelineLayout } from '../src/explorer/timeline'
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

describe('ticks', () => {
  test('integers including both endpoints', () => {
    const t = ticks(100, 106)
    expect(t.every(Number.isInteger)).toBe(true)
    expect(t[0]).toBe(100)
    expect(t[t.length - 1]).toBe(106)
    expect(t.length).toBe(5)
  })
  test('deduplicated for a tiny span', () => expect(ticks(10, 12)).toEqual([10, 11, 12]))
  test('single value when lo === hi', () => expect(ticks(7, 7)).toEqual([7]))
})

describe('timelineLayout', () => {
  const hn = (number: number, timestamp: number): Header => ({ ...h(timestamp), number })
  test('equal timestamps spread by block number', () => {
    const hs = [0, 1, 2, 3, 4].map(n => hn(n, 7))
    const l = timelineLayout(hs, 600)
    expect(l.mode).toBe('index')
    const xs = hs.map(l.x)
    expect(xs[0]).toBe(16)
    expect(xs[4]).toBe(584)
    xs.forEach((v, i) => i && expect(v).toBeGreaterThan(xs[i - 1]))
  })
  test('well-spread timestamps use timeScale', () => {
    const hs = [0, 1, 2, 3].map(n => hn(n, n * 100))
    const l = timelineLayout(hs, 600)
    const X = timeScale(hs, 600)
    expect(l.mode).toBe('time')
    hs.forEach(b => expect(l.x(b)).toBe(X(b.timestamp)))
  })
  test('single block is centred', () => expect(timelineLayout([hn(3, 9)], 600).x(hn(3, 9))).toBe(300))
  test('empty does not throw', () => expect(timelineLayout([], 600).mode).toBe('index'))
})
