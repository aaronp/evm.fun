import { expect, test } from 'bun:test'
import { VALID_FOR, VOUCH_SECONDS, formatCode, generateCode, isValidCode, normalizeCode } from '../src/codes'

test('normalizeCode drops spaces and "-", upper-cases', () => {
  expect(normalizeCode('let-sue-in')).toBe('LETSUEIN')
  expect(normalizeCode(' 205-117 ')).toBe('205117')
})

test('isValidCode: 4–16 of A–Z 0–9 after normalising', () => {
  expect(isValidCode('ab')).toBe(false)
  expect(isValidCode('A'.repeat(17))).toBe(false)
  expect(isValidCode('A'.repeat(16))).toBe(true)
  expect(isValidCode('let-sue-in')).toBe(true)
  expect(isValidCode('ab_cd')).toBe(false)
})

test('formatCode splits 6 digits 3+3, else unchanged', () => {
  expect(formatCode('205117')).toBe('205 117')
  expect(formatCode('LETSUEIN')).toBe('LETSUEIN')
  expect(formatCode('2051170')).toBe('2051170')
})

test('generateCode: 6 digits', () => {
  for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/)
})

test('valid-for options and vouch length', () => {
  expect(VALID_FOR.map((v) => [v.key, v.seconds])).toEqual([['1m', 60], ['10m', 600], ['1h', 3600], ['1d', 86400], ['1w', 604800]])
  expect(VOUCH_SECONDS).toBe(600)
})
