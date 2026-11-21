import { test, expect } from 'bun:test'
import { encodeDeployData, encodeFunctionData, getAddress, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AssetToken } from '@evmb/contracts'
import { bookSchema, memoryStore, type Level } from '@evmb/orderbook'
import { kv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'
import { contractsRegistry } from '../src/contracts/registry'
import { signAndSend } from '../src/tx/send'
import { deployVenue, openVenue, venueFor } from '../src/orderbook/locate'
import { walletOf } from '../src/orderbook/wallet'
import { depthPaths, sizeText, spreadOf } from '../src/orderbook/ui'
import type { Account } from '../src/store/accounts'

const key = `0x${'11'.repeat(32)}` as const
const me: Account = { label: 'me', address: privateKeyToAccount(key).address, privateKey: key }

function registry() {
  const stores = new Map<string, any>()
  return createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
  })
}

for (const [kind, name] of [['onchain', 'OrderBook'], ['offchain', 'Settlement']] as const) {
  test(`${kind}: no record → undefined; deployVenue adds one ${name} record venueFor finds; the newer of two wins`, async () => {
    const h = await registry().create('c', 'plain', [me.address])
    try {
      expect(await venueFor(h, kind)).toBeUndefined()
      let sent = 0
      const first = await deployVenue(h, kind, me, () => sent++)
      expect(sent).toBe(1)
      const recs = await contractsRegistry.list(h.info.id)
      expect(recs.map(r => r.name)).toEqual([name])
      expect(recs[0]).toMatchObject({ address: first, deployer: me.address })
      expect(await venueFor(h, kind)).toBe(first)
      const second = await deployVenue(h, kind, me)
      expect(await venueFor(h, kind)).toBe(second)
    } finally { await h.dispose() }
  })
}

test('a record with the right name but a foreign ABI is not a venue', async () => {
  const h = await registry().create('c', 'plain', [me.address])
  try {
    const at = await deployVenue(h, 'onchain', me)
    const [r] = await contractsRegistry.list(h.info.id)
    await contractsRegistry.replace(h.info.id, [{ ...r!, abi: AssetToken.abi as any[] }])
    expect(await venueFor(h, 'onchain')).toBeUndefined()
    expect(at).toBeTruthy()
  } finally { await h.dispose() }
})

test('deployVenue on a benchmark chain throws and records nothing', async () => {
  const reg = registry()
  const h = await reg.create('bench', 'plain', [me.address])
  try {
    reg.addEphemeral(h)
    await expect(deployVenue(h, 'offchain', me)).rejects.toThrow('Benchmark chains keep no contract records')
    expect(await contractsRegistry.list(h.info.id)).toEqual([])
  } finally { await h.dispose() }
})

test('a fork keeps its own venue records and its off-chain rows keyed by its own chain id; walletOf sends and signs', async () => {
  const reg = registry()
  const p = await reg.create('parent', 'plain', [me.address])
  try {
    const settlement = await deployVenue(p, 'offchain', me)
    const tok = async (sym: string, dec: number) => {
      const r = await signAndSend(p, me, { data: encodeDeployData({ abi: AssetToken.abi, bytecode: AssetToken.bytecode, args: [sym, sym, dec, 10n ** 12n, me.address] }) })
      return getAddress(r.contractAddress!) as Address
    }
    const gbp = await tok('GBP', 2), usd = await tok('USD', 6)
    await signAndSend(p, me, { to: gbp, data: encodeFunctionData({ abi: AssetToken.abi, functionName: 'approve', args: [settlement, 10n ** 12n] }) })

    const f = await reg.createFrom(await p.approach.snapshot!(), {
      name: 'fork', type: 'plain', contracts: await contractsRegistry.list(p.info.id),
      source: { kind: 'snapshot', snapshotName: 's', fromChainName: 'parent', height: 0 },
    })
    try {
      expect(await venueFor(f, 'offchain')).toBe(settlement)
      const store = memoryStore(bookSchema) // one store for both chains, as the app's bookStore
      const onFork = (await openVenue(f, 'offchain', store))!, onParent = (await openVenue(p, 'offchain', store))!
      const market = { base: gbp, quote: usd }
      await onFork.place(walletOf(f, me), { market, side: 'sell', type: 'limit', price: 1_270_000n, amount: 50_000n })
      expect((await onFork.orders({ owner: me.address })).map(o => [o.side, o.amount, o.status])).toEqual([['sell', 50_000n, 'open']])
      expect(await onParent.orders({ owner: me.address })).toEqual([])
      expect((await onFork.book(market)).asks.map(l => [l.price, l.size])).toEqual([[1_270_000n, 50_000n]])
      expect((await onParent.book(market)).asks).toEqual([])

      // the fork's own OrderBook: recorded on the fork only; walletOf's sendTransaction gives the receipt the venue needs
      const book = await deployVenue(f, 'onchain', me)
      expect(await venueFor(p, 'onchain')).toBeUndefined()
      expect(await venueFor(f, 'onchain')).toBe(book)
      await signAndSend(f, me, { to: gbp, data: encodeFunctionData({ abi: AssetToken.abi, functionName: 'approve', args: [book, 10n ** 12n] }) })
      const ob = (await openVenue(f, 'onchain', store))!
      const r = await ob.place(walletOf(f, me), { market, side: 'sell', type: 'limit', price: 1_280_000n, amount: 1_000n })
      expect(r.tx).toMatch(/^0x/)
      expect((await ob.book(market)).asks.map(l => [l.price, l.size])).toEqual([[1_280_000n, 1_000n]])
    } finally { await f.dispose() }
  } finally { await p.dispose() }
}, 60_000)

