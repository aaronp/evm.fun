import { describe, test, expect } from 'bun:test'
import { neighbours } from '../src/explorer/neighbours'

describe('neighbours', () => {
  test('genesis has only children', () => expect(neighbours(0, 10)).toEqual({ parents: [], children: [1, 2, 3] }))
  test('tip has only parents', () => expect(neighbours(10, 10)).toEqual({ parents: [7, 8, 9], children: [] }))
  test('near the tip', () => expect(neighbours(5, 6)).toEqual({ parents: [2, 3, 4], children: [6] }))
  test('near genesis', () => expect(neighbours(1, 10)).toEqual({ parents: [0], children: [2, 3, 4] }))
  test('single-block chain', () => expect(neighbours(0, 0)).toEqual({ parents: [], children: [] }))
})
