import { test, expect } from 'bun:test'
import type { Address } from 'viem'
import type { Asset } from '@evmb/assets'
import { book, type Offer } from '@evmb/swap'
import { makerLabel, pickPair, statsText } from '../src/swap/ui'

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const tok = (n: number, symbol: string, decimals: number): Asset => ({
  id: `c:${a(n)}`, chainId: 'c', kind: 'erc20', address: a(n), symbol, name: symbol, decimals, origin: 'launched', mintable: true, addedAt: '',
})
const native = { id: 'c:native', chainId: 'c', kind: 'native', symbol: 'ETH', name: 'Ether', decimals: 18, origin: 'genesis', addedAt: '' } as unknown as Asset
const GBP = tok(1, 'GBP', 2), USD = tok(2, 'USD', 6), EUR = tok(3, 'EUR', 2)
const offer = (id: number, give: Asset, giveAmt: bigint, get: Asset, getAmt: bigint, status: Offer['status'] = 'open'): Offer =>
  ({ id: BigInt(id), maker: a(9), giveToken: give.address!, giveAmt, getToken: get.address!, getAmt, status })

test('pickPair: ERC-20 only, defaults to the first two, follows the URL, refuses the same token', () => {
  expect(pickPair([native, GBP, USD, EUR])).toMatchObject({ tokens: [GBP, USD, EUR], base: GBP, quote: USD })
  expect(pickPair([native, GBP, USD, EUR], a(3), a(1))).toMatchObject({ base: EUR, quote: GBP })
  expect(pickPair([GBP, USD], a(2).toUpperCase().replace('0X', '0x'), null)).toMatchObject({ base: USD, quote: GBP })
  expect(pickPair([GBP, USD], a(1), a(1))).toMatchObject({ error: 'Pick two different tokens.' })
  const one = pickPair([native, GBP])
  expect([one.base, one.error]).toEqual([undefined, 'Swap needs two ERC-20 assets on this chain.'])
})

test('statsText from a book: best bid/ask and spread at 4 dp, escrow at 2 dp, dashes when empty', () => {
  const b = book([
    offer(1, GBP, 50_000n, USD, 635_000_000n), // ask 500 GBP @ 1.27
    offer(2, GBP, 100_000n, USD, 1_271_200_000n), // ask 1000 @ 1.2712
    offer(3, USD, 1_268_800_000n, GBP, 100_000n), // bid 1000 @ 1.2688
    offer(4, USD, 1n, EUR, 1n), // other pair
    offer(5, GBP, 1n, USD, 1n, 'filled'),
  ], GBP as any, USD as any)
  expect(statsText(b, GBP, USD)).toEqual({ bestBid: '1.2688', bestAsk: '1.2700', spread: '0.0012', escrowBase: '1,500.00', escrowQuote: '1,268.80' })
  expect(statsText(book([], GBP as any, USD as any), GBP, USD)).toEqual({ bestBid: '—', bestAsk: '—', spread: '—', escrowBase: '0.00', escrowQuote: '0.00' })
})

test('makerLabel: "you" for the acting account, else the account name, else a short address', () => {
  const people = [{ label: 'me', address: a(7) }, { label: 'tester', address: a(8) }]
  expect(makerLabel(a(7), a(7).toUpperCase().replace('0X', '0x'), people)).toBe('you')
  expect(makerLabel(a(8), a(7), people)).toBe('tester')
  expect(makerLabel(a(0xabcdef), a(7), people)).toBe('0x0000…cdef')
  expect(makerLabel(a(7), undefined, people)).toBe('me')
})