test('Trade sits under Markets after Swap and Pool; without a chain it says "Select a chain first."', async () => {
  const { createElement: h } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { MemoryRouter } = await import('react-router-dom')
  const { groups, real } = await import('../src/App')
  const { AppState } = await import('../src/state')
  const { AppBarProvider } = await import('../src/state/appBar')
  expect(groups.find(g => g.label === 'Markets')!.items.map(([n]) => n)).toEqual(['Assets', 'Swap', 'Pool', 'Trade'])
  const html = renderToString(h(MemoryRouter, { initialEntries: ['/trade'] }, h(AppState, null, h(AppBarProvider, null, real.Trade!))))
  expect(html).toContain('Select a chain first.')
})

const lv = (price: bigint, size: bigint, total: bigint): Level => ({ price, size, total, orders: 1 })

test('spreadOf: best ask - best bid, in bps of the mid to 1 dp; none without both sides', () => {
  expect(spreadOf([lv(12698n, 1n, 1n)], [lv(12703n, 1n, 1n)])).toEqual({ spread: 5n, bps: '3.9' })
  expect(spreadOf([lv(10000n, 1n, 1n)], [lv(10100n, 1n, 1n)])).toEqual({ spread: 100n, bps: '99.5' })
  expect(spreadOf([], [lv(1n, 1n, 1n)])).toBeUndefined()
  // a crossed (or locked) book has no spread to format: no negative numbers
  expect(spreadOf([lv(1_300_000n, 1n, 1n)], [lv(1_270_000n, 1n, 1n)])).toBe('crossed')
  expect(spreadOf([lv(1_270_000n, 1n, 1n)], [lv(1_270_000n, 1n, 1n)])).toBe('crossed')
})

test('depthPaths: a crossed book centres on the midpoint of the bests and keeps lo < hi', () => {
  const d = depthPaths([lv(130n, 1n, 1n), lv(120n, 1n, 2n)], [lv(127n, 1n, 1n)])!
  // mid 128.5, furthest end 120 (8.5) + 6% → 119.49 .. 137.51
  expect(d.lo).toBe(119n)
  expect(d.hi).toBe(138n)
  expect(d.bid).toStartWith('M') // the best bid sits right of the mid, inside the chart
  expect(d.bid!.includes('NaN')).toBe(false)
  const one = depthPaths([lv(130n, 1n, 1n)], [lv(127n, 1n, 1n)])!
  expect(one.lo < one.hi).toBe(true)
})

test('depthPaths: mid at the centre, step areas from the best level outwards, edges labelled', () => {
  const d = depthPaths([lv(100n, 1n, 1n), lv(90n, 2n, 3n)], [lv(110n, 3n, 3n)])!
  // mid 105, half-width 15 + 6% → 89.1 .. 120.9 over x 10..550; y = 200 - cum/3 * 175
  expect(d.lo).toBe(89n)
  expect(d.hi).toBe(121n)
  expect(d.bid).toBe('M195.1 200 L195.1 200.0 L195.1 141.7 L25.3 141.7 L25.3 25.0 L10 25.0')
  expect(d.ask).toBe('M364.9 200 L364.9 200.0 L364.9 25.0 L550 25.0')
  expect(d.bidFill).toBe(`${d.bid} L10 200 Z`)
  expect(d.askFill).toBe(`${d.ask} L550 200 Z`)
  expect(depthPaths([], [])).toBeUndefined()
  expect(depthPaths([lv(100n, 1n, 1n)], [])!.ask).toBeUndefined()
})

