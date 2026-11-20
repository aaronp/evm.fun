import { test, expect } from 'bun:test'
import type { Address } from 'viem'
import type { Asset } from '@evmb/assets'
import { book, type ActivityItem, type Offer } from '@evmb/swap'
import { activityText, allowText, takeFlash, crosses, exactText, formQuote, makerLabel, pickPair, rowOf, statsText } from '../src/swap/ui'

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const tok = (n: number, symbol: string, decimals: number): Asset => ({
  id: `c:${a(n)}`, chainId: 'c', kind: 'erc20', address: a(n), symbol, name: symbol, decimals, origin: 'launched', mintable: true, addedAt: '',
})
const native = { id: 'c:native', chainId: 'c', kind: 'native', symbol: 'ETH', name: 'Ether', decimals: 18, origin: 'genesis', addedAt: '' } as unknown as Asset
const GBP = tok(1, 'GBP', 2), USD = tok(2, 'USD', 6), EUR = tok(3, 'EUR', 2), WETH = tok(4, 'WETH', 18)
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

test('formQuote: GBP 2dp base, USD 6dp quote, amounts exact and half-up; errors per the mockup', () => {
  expect(formQuote('ask', '1000', '1.271234', GBP, USD)).toEqual({ give: { asset: GBP, amount: 100_000n }, get: { asset: USD, amount: 1_271_234_000n } })
  expect(formQuote('bid', '1,000.50', '1.2688', GBP, USD)).toEqual({ give: { asset: USD, amount: 1_269_434_400n }, get: { asset: GBP, amount: 100_050n } })
  expect(formQuote('ask', '0.01', '1.2345675', GBP, USD)).toMatchObject({ get: { amount: 12_346n } }) // 0.012345675 -> 0.012346
  expect(formQuote('bid', '1', '0.0000005', USD, GBP)).toEqual({ error: 'Rounds to 0.00 GBP — raise the amount or price.' })
  expect(formQuote('ask', '', '1.27', GBP, USD)).toEqual({ error: 'Enter both an amount and a price.' })
  expect(formQuote('ask', '1.234', '1.27', GBP, USD)).toEqual({ error: 'GBP has 2 decimals — use at most 2 after the point.' })
  // mockup order: empty, then positive numbers, then decimals
  expect(formQuote('ask', '1.234', '0', GBP, USD)).toEqual({ error: 'Amount and price must be positive numbers.' })
  expect(formQuote('ask', '-1.234', '1.27', GBP, USD)).toEqual({ error: 'Amount and price must be positive numbers.' })
  // 18-decimal quote: every digit kept
  expect(formQuote('ask', '2.50', '0.123456789012345678', GBP, WETH)).toEqual({ give: { asset: GBP, amount: 250n }, get: { asset: WETH, amount: 308_641_972_530_864_195n } })
  expect(formQuote('bid', '0.01', '0.0000000000000001', GBP, WETH)).toEqual({ give: { asset: WETH, amount: 1n }, get: { asset: GBP, amount: 1n } })
  expect(exactText(308_641_972_530_864_195n, 18)).toBe('0.308641972530864195')
  for (const [amt, price] of [['0', '1.27'], ['-1', '1.27'], ['1', '0'], ['1', 'x'], ['0.00', '1']])
    expect(formQuote('ask', amt!, price!, GBP, USD)).toEqual({ error: 'Amount and price must be positive numbers.' })
  expect(exactText(1_271_234_000n, 6)).toBe('1,271.234')
  expect(exactText(1_271_000_000n, 6)).toBe('1,271.00')
  expect(exactText(100_050n, 2)).toBe('1,000.50')
  expect([allowText(2n ** 256n - 1n, 2), allowText(50_000n, 2)]).toEqual(['unlimited', '500.00'])
})

test('takeFlash: settled, or reverted with the reason', () => {
  expect(takeFlash(5n, 'success')).toBe('Offer #5 settled in one transaction.')
  expect(takeFlash(5n, 'reverted', 'allowance', 'USD')).toBe('Take #5 reverted — USD allowance too low.')
  expect(takeFlash(5n, 'reverted', 'filled', 'USD')).toBe('Take #5 reverted — already taken.')
  expect(takeFlash(5n, 'reverted')).toBe('Take #5 reverted.')
})

