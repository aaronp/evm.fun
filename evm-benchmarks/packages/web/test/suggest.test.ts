import { test, expect } from 'bun:test'
import { addressSuggestions } from '../src/abi/suggest'

const A = '0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa' as const
const B = '0xbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbB' as const

test('accounts then contracts, labelled', () => {
  expect(addressSuggestions([{ label: 'alice', address: A }], [{ name: 'Token', address: B }]))
    .toEqual([{ value: A, label: 'alice' }, { value: B, label: 'Token' }])
})

test('dedupes by lowercase address, first wins', () => {
  const r = addressSuggestions([{ label: 'alice', address: A }], [{ name: 'Dup', address: A.toLowerCase() as `0x${string}` }])
  expect(r).toEqual([{ value: A, label: 'alice' }])
})

test('empty inputs', () => expect(addressSuggestions([], [])).toEqual([]))