test('sizeText: whole sizes without decimals, fractions to 2 dp', () => {
  expect(sizeText(100_000n, 2)).toBe('1,000')
  expect(sizeText(50n, 2)).toBe('0.50')
})

// ---- Task 9: order form maths, form/My orders copy, trade report ----

const GBP = { symbol: 'GBP', decimals: 2 }, USD = { symbol: 'USD', decimals: 6 }
// asks: 1,000 GBP at 1.2700 (two orders), then 2,000 GBP at 1.2710 (one order)
const asks = [{ price: 1_270_000n, size: 100_000n, total: 100_000n, orders: 2 }, { price: 1_271_000n, size: 200_000n, total: 300_000n, orders: 1 }]
const bids = [{ price: 1_269_000n, size: 100_000n, total: 100_000n, orders: 1 }]

test('plan: market buy estimate (ceil per level), at most = worst price + 1 raw per fill; thin; limit buy counts crossing fills only', async () => {
  const { plan } = await import('../src/orderbook/form')
  const m = plan({ side: 'buy', type: 'market', amount: 150_000n, slippageBps: 100 }, asks, 2)
  // 1,000 @ 1.2700 = 1,270 USD + 500 @ 1.2710 = 635.50 USD; worst 1.2710 × 1.01 = 1.28371
  expect(m).toMatchObject({ filled: 150_000n, fills: 3, estimate: 1_905_500_000n, price: 1_283_710n, bound: 1_925_565_003n, need: 1_925_565_003n, thin: false })
  expect(plan({ side: 'buy', type: 'market', amount: 400_000n, slippageBps: 100 }, asks, 2)).toMatchObject({ filled: 300_000n, thin: true })
  expect(plan({ side: 'buy', type: 'limit', price: 1_270_000n, amount: 150_000n, slippageBps: 100 }, asks, 2))
    .toMatchObject({ filled: 100_000n, fills: 2, bound: 1_905_000_002n, need: 1_905_000_002n, thin: false })
  // a sell needs its base; it receives at least amount × price rounded down
  expect(plan({ side: 'sell', type: 'limit', price: 1_280_000n, amount: 50_000n, slippageBps: 100 }, bids, 2))
    .toMatchObject({ filled: 0n, fills: 0, bound: 640_000_000n, need: 50_000n, thin: false })
  const s = plan({ side: 'sell', type: 'market', amount: 50_000n, slippageBps: 100 }, bids, 2)
  expect(s).toMatchObject({ estimate: 634_500_000n, price: 1_256_310n, bound: 628_155_000n, need: 50_000n })
  expect(plan({ side: 'buy', type: 'market', amount: 1n, slippageBps: 100 }, [], 2)).toMatchObject({ thin: true, price: undefined })
})

test('plan off-chain: no slippage, settles at the makers\' prices; "at most" bounds the sum of per-fill ceilings', async () => {
  const { plan } = await import('../src/orderbook/form')
  // per level: ceil(take × price) plus one raw unit for each further order in it (each fill rounds up on its own)
  const m = plan({ side: 'buy', type: 'market', amount: 150_000n, slippageBps: 100 }, asks, 2, 'offchain')
  expect(m).toMatchObject({ filled: 150_000n, fills: 3, estimate: 1_905_500_000n, price: undefined, bound: 1_905_500_001n, need: 1_905_500_001n, thin: false })
  // a limit buy: the crossing fills, then the rest at the limit (rounded up)
  const l = plan({ side: 'buy', type: 'limit', price: 1_270_500n, amount: 150_000n, slippageBps: 100 }, asks, 2, 'offchain')
  expect(l).toMatchObject({ filled: 100_000n, fills: 2, bound: 1_270_000_001n + 635_250_000n })
  expect(plan({ side: 'buy', type: 'market', amount: 400_000n, slippageBps: 100 }, asks, 2, 'offchain')).toMatchObject({ thin: true })
  expect(plan({ side: 'sell', type: 'market', amount: 50_000n, slippageBps: 100 }, bids, 2, 'offchain')).toMatchObject({ bound: 634_500_000n, need: 50_000n })
})

