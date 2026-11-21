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
import { Pool } from '../src/pages/Pool'
import { PoolTabs } from '../src/components/PoolTabs'
import { SendDialog } from '../src/components/SendDialog'
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
    for (const id of ['book', 'aliceOk1', 'ask1', 'aliceOk2', 'ask2', 'bobOk', 'buy', 'view']) expect(binding(bw.steps[bat(id)]!, bw).path(run)).toBe(`/trade?${q}`)
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
  test('off-chain, at Alice\'s second approve: the note and Approve more count her first ask (committed) too', async () => {
    let c: Wizard | null = null, approved: bigint | undefined
    const Probe = () => { c = useWizard(); return null }
    const el = (venue: 'onchain' | 'offchain') => h(OrderForm, {
      base: asset(GBP), quote: asset(USD), venue, funds: { base: { bal: 10n ** 8n, alw: 100000n, committed: 100000n }, quote: {} }, busy: false,
      onApprove: async (_a: Asset, n: bigint) => { approved = n; return undefined }, onPlace: async () => ({ placed: true }),
    })
    const html = render(h('div', null, el('offchain'), h(Probe)), { run: beforeBuy(), index: bat('aliceOk2') }, bw)
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Sell GBP/)
    expect(html).toContain('Settlement can spend 1,000.00 GBP of yours; this order needs 1,000.00 GBP; with your other open orders, 2,000.00 GBP.')
    expect(binding(bw.steps[bat('aliceOk2')]!, bw).fields).not.toContain('approve.amount')
    await c!.actions.get('order.approve')!()
    expect(approved).toBe(200000n) // 2,000 GBP: covers both asks
    // on-chain the first ask is escrowed: committed doesn't apply (and is 0 there anyway)
    const on = render(el('onchain'), { run: beforeBuy(), index: bat('aliceOk2') }, bw)
    expect(on).not.toContain('Approve more')
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

describe('Pool and Assets in the pool walkthrough', () => {
  const pw = bundled.find(x => x.id === 'gbp-usd-pool')!
  const pat = (id: string) => pw.steps.findIndex(s => s.id === id)
  const POOL = a(10)
  const values = () => ({ ...beforeOffer().values, swap: undefined as any, pool: { address: POOL } })
  const pr = (): Run => ({ ...newRun(pw), values: values() })
  const state = (rb: bigint, rq: bigint, S: bigint) => ({ address: POOL, base: GBP.address, quote: USD.address, baseDecimals: 2, quoteDecimals: 6, reserveBase: rb, reserveQuote: rq, totalShares: S })
  const tabs = (s: ReturnType<typeof state>, alw: bigint, calls: unknown[] = []) => h(PoolTabs, {
    s, base: asset(GBP), quote: asset(USD), funds: () => ({ bal: 10n ** 15n, alw }), busy: false, mine: 10n ** 20n,
    onApprove: async (t: Asset, n: bigint) => { calls.push(['approve', t.symbol, n]); return undefined },
    onSwap: async (t: Asset, n: bigint, min: bigint) => { calls.push(['swap', t.symbol, n, min]); return undefined },
    onAdd: async (b: bigint, q: bigint) => { calls.push(['add', b, q]); return undefined },
    onRemove: async (sh: bigint) => { calls.push(['remove', sh]); return undefined }, onAfter() {},
  })
  const full = state(10_000_000n, 127_000_000_000n, 10n ** 23n)
  const probe = () => { let c: Wizard | null = null; const Probe = () => { c = useWizard(); return null }; return { el: h(Probe), get: () => c! } }

  test('paths from the actual pair, fields and actions per step', () => {
    const q = `base=${GBP.address}&quote=${USD.address}`
    for (const id of ['pool', 'aliceGbp', 'aliceUsd', 'add', 'bobOk', 'swap', 'view']) expect(binding(pw.steps[pat(id)]!, pw).path(pr())).toBe(`/pool?${q}`)
    expect(binding(pw.steps[pat('pool')]!, pw)).toMatchObject({ fields: [], actions: ['pool.deploy'], report: 'pool.deploy' })
    expect(binding(pw.steps[pat('add')]!, pw)).toMatchObject({ fields: ['pool.tab', 'add.base', 'add.quote'], actions: ['pool.add'] })
    expect(binding(pw.steps[pat('aliceUsd')]!, pw)).toMatchObject({ fields: ['pool.tab', 'add.base', 'add.quote'], actions: ['pool.approve'], report: 'pool.approve' })
    expect(binding(pw.steps[pat('swap')]!, pw)).toMatchObject({ fields: ['pool.tab', 'swap.pay', 'swap.amount', 'swap.slippage'], actions: ['pool.swap'] })
    const rm = { id: 'rm', do: 'removeLiquidity' as const, title: 'x', text: 'x', args: { from: '$alice', pool: '$pool', percent: 50 } }
    expect(binding(rm, pw)).toMatchObject({ fields: ['pool.tab', 'remove.percent'], actions: ['pool.remove'] })
    expect(binding(rm, pw).path(pr())).toBe(`/pool?${q}`)
    const send = binding(pw.steps[pat('send')]!, pw)
    expect(send).toMatchObject({ fields: ['send.to', 'send.amount'], actions: ['assets.send', 'send.submit'], report: 'send.submit' })
    expect(send.path(pr())).toBe(`/assets?asset=${encodeURIComponent(`c1:${GBP.address}`)}`)
  })
  test("PoolTabs at Bob's swap: the Swap tab, 1,000 GBP at 0.5% filled, Swap pulses and presses with the quoted minimum", async () => {
    const calls: unknown[] = [], p = probe()
    const html = render(h('div', null, tabs(full, 10n ** 15n, calls), p.el), { run: pr(), index: pat('swap') }, pw)
    expect(html).toMatch(/<section[^>]*data-wizard="pool.card"[^>]*data-wz-on=""/)
    expect(html).toMatch(/<input[^>]*id="pl-pay"[^>]*value="1000"/)
    expect(html).toMatch(/aria-pressed="true"[^>]*>0.5%/)
    expect(html).toMatch(/<button[^>]*data-wizard="pool.swap"[^>]*data-wz-pulse=""/)
    await p.get().actions.get('pool.swap')!()
    expect(calls).toEqual([['swap', 'GBP', 100000n, 1247422249n]])
  })
  test('PoolTabs at the add\'s approves: an empty pool shows Add liquidity filled; each approve step approves its own token', async () => {
    const empty = state(0n, 0n, 0n)
    for (const [id, want] of [['aliceGbp', ['approve', 'GBP', 10_000_000n]], ['aliceUsd', ['approve', 'USD', 127_000_000_000n]]] as const) {
      const calls: unknown[] = [], p = probe()
      const html = render(h('div', null, tabs(empty, 0n, calls), p.el), { run: pr(), index: pat(id) }, pw)
      expect(html).toMatch(/<input[^>]*id="pl-add-b"[^>]*value="100000"/)
      expect(html).toMatch(/<input[^>]*id="pl-add-q"[^>]*value="127000"/)
      expect(html.match(/data-wz-pulse=""/g)).toHaveLength(1)
      expect(html).toMatch(new RegExp(`data-wizard="pool.approve"[^>]*data-wz-pulse=""[^>]*>\\d · Approve [\\d.]+ ${want[1]}<`))
      await p.get().actions.get('pool.approve')!()
      expect(calls).toEqual([want])
    }
    const p = probe(), calls: unknown[] = []
    const ok = render(h('div', null, tabs(empty, 10n ** 15n, calls), p.el), { run: pr(), index: pat('add') }, pw)
    expect(ok).toMatch(/<button[^>]*data-wizard="pool.add"[^>]*data-wz-pulse=""[^>]*>Add liquidity/)
    await p.get().actions.get('pool.add')!()
    expect(calls).toEqual([['add', 10_000_000n, 127_000_000_000n]])
  })
  test('pool.tab switches to Remove and remove.percent fills the shares', () => {
    const rw = structuredClone(pw) as typeof pw
    rw.steps.splice(rw.steps.length - 1, 0, { id: 'rm', do: 'removeLiquidity', title: 'x', text: 'x', args: { from: '$alice', pool: '$pool', percent: 50 } })
    const html = render(tabs(full, 10n ** 15n), { run: pr(), index: rw.steps.length - 2 }, rw)
    expect(html).toMatch(/aria-selected="true"[^>]*>Remove</)
    expect(html).toMatch(/aria-pressed="true"[^>]*>50%/)
  })
  test('SendDialog at the transfer: Bob and 1,000 filled, Send pulses; a failure rejects with the dialog\'s message', async () => {
    const people = [{ label: 'alice', address: a(7) }, { label: 'bob', address: a(8) }] as any
    const p = probe()
    const el = h(SendDialog, { dialogRef: { current: null }, chain: {} as any, asset: asset(GBP), from: people[0], balance: 0n, accounts: people, onSent() {}, onClose() {} })
    const html = render(h('div', null, el, p.el), { run: pr(), index: pat('send') }, pw)
    expect(html).toMatch(new RegExp(`<option value="${a(8)}" selected=""`))
    expect(html).toMatch(/aria-label="Amount"[^>]*value="1000"/)
    expect(html).toMatch(/<button[^>]*data-wizard="send.submit"[^>]*data-wz-pulse=""/)
    await expect(Promise.resolve(p.get().actions.get('send.submit')!())).rejects.toThrow('More than the balance')
  })
  test('outside a walkthrough Pool, PoolTabs and SendDialog carry no data-wz-* attributes', () => {
    const people = [{ label: 'alice', address: a(7) }] as any
    for (const el of [h(Pool), tabs(full, 0n), h(SendDialog, { dialogRef: { current: null }, chain: {} as any, asset: asset(GBP), from: people[0], accounts: people, onSent() {}, onClose() {} })])
      expect(wzAttrs(render(el))).toEqual([])
  })
})
