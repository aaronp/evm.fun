import { test, expect } from 'bun:test'
import { cumulative, histogram, type Series } from '../src/bench/distribution'

const a: Series = { id: 'a', name: 'a', samples: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }
const b: Series = { id: 'b', name: 'b', samples: [5, 5, 6, 20] }
const sum = (xs: number[]) => xs.reduce((p, q) => p + q, 0)

test('histogram: shared edges, shares sum to 100 per series', () => {
  const h = histogram([a, b], 40)
  expect(h.edges.length).toBe(41)
  expect(h.edges[0]).toBe(1)
  expect(h.edges[40]).toBe(20)
  expect(h.shares.length).toBe(2)
  for (const s of h.shares) {
    expect(s.length).toBe(40)
    expect(sum(s)).toBeCloseTo(100, 9)
  }
})

test('histogram: a single-value series does not divide by zero', () => {
  const h = histogram([{ id: 'x', name: 'x', samples: [7, 7, 7] }])
  expect(h.shares).toEqual([[100]])
  expect(h.edges.length).toBe(2)
  expect(h.edges.every(Number.isFinite)).toBe(true)
})

test('histogram: empty input gives empty output', () => {
  expect(histogram([])).toEqual({ edges: [], shares: [] })
})

test('cumulative: non-decreasing, ends at 100, shared xs min..max', () => {
  const c = cumulative([a, b], 100)
  expect(c.xs.length).toBe(100)
  expect(c.xs[0]).toBe(1)
  expect(c.xs[99]).toBe(20)
  for (const ys of c.ys) {
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThanOrEqual(ys[i - 1]!)
    expect(ys[99]).toBe(100)
  }
  expect(c.ys[1]![0]).toBe(0) // nothing in b is <= 1
})

test('cumulative: all-equal samples span a unit-wide x range', () => {
  const c = cumulative([{ id: 'a', name: 'a', samples: [5, 5, 5] }], 10)
  expect(c.xs[0]).toBe(5)
  expect(c.xs[9]).toBe(6)
  expect(c.ys[0]!.every(y => y === 100)).toBe(true)
})

test('cumulative: empty series array gives empty output', () => {
  expect(cumulative([])).toEqual({ xs: [], ys: [] })
})
