import { test, expect } from 'bun:test'
import { fnKind } from '../src/abi/kind'

test('fnKind splits view/pure from state-changing', () => {
  expect(fnKind({ stateMutability: 'view' })).toBe('read')
  expect(fnKind({ stateMutability: 'pure' })).toBe('read')
  expect(fnKind({ stateMutability: 'nonpayable' })).toBe('write')
  expect(fnKind({ stateMutability: 'payable' })).toBe('write')
})
