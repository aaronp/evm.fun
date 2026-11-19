import { test, expect } from 'bun:test'
import { fnKind, fnSig } from '../src/abi/kind'

test('fnKind splits view/pure from state-changing', () => {
  expect(fnKind({ stateMutability: 'view' })).toBe('read')
  expect(fnKind({ stateMutability: 'pure' })).toBe('read')
  expect(fnKind({ stateMutability: 'nonpayable' })).toBe('write')
  expect(fnKind({ stateMutability: 'payable' })).toBe('write')
})
test('fnSig renders name(type name, …)', () => {
  expect(fnSig({ type: 'function', name: 'mint', stateMutability: 'nonpayable', outputs: [], inputs: [{ type: 'address', name: 'to' }, { type: 'uint256', name: '' }] })).toBe('mint(address to, uint256)')
})