test('percentAmount: a sell takes the share of its base; a buy the largest amount whose "at most" fits the share', async () => {
  const { percentAmount } = await import('../src/orderbook/form')
  const o = (side: 'buy' | 'sell', type: 'limit' | 'market', price?: bigint) => ({ side, type, price, slippageBps: 100 })
  expect(percentAmount(50, o('sell', 'limit', 1_280_000n), 100_000n, bids, 2)).toBe(50_000n)
  expect(percentAmount(25, o('buy', 'limit', 1_270_000n), 1_000_000_000n, asks, 2)).toBe(19_685n)
  // 1,270.000001 USD would buy 1,000 GBP but the two fills' raw units push it over: one raw GBP less
  expect(percentAmount(100, o('buy', 'limit', 1_270_000n), 1_270_000_001n, asks, 2)).toBe(99_999n)
  expect(percentAmount(100, o('buy', 'market'), 10n ** 12n, asks, 2)).toBe(300_000n) // never more than the book holds
  expect(percentAmount(100, o('buy', 'market'), 10n ** 12n, [], 2)).toBe(0n)
  expect(percentAmount(100, o('buy', 'market'), 1_905_500_001n, asks, 2, 'offchain')).toBe(150_000n)
})

test('off-chain Available and 25/50/75/Max leave out what the maker\'s other open orders hold', async () => {
  const { availableText, percentAmount, plan, spendable } = await import('../src/orderbook/form')
  // holds 1,000 GBP, 1,000 GBP already on an open sell: Max sells nothing more (was 1,000 → "You hold … with your other open orders, 2,000")
  expect(spendable(100_000n, 100_000n)).toBe(0n)
  expect(availableText(100_000n, 100_000n, GBP)).toBe('0.00 GBP (1,000.00 GBP on open orders)')
  expect(availableText(100_000n, 0n, GBP)).toBe('1,000.00 GBP') // on-chain (held 0): unchanged
  expect(spendable(100_000n, 150_000n)).toBe(0n)
  // a buy: Max's "at most" plus the 1,000 USD held stays within the 3,000 USD balance
  const o = { side: 'buy' as const, type: 'limit' as const, price: 1_270_000n, slippageBps: 100 }
  const bal = 3_000_000_000n, held = 1_000_000_000n
  const max = percentAmount(100, o, spendable(bal, held), asks, 2, 'offchain')
  expect(plan({ ...o, amount: max }, asks, 2, 'offchain').need! + held <= bal).toBe(true)
  expect(plan({ ...o, amount: max + 1n }, asks, 2, 'offchain').need! + held > bal).toBe(true)
})

test('form text: slippage (bps, clamped 0–50%), worst price rounded away from the book, submit label, allowance note, approve amount', async () => {
  const { slippageOf, priceAway, submitText, allowanceNote, approveFor } = await import('../src/orderbook/form')
  expect(slippageOf('1')).toBe(100)
  expect(slippageOf('0.25')).toBe(25)
  expect(slippageOf('80')).toBe(5000)
  expect(slippageOf('0')).toBe(0)
  expect(slippageOf('x')).toEqual({ error: 'Slippage must be a percentage with at most 2 decimals' })
  expect(priceAway(1_283_710n, 'buy', 6)).toBe('1.2838')
  expect(priceAway(1_256_310n, 'sell', 6)).toBe('1.2563')
  expect(priceAway(1_256_300n, 'buy', 6)).toBe('1.2563')
  expect(submitText('buy', 500_000n, GBP)).toBe('Buy 5,000 GBP')
  expect(submitText('sell', 50n, GBP)).toBe('Sell 0.50 GBP')
  expect(submitText('buy', undefined, GBP)).toBe('Buy GBP')
  expect(allowanceNote('OrderBook', 5_000_000_000n, 6_352_500_000n, USD)).toBe('OrderBook can spend 5,000.00 USD of yours; this order needs 6,352.50 USD.')
  expect(allowanceNote('Settlement', 5_000_000_000n, 6_352_500_000n, USD, 1_000_000_000n))
    .toBe('Settlement can spend 5,000.00 USD of yours; this order needs 6,352.50 USD; with your other open orders, 7,352.50 USD.')
  expect(approveFor(6_352_500_000n, 5_000_000_000n)).toBe(6_352_500_000n) // approve sets the allowance: up by exactly the shortfall
  expect(approveFor(5n, 5n)).toBeUndefined()
})

