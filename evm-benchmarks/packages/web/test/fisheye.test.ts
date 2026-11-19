import { describe, test, expect } from 'bun:test'
import { lensWindow, tileStyle } from '../src/explorer/lens'

describe('tileStyle', () => {
  const M = 300
  const at = (s: number, h: boolean) => tileStyle(s, M, h)
  test('cross size scales 36..150 with size/max', () => {
    expect(at(0, true).cross).toBe(36)
    expect(at(M, true).cross).toBe(150)
    expect(at(M / 2, false).cross).toBe(93)
  })
  test('filled from 6', () => {
    expect(at(5, true).filled).toBe(false)
    expect(at(6, true).filled).toBe(true)
  })
  test('horizontal thresholds: mid 44, full 130', () => {
    expect(at(0, true)).toMatchObject({ full: false, mid: false, filled: false })
    expect(at(43, true).mid).toBe(false)
    expect(at(44, true)).toMatchObject({ full: false, mid: true })
    expect(at(129, true)).toMatchObject({ full: false, mid: true })
    expect(at(130, true)).toMatchObject({ full: true, mid: false })
    expect(at(M, true)).toMatchObject({ full: true, mid: false, filled: true })
  })
  test('vertical thresholds: mid 22, full 64', () => {
    expect(at(5, false)).toMatchObject({ full: false, mid: false })
    expect(at(21, false).mid).toBe(false)
    expect(at(22, false)).toMatchObject({ full: false, mid: true })
    expect(at(44, false)).toMatchObject({ full: false, mid: true })
    expect(at(64, false)).toMatchObject({ full: true, mid: false })
    expect(at(130, false)).toMatchObject({ full: true, mid: false })
  })
})

describe('lensWindow', () => {
  test('anchor inside a span-sized window', () => {
    for (const a of [0, 1, 17, 18, 250, 481, 499]) {
      const w = lensWindow(500, a)
      expect(w.end - w.start).toBe(36)
      expect(a).toBeGreaterThanOrEqual(w.start)
      expect(a).toBeLessThan(w.end)
    }
  })
  test('clamps at both ends', () => {
    expect(lensWindow(500, 0)).toEqual({ start: 0, end: 36 })
    expect(lensWindow(500, 499)).toEqual({ start: 464, end: 500 })
    expect(lensWindow(500, -5)).toEqual({ start: 0, end: 36 })
    expect(lensWindow(500, 900)).toEqual({ start: 464, end: 500 })
  })
  test('total below span gives the whole range', () => expect(lensWindow(10, 7)).toEqual({ start: 0, end: 10 }))
  test('total 0 is empty', () => expect(lensWindow(0, 0)).toEqual({ start: 0, end: 0 }))
  test('custom span', () => expect(lensWindow(100, 50, 10)).toEqual({ start: 45, end: 55 }))
})