test('crosses: selling at or below the best bid, buying at or above the best ask; exact at equality', () => {
  const b = book([offer(1, GBP, 50_000n, USD, 635_000_000n), offer(3, USD, 1_268_800_000n, GBP, 100_000n)], GBP as any, USD as any) // ask 1.27, bid 1.2688
  const buying = 'Someone is already buying at 1.2688 or better — take their offer instead. Swap doesn’t match offers for you.'
  const selling = 'Someone is already selling at 1.2700 or better — take their offer instead. Swap doesn’t match offers for you.'
  expect(crosses('ask', '1.2688', b)).toBe(buying)
  expect(crosses('ask', '1.26880001', b)).toBeUndefined()
  expect(crosses('ask', '1.2', b)).toBe(buying)
  expect(crosses('bid', '1.27', b)).toBe(selling)
  expect(crosses('bid', '1.26999999', b)).toBeUndefined()
  expect(crosses('bid', '2', b)).toBe(selling)
  expect(crosses('bid', 'x', b)).toBeUndefined()
  expect(crosses('ask', '1', book([], GBP as any, USD as any))).toBeUndefined()
})

test('rowOf: an offer of any status seen in the pair, undefined outside it', () => {
  expect(rowOf(offer(2, GBP, 20_000n, USD, 253_800_000n, 'filled'), GBP, USD)).toMatchObject({ side: 'ask', base: 20_000n, quote: 253_800_000n, status: 'filled' })
  expect(rowOf(offer(3, USD, 1n, GBP, 1n), GBP, USD)?.side).toBe('bid')
  expect(rowOf(offer(4, USD, 1n, EUR, 1n), GBP, USD)).toBeUndefined()
})

test('activityText: one line per kind, as in the mockup', () => {
  const people = [{ label: 'me', address: a(7) }, { label: 'tester', address: a(8) }]
  const offers = [
    { ...offer(2, GBP, 20_000n, USD, 253_800_000n, 'filled'), maker: a(7) },
    { ...offer(5, GBP, 250_000n, USD, 3_176_250_000n), maker: a(7) },
    { ...offer(6, USD, 3_174_000_000n, GBP, 250_000n), maker: a(8) },
  ]
  const labels = { name: (x: string) => makerLabel(x, undefined, people), offer: (id: bigint) => offers.find(o => o.id === id), base: GBP, quote: USD }
  const it = (kind: ActivityItem['kind'], x: Partial<ActivityItem>): ActivityItem => ({ kind, actor: a(8), tx: '0x1', block: 1n, txIndex: 0, ...x })
  expect(activityText(it('reverted', { id: 5n, reason: 'allowance' }), labels)).toBe('tester tried to take #5 — USD allowance too low')
  expect(activityText(it('reverted', { id: 5n, reason: 'balance' }), labels)).toBe('tester tried to take #5 — USD balance too low')
  expect(activityText(it('reverted', { id: 5n, reason: 'filled' }), labels)).toBe('tester tried to take #5 — already taken')
  expect(activityText(it('reverted', { id: 5n, reason: 'cancelled' }), labels)).toBe('tester tried to take #5 — offer cancelled')
  expect(activityText(it('reverted', { id: 5n, reason: 'other' }), labels)).toBe('tester tried to take #5 — reverted')
  expect(activityText(it('taken', { id: 2n }), labels)).toBe('#2 taken by tester · 200.00 GBP ⇄ 253.80 USD')
  expect(activityText(it('cancelled', { id: 5n, actor: a(7) }), labels)).toBe('#5 cancelled by me · 2,500.00 GBP returned')
  expect(activityText(it('offered', { id: 5n, actor: a(7) }), labels)).toBe('#5 by me · sell 2,500.00 GBP @ 1.2705')
  expect(activityText(it('offered', { id: 6n }), labels)).toBe('#6 by tester · buy 2,500.00 GBP @ 1.2696')
  expect(activityText(it('approved', { token: USD.address!, amount: 3_176_250_000n }), labels)).toBe('tester approved Swap for 3,176.25 USD')
  expect(activityText(it('approved', { token: GBP.address!, amount: 2n ** 256n - 1n }), labels)).toBe('tester approved Swap for unlimited GBP')
})