const tokAsset = (symbol: string, decimals: number, n: number) => ({
  id: symbol, chainId: 'c', kind: 'erc20' as const, address: `0x${String(n).repeat(40)}` as Address, symbol, name: symbol, decimals,
  origin: 'deployed' as const, mintable: true, addedAt: '',
})

async function ssr(el: (h: typeof import('react').createElement) => any) {
  const { createElement: h } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { MemoryRouter } = await import('react-router-dom')
  return renderToString(h(MemoryRouter, null, el(h))).replaceAll('<!-- -->', '')
}

test('OrderForm renders the mockup copy (no fee row, no settlement select)', async () => {
  const { OrderForm } = await import('../src/components/OrderForm')
  const base = tokAsset('GBP', 2, 1), quote = tokAsset('USD', 6, 2)
  const html = await ssr(h => h(OrderForm, {
    base, quote, book: { bids, asks }, venue: 'onchain', funds: { base: { bal: 100_000n, alw: 0n }, quote: { bal: 10n ** 10n, alw: 0n } },
    busy: false, onApprove: async () => undefined, onPlace: async () => ({ placed: true }),
  }))
  for (const s of ['Buy GBP', 'Sell GBP', 'Limit', 'Market', 'Limit price', 'Amount', '25%', '50%', '75%', 'Max', 'You pay', 'Available', '10,000.00 USD'])
    expect(html).toContain(s)
  expect(html).not.toContain('Taker fee')
  expect(html).not.toContain('Settlement')
})

test('MyOrders: filters, columns, badges; Cancel on open/partial, Report → otherwise; empty state', async () => {
  const { MyOrders } = await import('../src/components/MyOrders')
  const base = tokAsset('GBP', 2, 1), quote = tokAsset('USD', 6, 2)
  const order = (id: string, side: 'buy' | 'sell', status: any, filled = 0n) => ({
    id, venue: 'onchain' as const, owner: me.address, market: { base: base.address, quote: quote.address }, side, price: 1_270_500n,
    amount: 500_000n, filled, status, placedAt: { time: '' },
  })
  const rows = [order('12', 'buy', 'filled', 500_000n), order('13', 'sell', 'partial', 100_000n), order(`tx:0x${'ab'.repeat(32)}`, 'buy', 'failed'), order('14', 'sell', 'unfunded'),
    { ...order(`tx:0x${'cd'.repeat(32)}`, 'buy', 'failed'), reason: 'ERC20InsufficientAllowance' }, { ...order(`tx:0x${'ef'.repeat(32)}`, 'sell', 'failed'), reason: 'BookTooThin' }]
  const html = await ssr(h => h(MyOrders, { orders: rows, base, quote, venue: 'onchain', busy: false, onCancel: async () => undefined }))
  for (const s of ['My orders', 'All', 'Open', 'Failed', 'Order', 'Side', 'Price', 'Filled / size', 'Status', '#12', 'Buy GBP', 'Sell GBP', '1.2705', '5,000 / 5,000', '1,000 / 5,000', 'filled', 'partial', 'failed', 'unfunded', 'Cancel', 'Report →', '0xabab…abab'])
    expect(html).toContain(s)
  expect(html).toContain(`href="/trade/report?id=12&amp;venue=onchain&amp;base=${base.address}&amp;quote=${quote.address}"`)
  // partial and unfunded: an unfunded off-chain order is still a live signed order that a later approve would re-fund
  expect(html.match(/>Cancel</g)?.length).toBe(2)
  // the revert reason captured at origin; an attempt without one stays plain "failed"
  expect(html).toContain('failed · allowance')
  expect(html).toContain('failed · thin book')
  expect(html.match(/>failed</g)?.length).toBe(1)
  expect(await ssr(h => h(MyOrders, { orders: [], base, quote, venue: 'onchain', busy: false, onCancel: async () => undefined }))).toContain('No orders yet')
})

test('RecentTrades: an empty market says "No trades yet"', async () => {
  const { RecentTrades } = await import('../src/components/RecentTrades')
  expect(await ssr(h => h(RecentTrades, { trades: [], base: GBP, quoteDecimals: 6 }))).toContain('No trades yet')
})

