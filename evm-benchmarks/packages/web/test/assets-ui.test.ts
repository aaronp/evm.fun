import { test, expect } from 'bun:test'
import { zeroAddress, type Address } from 'viem'
import { MAX_UINT256, nativeAsset, type Asset } from '@evmb/assets'
import { allowanceLabel, badgeTone, formatAmount, glyphFor, issuerText, parseAmount, shares, TONES } from '../src/assets/ui'

const A = '0x6643000000000000000000000000000000001234' as Address
const B = '0x0754000000000000000000000000000000005678' as Address
const tok = (issuer?: Address): Asset => ({ id: 'c:0x1', chainId: 'c', kind: 'erc20', address: A, symbol: 'GBP', name: 'GBP', decimals: 2, origin: 'deployed', issuer, mintable: true, addedAt: '' })

test('glyphFor', () => {
  expect(['GBP', 'USD', 'EUR', 'ETH', 'abc'].map(glyphFor)).toEqual(['£', '$', '€', 'Ξ', 'A'])
})
test('badgeTone is stable and in range', () => {
  expect(badgeTone('c:0x1')).toBe(badgeTone('c:0x1'))
  expect(TONES).toContain(badgeTone('c:0x2'))
})
test('formatAmount', () => {
  expect(formatAmount(999000n, 2)).toBe('9,990.00')
  expect(formatAmount(10n ** 18n + 4n * 10n ** 9n, 18, 8)).toBe('1.00000000')
  expect(formatAmount(15n * 10n ** 17n, 18, 8)).toBe('1.50000000')
  expect(formatAmount(5n, 0)).toBe('5')
})
test('parseAmount', () => {
  expect(parseAmount('1.5', 2)).toEqual({ ok: 150n })
  expect(parseAmount(' 7 ', 2)).toEqual({ ok: 700n })
  expect(parseAmount('.5', 2)).toEqual({ ok: 50n })
  for (const bad of ['1.555', '-1', 'abc', '', '1.']) expect('error' in parseAmount(bad, 2)).toBe(true)
})
test('shares', () => {
  expect(shares([0n, 0n])).toEqual([0, 0])
  expect(shares([3n, 1n])).toEqual([75, 25])
})
test('issuerText', () => {
  const accts = [{ label: 'me', address: A }]
  expect(issuerText(tok(A), accts)).toBe('me')
  expect(issuerText(tok(B), accts)).toBe('0x0754…5678')
  expect(issuerText(tok(), accts)).toBe('—')
  expect(issuerText(tok(zeroAddress), accts)).toBe('—')
  expect(issuerText(nativeAsset('c'), accts)).toBe('genesis')
})

test('allowanceLabel: max is Unlimited, else amount and symbol', () => {
  expect(allowanceLabel(MAX_UINT256, 2, 'GBP')).toBe('Unlimited')
  expect(allowanceLabel(50000n, 2, 'GBP')).toBe('500.00 GBP')
})
