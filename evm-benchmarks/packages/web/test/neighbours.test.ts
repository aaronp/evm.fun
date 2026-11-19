import { describe, test, expect } from 'bun:test'
import { neighbours } from '../src/explorer/neighbours'

describe('neighbours', () => {
  test('genesis has only children', () => expect(neighbours(0, 10)).toEqual({ parents: [], children: [1, 2, 3] }))
  test('tip has only parents', () => expect(neighbours(10, 10)).toEqual({ parents: [7, 8, 9], children: [] }))
  test('near the tip', () => expect(neighbours(5, 6)).toEqual({ parents: [2, 3, 4], children: [6] }))
  test('near genesis', () => expect(neighbours(1, 10)).toEqual({ parents: [0], children: [2, 3, 4] }))
  test('single-block chain', () => expect(neighbours(0, 0)).toEqual({ parents: [], children: [] }))
})

import { stepTarget } from '../src/explorer/neighbours'
describe('stepTarget', () => {
  test('normal steps', () => { expect(stepTarget(5, 10, -1)).toBe(4); expect(stepTarget(5, 10, 1)).toBe(6) })
  test('disabled at genesis and tip', () => { expect(stepTarget(0, 10, -1)).toBeNull(); expect(stepTarget(10, 10, 1)).toBeNull() })
  test('beyond the tip: parent goes to the tip, child disabled', () => { expect(stepTarget(999, 10, -1)).toBe(10); expect(stepTarget(999, 10, 1)).toBeNull() })
  test('empty chain', () => expect(stepTarget(0, -1, -1)).toBeNull())
})

import { shownPair } from '../src/explorer/neighbours'
describe('shownPair', () => {
  const c = {}, d = {}
  const p = (chain: object, nums: number[]) => ({ chain, nums })
  test('current wins', () => expect(shownPair(p(c, [1]), p(c, [2]), c)).toEqual(p(c, [2])))
  test('loading keeps the last pair of this chain, with its own numbers', () => expect(shownPair(p(c, [1]), undefined, c)).toEqual(p(c, [1])))
  test('loading after a chain switch shows nothing', () => expect(shownPair(p(c, [1]), undefined, d)).toBeNull())
  test('a rejected load is not replaced by the stale pair', () => expect(shownPair(p(c, [1]), null, c)).toBeNull())
})