test('trade report: a filled order lists its fills; a failed one shows the decoded error and the fix', async () => {
  const { TradeReportView } = await import('../src/pages/TradeReport')
  const base = tokAsset('GBP', 2, 1), quote = tokAsset('USD', 6, 2)
  const maker = `0x${'9'.repeat(40)}` as Address, tx = `0x${'cd'.repeat(32)}` as const
  const order = { id: '7', venue: 'onchain' as const, owner: me.address, market: { base: base.address, quote: quote.address }, side: 'buy' as const,
    price: 1_271_000n, amount: 150_000n, filled: 150_000n, status: 'filled' as const, placedAt: { block: 9n, time: '' } }
  const fills = [{ price: 1_270_000n, amount: 100_000n, maker, taker: me.address, takerSide: 'buy' as const, tx, block: 9n },
    { price: 1_271_000n, amount: 50_000n, maker, taker: me.address, takerSide: 'buy' as const, tx, block: 9n }]
  const people = [{ label: 'me', address: me.address }]
  const ok = await ssr(h => h(TradeReportView, { report: { order, fills }, base, quote, people, venue: 'onchain' }))
  for (const s of ['Order #7 filled', 'Filled 1,000.00 GBP at 1.2700', 'Filled 500.00 GBP at 1.2710', '1,500.00 / 1,500.00 GBP', 'role="img" aria-label="ok"'])
    expect(ok).toContain(s)
  const failed = { ...order, id: `tx:${tx}`, filled: 0n, status: 'failed' as const }
  const fix = 'Approve OrderBook to spend at least 1,906.50 USD, then place the order again.'
  const bad = await ssr(h => h(TradeReportView, { report: { order: failed, fills: [], failure: { tx, error: 'ERC20InsufficientAllowance', args: [maker, 0n, 1n], fix } }, base, quote, people, venue: 'onchain' }))
  for (const s of ['Order failed', 'ERC20InsufficientAllowance', fix, 'What to do', 'role="img" aria-label="fail"', `href="/trade?venue=onchain&amp;base=${base.address}&amp;quote=${quote.address}"`])
    expect(bad).toContain(s)
})

test('the form\'s "at most" is exactly what the on-chain venue checks: approving it places a market buy, one raw unit less does not', async () => {
  const { plan } = await import('../src/orderbook/form')
  const bob: Account = { label: 'bob', address: privateKeyToAccount(`0x${'22'.repeat(32)}`).address, privateKey: `0x${'22'.repeat(32)}` }
  const h = await registry().create('c', 'plain', [me.address, bob.address])
  try {
    const tok = async (sym: string, dec: number, to: Address) => {
      const r = await signAndSend(h, me, { data: encodeDeployData({ abi: AssetToken.abi, bytecode: AssetToken.bytecode, args: [sym, sym, dec, 10n ** 15n, me.address] }) })
      const t = getAddress(r.contractAddress!) as Address
      await signAndSend(h, me, { to: t, data: encodeFunctionData({ abi: AssetToken.abi, functionName: 'transfer', args: [to, 10n ** 14n] }) })
      return t
    }
    const book = await deployVenue(h, 'onchain', me)
    const gbp = await tok('GBP', 2, bob.address), usd = await tok('USD', 6, bob.address)
    const approve = (who: Account, t: Address, n: bigint) => signAndSend(h, who, { to: t, data: encodeFunctionData({ abi: AssetToken.abi, functionName: 'approve', args: [book, n] }) })
    await approve(me, gbp, 10n ** 12n)
    const v = (await openVenue(h, 'onchain', memoryStore(bookSchema)))!
    const market = { base: gbp, quote: usd }
    for (const [price, amount] of [[1_270_000n, 33_333n], [1_270_000n, 10_001n], [1_271_300n, 50_000n]] as const)
      await v.place(walletOf(h, me), { market, side: 'sell', type: 'limit', price, amount })
    const o = { side: 'buy' as const, type: 'market' as const, amount: 70_000n, slippageBps: 37 }
    const p = plan(o, (await v.book(market, 20)).asks, 2)
    expect(p.fills).toBe(3)
    await approve(bob, usd, p.need! - 1n)
    await expect(v.place(walletOf(h, bob), { market, ...o })).rejects.toThrow('OrderBook can spend')
    await approve(bob, usd, p.need!)
    const r = await v.place(walletOf(h, bob), { market, ...o })
    expect(r.fills.reduce((n, f) => n + f.amount, 0n)).toBe(70_000n)
  } finally { await h.dispose() }
}, 60_000)
