import { test, expect } from 'bun:test'
import { formatEth } from '../src/chain/useBalance'

test('formatEth', () => {
  expect(formatEth(undefined)).toBe('—')
  expect(formatEth(10n ** 21n)).toBe('1,000 ETH')
  expect(formatEth(1234567890000000000n)).toBe('1.2346 ETH')
})
