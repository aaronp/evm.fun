import { test, expect } from 'bun:test'
import type { Address } from 'viem'
import type { Asset } from '@evmb/assets'
import { book, type ActivityItem, type Offer, type TakeReport } from '@evmb/swap'
import { reportFmt, reportJson, reportLabels, takenBy, activityText, allowText, takeFlash, crosses, exactText, formQuote, makerLabel, pickPair, rowOf, statsText } from '../src/swap/ui'

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
  // a leading or trailing point in the price is normalised, not refused
  expect(formQuote('ask', '1', '.5', GBP, USD)).toMatchObject({ get: { amount: 500_000n } })
  expect(formQuote('ask', '1', '1.', GBP, USD)).toMatchObject({ get: { amount: 1_000_000n } })
  expect(formQuote('ask', '1', '.', GBP, USD)).toEqual({ error: 'Amount and price must be positive numbers.' })
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
  expect(takeFlash(5n, 'reverted', 'other', 'USD')).toBe('Take #5 reverted.') // no "— reverted" tail
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
  // '.5' and '2.' are read as 0.5 and 2
  expect(crosses('ask', '.5', b)).toBe(buying)
  expect(crosses('bid', '2.', b)).toBe(selling)
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

test('takenBy names the taker stored on the filled offer, nothing otherwise', () => {
  const o: Offer = { id: 1n, maker: a(7), giveToken: GBP.address as Address, giveAmt: 100n, getToken: USD.address as Address, getAmt: 127_000n, status: 'filled', taker: a(8), closedBlock: 5n }
  const name = (x: string) => (x === a(8) ? 'tester' : x)
  expect(takenBy(o, name)).toBe('tester')
  expect(takenBy(rowOf(o, GBP, USD)!, name)).toBe('tester')
  expect(takenBy({ ...o, status: 'open', taker: undefined, closedBlock: undefined }, name)).toBeUndefined()
})

const report = (over: Partial<TakeReport> = {}) => ({
  outcome: 'taken', tx: `0x${'ab'.repeat(32)}`, block: 7n, txIndex: 0, gasUsed: 91_234n, swap: a(5), taker: a(8),
  offer: { ...offer(4, GBP, 50_000n, USD, 635_000_000n, 'filled'), taker: a(8), closedBlock: 7n },
  title: 'Offer #4 taken', pill: 'Settled · 1 transaction', summary: `{name:${a(8)}} paid {amount:${a(2)}:635000000}, {name:${a(6)}} watched`,
  kpis: [], steps: [], balanceChanges: [{ holder: a(5), token: a(1), delta: -50_000n }, { holder: a(8), token: a(2), delta: -635_000_000n }],
  balanceNote: '', logs: [], ...over,
}) as TakeReport

test('reportLabels: account names, the Swap as "Swap", everyone else short', () => {
  const people = [{ label: 'tester', address: a(8).toUpperCase().replace('0X', '0x') }, { label: 'me', address: a(9) }]
  expect(reportLabels(report(), people)).toEqual({ [a(5)]: 'Swap', [a(8)]: 'tester', [a(9)]: 'me', [a(6)]: '0x0000…0006' })
})

test('reportJson: the report plus labels, bigints as decimal strings, round-trips through JSON.parse', () => {
  const labels = { [a(8)]: 'tester' }
  const j = JSON.parse(reportJson(report(), labels))
  expect(j.labels).toEqual(labels)
  expect([j.block, j.gasUsed, j.offer.id, j.offer.giveAmt, j.offer.closedBlock, j.balanceChanges[1].delta]).toEqual(['7', '91234', '4', '50000', '7', '-635000000'])
  expect(j.summary).toBe(report().summary)
  expect(JSON.parse(JSON.stringify(j))).toEqual(j)
})

test('reportFmt fills names, symbols, 2 dp amounts and the 4 dp price per the mockup', () => {
  const f = reportFmt({ [a(8)]: 'tester' }, [GBP, USD])
  expect(f.name(a(8))).toBe('tester')
  expect(f.name(a(6))).toBe('0x0000…0006')
  expect([f.symbol(a(2)), f.amount(635_000_000n, a(2)), f.amount(50_000n, a(1))]).toEqual(['USD', '635.00 USD', '500.00 GBP'])
  expect(f.price(a(1), 50_000n, a(2), 635_000_000n)).toBe('1.2700')
  expect(f.amount(5n, a(3))).toBe('5 0x0000…0003') // unknown token: raw units and its address
  expect(f.number(635_000_000n, a(2))).toBe('635.00')
})

test('reportFmt orients the price by the pair: quote per base for asks and bids', () => {
  const f = reportFmt({}, [GBP, USD], { base: a(1) })
  // ask: gives 500 GBP, gets 635 USD
  expect([f.price(a(1), 50_000n, a(2), 635_000_000n), f.unit(a(1), a(2))]).toEqual(['1.2700', 'USD per GBP'])
  // bid: gives 1,270 USD, gets 1,000 GBP
  expect([f.price(a(2), 1_270_000_000n, a(1), 100_000n), f.unit(a(2), a(1))]).toEqual(['1.2700', 'USD per GBP'])
  // no pair: get per give
  expect(reportFmt({}, [GBP, USD]).unit(a(2), a(1))).toBe('GBP per USD')
})
