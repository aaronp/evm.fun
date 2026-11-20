import { describe, test, expect } from 'bun:test'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Asset } from '@evmb/assets'
import { bundled } from '../walkthroughs'
import { WizardProvider, useWizard, type Wizard } from '../src/walkthrough/wizard'
import { AppState } from '../src/state'
import { AppBarProvider } from '../src/state/appBar'
import { newRun } from '../src/walkthrough/run'
import { Accounts } from '../src/pages/Accounts'
import { Swap } from '../src/pages/Swap'
import { MakeOfferCard } from '../src/components/MakeOfferCard'
import { OrderForm } from '../src/components/OrderForm'
import { MyOrders } from '../src/components/MyOrders'
import { Trade } from '../src/pages/Trade'
import { binding } from '../src/walkthrough/bindings'
import type { Order } from '@evmb/orderbook'
import type { Outputs, Run } from '../src/walkthrough/types'

const w = bundled.find(x => x.id === 'gbp-usd')!
const at = (id: string) => w.steps.findIndex(s => s.id === id)
const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`
const GBP: Outputs['launchAsset'] = { address: a(1), symbol: 'GBP', name: 'Pound', decimals: 2 }
const USD: Outputs['launchAsset'] = { address: a(2), symbol: 'USD', name: 'Dollar', decimals: 6 }
const beforeOffer = (): Run => ({
  ...newRun(w),
  values: { alice: { label: 'alice', address: a(7) }, bob: { label: 'bob', address: a(8) }, chain: { id: 'c1', name: 'Example' }, GBP, USD, swap: { address: a(5) } },
})
const asset = (o: Outputs['launchAsset']) => ({ kind: 'erc20', chainId: 'c1', id: o.address, ...o }) as unknown as Asset

const render = (el: any, seed?: { run: Run; index: number }, wk = w) =>
  renderToString(h(MemoryRouter, null, h(AppState, null, h(AppBarProvider, null, seed ? h(WizardProvider, { seed: { w: wk, ...seed } }, el) : el)))).replaceAll('<!-- -->', '')
const offerCard = (funds = () => ({})) => h(MakeOfferCard, { base: asset(GBP), quote: asset(USD), funds, busy: false, onApprove() {}, onCreate: async () => ({ made: true }) })
const wzAttrs = (html: string) => html.match(/data-wz-[\w-]+/g) ?? []

describe('pages in a walkthrough', () => {
  test('Accounts at an account step: the label filled, Create account pulses', () => {
    const html = render(h(Accounts), { run: newRun(w), index: at('alice') })
    expect(html).toMatch(/<input[^>]*value="alice"/)
    expect(html).toMatch(/<button[^>]*data-wizard="account.create"[^>]*data-wz-pulse=""[^>]*>Create account<\/button>/)
  })
  test('MakeOfferCard at the offer step: its card is on, the create button is marked, fields filled', () => {
    const html = render(offerCard(), { run: beforeOffer(), index: at('offer') })
    expect(html).toMatch(/<section[^>]*data-wizard="offer.card"[^>]*data-wz-on=""/)
    expect(html).toMatch(/<button[^>]*data-wizard="offer.create"[^>]*data-wz-pulse=""/)
    expect(html).toMatch(/<input[^>]*id="fa"[^>]*value="1000"/)
    expect(html).toMatch(/aria-label="Side"[^>]*data-wizard="offer.side"[^>]*data-wz-on=""/)
  })
})

describe('pages outside a walkthrough', () => {
  test('Accounts, Swap and MakeOfferCard carry no data-wz-* attributes, only data-wizard', () => {
    for (const el of [h(Accounts), h(Swap), offerCard()]) {
      expect(wzAttrs(render(el))).toEqual([])
    }
    expect(render(h(Accounts))).toContain('data-wizard="account.create"')
    expect(render(offerCard())).toContain('data-wizard="offer.create"')
  })
})

describe('fix round 1', () => {
  test("a failing action rejects with the page's own message, so Next shows it as the step error", async () => {
    let c: Wizard | null = null
    const Probe = () => { c = useWizard(); return null }
    render(h('div', null, offerCard(() => ({ bal: 0n, alw: 0n })), h(Probe)), { run: beforeOffer(), index: at('offer') })
    const press = c!.actions.get('offer.create')!
    expect(press).toBeDefined()
    await expect(Promise.resolve(press())).rejects.toThrow('Not enough GBP — you have 0')
  })
  test('an offer id that is not a number (edited JSON) does not crash Swap', () => {
    const run: Run = { ...beforeOffer(), values: { ...beforeOffer().values, offer: { offerId: 'x', tx: `0x${'ab'.repeat(32)}` } } }
    expect(() => render(h(Swap), { run, index: at('take') })).not.toThrow()
  })
})

describe('Trade in an order-book walkthrough', () => {
  const bw = bundled.find(x => x.id === 'gbp-usd-book-offchain')!
  const bat = (id: string) => bw.steps.findIndex(s => s.id === id)
  const BOOK = { address: a(9), venue: 'offchain' as const }
  const beforeBuy = (): Run => ({
    ...newRun(bw),
    values: { ...beforeOffer().values, swap: undefined as any, book: BOOK, ask1: { orderId: '0x' + 'a1'.repeat(32), filled: '0' }, ask2: { orderId: '0x' + 'a2'.repeat(32), filled: '0' } },
  })
  const form = (alw: bigint) => h(OrderForm, {
    base: asset(GBP), quote: asset(USD), venue: 'offchain', funds: { base: {}, quote: { bal: 10n ** 12n, alw } }, busy: false,
    onApprove: async () => undefined, onPlace: async () => ({ placed: true }),
  })
  const order = (id: string, status: Order['status']): Order => ({
    id, venue: 'offchain', owner: a(7), market: { base: GBP.address, quote: USD.address }, side: 'sell', price: 1_270000n,
    amount: 100000n, filled: 0n, status, placedAt: { time: '' },
  })

  test('paths come from the actual venue kind and pair', () => {
    const run = beforeBuy()
    const q = `venue=offchain&base=${GBP.address}&quote=${USD.address}`
    for (const id of ['book', 'aliceOk', 'ask1', 'bobOk', 'buy', 'view']) expect(binding(bw.steps[bat(id)]!, bw).path(run)).toBe(`/trade?${q}`)
    expect(binding(bw.steps[bat('book')]!, bw).path(newRun(bw))).toBe('/trade?venue=offchain')
    expect(binding(bw.steps[bat('buy')]!, bw)).toMatchObject({ fields: ['order.side', 'order.type', 'order.price', 'order.amount'], actions: ['order.submit'], report: 'order.submit' })
    expect(binding(bw.steps[bat('bobOk')]!, bw)).toMatchObject({ actions: ['order.approve'], report: 'order.approve' })
    expect(binding(bw.steps[bat('book')]!, bw)).toMatchObject({ actions: ['trade.deploy'], report: 'trade.deploy' })
    const cancel = { id: 'c', do: 'cancelOrder' as const, title: 'c', text: 'c', args: { from: '$alice', order: '$ask2' } }
    expect(binding(cancel, bw)).toMatchObject({ fields: ['cancel.order'], actions: ['order.cancel'] })
    expect(binding(cancel, bw).path(beforeBuy())).toBe(`/trade?${q}`)
  })
  test('OrderForm at Bob\'s buy: fields filled, Approve more pulses while short, then the submit', () => {
    const short = render(form(0n), { run: beforeBuy(), index: bat('bobOk') }, bw)
    expect(short).toMatch(/<input[^>]*id="op"[^>]*value="1.28"/)
    expect(short).toMatch(/<input[^>]*id="oa"[^>]*value="1500"/)
    expect(short).toMatch(/aria-label="Side"[^>]*data-wizard="order.side"[^>]*data-wz-on=""/)
    expect(short).toMatch(/<button[^>]*data-wizard="order.approve"[^>]*data-wz-pulse=""[^>]*>Approve more/)
    const ok = render(form(10n ** 12n), { run: beforeBuy(), index: bat('buy') }, bw)
    expect(ok).toMatch(/<button[^>]*data-wizard="order.submit"[^>]*data-wz-pulse=""[^>]*>Buy 1,500 GBP<\/button>/)
  })
  test('at an approve before a placeOrder, Approve more approves the step\'s own amount, not just this order\'s need', async () => {
    let c: Wizard | null = null, approved: bigint | undefined
    const Probe = () => { c = useWizard(); return null }
    const el = h(OrderForm, {
      base: asset(GBP), quote: asset(USD), venue: 'onchain', funds: { base: { bal: 10n ** 8n, alw: 0n }, quote: {} }, busy: false,
      onApprove: async (_a: Asset, n: bigint) => { approved = n; return undefined }, onPlace: async () => ({ placed: true }),
    })
    const html = render(h('div', null, el, h(Probe)), { run: beforeBuy(), index: bat('aliceOk') }, bw)
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Sell GBP/)
    expect(binding(bw.steps[bat('aliceOk')]!, bw).fields).toContain('approve.amount')
    await c!.actions.get('order.approve')!()
    expect(approved).toBe(200000n) // 2,000 GBP: covers both asks
  })
  test('a failed submit rejects with the form\'s own message', async () => {
    let c: Wizard | null = null
    const Probe = () => { c = useWizard(); return null }
    const failing = h(OrderForm, {
      base: asset(GBP), quote: asset(USD), venue: 'offchain', funds: { base: {}, quote: { bal: 10n ** 12n, alw: 10n ** 12n } }, busy: false,
      onApprove: async () => undefined, onPlace: async () => ({ placed: false, error: 'Order reverted: ERC20InsufficientBalance' }),
    })
    render(h('div', null, failing, h(Probe)), { run: beforeBuy(), index: bat('buy') }, bw)
    await expect(Promise.resolve(c!.actions.get('order.submit')!())).rejects.toThrow('Order reverted: ERC20InsufficientBalance')
  })
  test('MyOrders at a cancel step targets the step\'s order', () => {
    const cw = structuredClone(bw) as typeof bw
    cw.steps.push({ id: 'cancel', do: 'cancelOrder', title: 'c', text: 'c', args: { from: '$alice', order: '$ask2' } })
    const ask2 = (beforeBuy().values.ask2 as Outputs['placeOrder']).orderId!
    const el = h(MyOrders, { orders: [order('0x' + 'a1'.repeat(32), 'filled'), order(ask2, 'partial'), order('0x' + 'a3'.repeat(32), 'open')], base: asset(GBP), quote: asset(USD), venue: 'offchain', busy: false, onCancel: async () => undefined })
    const html = render(el, { run: beforeBuy(), index: cw.steps.length - 1 }, cw)
    expect(html.match(/data-wizard="order.cancel"/g)).toHaveLength(1)
    expect(html).toMatch(new RegExp(`title="${ask2}"[\\s\\S]*?data-wizard="order.cancel"[^>]*data-wz-pulse=""`))
  })
  test('outside a walkthrough Trade, OrderForm and MyOrders carry no data-wz-* attributes', () => {
    for (const el of [h(Trade), form(0n), h(MyOrders, { orders: [order('1', 'open')], base: asset(GBP), quote: asset(USD), venue: 'onchain', busy: false, onCancel: async () => undefined })])
      expect(wzAttrs(render(el))).toEqual([])
    expect(render(form(0n))).toContain('data-wizard="order.submit"')
  })
})
