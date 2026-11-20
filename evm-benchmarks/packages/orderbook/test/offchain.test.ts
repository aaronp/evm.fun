import { expect, test } from 'bun:test'
import { encodeFunctionData, type Address } from 'viem'
import { AssetToken, Settlement } from '@evmb/contracts'
import { bookSchema, memoryStore, offchainVenue, settleCall, settlementCancelCall, type Store, type Wallet } from '../src'
import { maker, other, taker, withChain } from './chain'

const P = (s: string) => BigInt(Math.round(Number(s) * 1e6)) // USD (6 dp) per whole GBP
const G = (n: number) => BigInt(Math.round(n * 100)) // GBP raw (2 dp)
const U = (n: number) => BigInt(Math.round(n * 1e6)) // USD raw (6 dp)
const T = 60_000
type C = Parameters<Parameters<typeof withChain>[0]>[0]

const venue = (c: C, store: Store = memoryStore(bookSchema), address: Address = c.settlement) =>
  ({ store, v: offchainVenue({ request: c.request, chainId: c.chainId, address, store }), m: { base: c.gbp, quote: c.usd } })
const bal = (c: C, t: Address, who: Address): Promise<bigint> => c.read(t, AssetToken.abi, 'balanceOf', [who])
/** `other` ends up holding exactly `n` GBP (the rest goes to `maker`). */
const holdGbp = async (c: C, n: bigint) => c.call(other, c.gbp, AssetToken.abi, 'transfer', [maker.address, (await bal(c, c.gbp, other.address)) - n])
/** A wallet that lets `before` run between the venue's read and its send. */
const racing = (w: Wallet, before: () => Promise<unknown>): Wallet => ({ ...w, sendTransaction: async tx => { await before(); return w.sendTransaction(tx) } })

test('settleCall / settlementCancelCall encode Settlement.settle / cancel', () => {
  const a = '0x00000000000000000000000000000000000000aa' as const, b = '0x00000000000000000000000000000000000000bb' as const
  const o = { maker: a, base: a, quote: b, side: 1, price: 5n, amount: 7n, nonce: 1n, expiry: 9n }
  expect(settleCall(a, [o], ['0x12'], [3n])).toEqual({ to: a, data: encodeFunctionData({ abi: Settlement.abi, functionName: 'settle', args: [[o], ['0x12'], [3n]] }) })
  expect(settlementCancelCall(a, o)).toEqual({ to: a, data: encodeFunctionData({ abi: Settlement.abi, functionName: 'cancel', args: [o] }) })
})

test('Review Focus 1: two 5,000 asks on 6,000 GBP show 5,000 + 1,000; a 7,000 buy fills 6,000 in one settle and rests 1,000', () => withChain(async c => {
  const { v, m, store } = venue(c)
  expect(v.kind).toBe('offchain')
  await holdGbp(c, G(6000))
  const before = await c.blockNumber()
  const a1 = await v.place(c.walletOf(other), { market: m, side: 'sell', type: 'limit', price: P('1.27'), amount: G(5000) })
  await v.place(c.walletOf(other), { market: m, side: 'sell', type: 'limit', price: P('1.28'), amount: G(5000) })
  expect(await c.blockNumber()).toBe(before) // signing costs no gas
  expect(a1).toMatchObject({ fills: [], order: { venue: 'offchain', owner: other.address, status: 'open', amount: G(5000), filled: 0n } })
  expect(a1.order!.id).toMatch(/^0x[0-9a-f]{64}$/)
  expect((await v.book(m)).asks).toEqual([
    { price: P('1.27'), size: G(5000), total: G(5000), orders: 1 },
    { price: P('1.28'), size: G(1000), total: G(6000), orders: 1 },
  ])

  const usd0 = await bal(c, c.usd, other.address)
  const r = await v.place(c.walletOf(taker), { market: m, side: 'buy', type: 'limit', price: P('1.28'), amount: G(7000) })
  expect(r.reverted).toBeUndefined()
  expect(await c.blockNumber()).toBe(before + 1n) // one settle
  expect(r.fills.map(f => [f.price, f.amount, f.maker, f.taker, f.takerSide, f.tx])).toEqual([
    [P('1.27'), G(5000), other.address, taker.address, 'buy', r.tx!], [P('1.28'), G(1000), other.address, taker.address, 'buy', r.tx!]])
  expect(await bal(c, c.gbp, other.address)).toBe(0n)
  expect(await bal(c, c.usd, other.address)).toBe(usd0 + U(6350) + U(1280))
  expect(r.order).toMatchObject({ owner: taker.address, side: 'buy', price: P('1.28'), amount: G(1000), status: 'open' })
  expect(await v.book(m)).toEqual({ asks: [], bids: [{ price: P('1.28'), size: G(1000), total: G(1000), orders: 1 }] })
  expect((await v.orders({ owner: other.address })).map(o => [o.status, o.filled])).toEqual([['filled', G(5000)], ['unfunded', G(1000)]])
  expect((await store.scan<any>('attempts', 'owner', {})).map(a => a.status)).toEqual(['success'])
  expect((await v.trades(m)).map(t => t.amount)).toEqual([G(1000), G(5000)])
}), T)

test('no crossing: nothing is sent', () => withChain(async c => {
  const { v, m, store } = venue(c)
  const before = await c.blockNumber()
  await v.place(c.walletOf(maker), { market: m, side: 'sell', type: 'limit', price: P('1.27'), amount: G(10) })
  await v.place(c.walletOf(taker), { market: m, side: 'buy', type: 'limit', price: P('1.26'), amount: G(10) })
  expect(await c.blockNumber()).toBe(before)
  expect(await store.scan('attempts', 'owner', {})).toEqual([])
  expect((await v.book(m)).bids.map(l => l.price)).toEqual([P('1.26')])
}), T)

test('a market sell across two makers\' bids settles in one tx with exact balances (taker receives rounded down)', () => withChain(async c => {
  const { v, m } = venue(c)
  const b1 = await v.place(c.walletOf(maker), { market: m, side: 'buy', type: 'limit', price: P('1.26'), amount: G(100) })
  const b2 = await v.place(c.walletOf(other), { market: m, side: 'buy', type: 'limit', price: P('1.2555'), amount: G(50) })
  const who = [maker, other, taker].map(a => a.address)
  const start = await Promise.all(who.flatMap(a => [bal(c, c.gbp, a), bal(c, c.usd, a)]))
  const before = await c.blockNumber()
  const r = await v.place(c.walletOf(taker), { market: m, side: 'sell', type: 'market', amount: G(120.01) })
  expect(await c.blockNumber()).toBe(before + 1n)
  expect(r.order).toBeUndefined() // a market order never rests
  expect(r.fills.map(f => [f.maker, f.amount])).toEqual([[maker.address, G(100)], [other.address, G(20.01)]])
  const q2 = U(25.122555) // 20.01 × 1.2555 = 25.122555, exact
  expect(await Promise.all(who.flatMap(a => [bal(c, c.gbp, a), bal(c, c.usd, a)]))).toEqual([
    start[0]! + G(100), start[1]! - U(126), start[2]! + G(20.01), start[3]! - q2, start[4]! - G(120.01), start[5]! + U(126) + q2])
  expect((await v.report(b1.order!.id)).order).toMatchObject({ status: 'filled', filled: G(100) })
  const rep = await v.report(b2.order!.id)
  expect(rep.order).toMatchObject({ status: 'partial', filled: G(20.01) })
  expect(rep.fills.map(f => [f.amount, f.tx, f.takerSide])).toEqual([[G(20.01), r.tx!, 'sell']])
}), T)

test('a fill whose quote rounds to 0 is never produced: that maker is skipped', () => withChain(async c => {
  const { v, m } = venue(c)
  await v.place(c.walletOf(maker), { market: m, side: 'buy', type: 'limit', price: 50n, amount: G(1) }) // 0.01 GBP → 0.5 raw USD
  const deep = await v.place(c.walletOf(other), { market: m, side: 'buy', type: 'limit', price: 40n, amount: G(1) })
  const before = await c.blockNumber()
  await expect(v.place(c.walletOf(taker), { market: m, side: 'sell', type: 'market', amount: 1n })).rejects.toThrow(/Book too thin/)
  expect(await c.blockNumber()).toBe(before)
  const r = await v.place(c.walletOf(taker), { market: m, side: 'sell', type: 'market', amount: 3n }) // 3 × 50 / 100 = 1
  expect(r.fills.map(f => [f.amount, f.price])).toEqual([[3n, 50n]])
  expect((await v.report(deep.order!.id)).order.filled).toBe(0n)
}), T)

test('a maker who spends their GBP elsewhere drops out of the book as unfunded', () => withChain(async c => {
  const { v, m } = venue(c)
  await holdGbp(c, G(100))
  await v.place(c.walletOf(other), { market: m, side: 'sell', type: 'limit', price: P('1.27'), amount: G(100) })
  expect((await v.book(m)).asks.map(l => l.size)).toEqual([G(100)])
  await holdGbp(c, 0n)
  expect((await v.book(m)).asks).toEqual([])
  expect((await v.orders({ owner: other.address })).map(o => o.status)).toEqual(['unfunded'])
  const before = await c.blockNumber()
  const r = await v.place(c.walletOf(taker), { market: m, side: 'buy', type: 'limit', price: P('1.27'), amount: G(10) })
  expect(await c.blockNumber()).toBe(before) // nothing to match: the bid just rests
  expect(r.fills).toEqual([])
}), T)

test('cancel: on-chain, the row is marked, the book empties, the report says cancelled', () => withChain(async c => {
  const { v, m } = venue(c)
  const r = await v.place(c.walletOf(maker), { market: m, side: 'sell', type: 'limit', price: P('1.27'), amount: G(100) })
  const before = await c.blockNumber()
  await v.cancel(c.walletOf(maker), r.order!.id)
  expect(await c.blockNumber()).toBe(before + 1n)
  expect((await v.book(m)).asks).toEqual([])
  expect((await v.orders({ owner: maker.address })).map(o => o.status)).toEqual(['cancelled'])
  const rep = await v.report(r.order!.id)
  expect(rep.cancelled?.block).toBe(before + 1n)
  expect(rep.cancelled?.tx).toMatch(/^0x/)
  await expect(v.cancel(c.walletOf(taker), r.order!.id)).rejects.toThrow(/NotMaker/)
  await expect(v.cancel(c.walletOf(maker), '0x' + '00'.repeat(32))).rejects.toThrow(/No order/)
}), T)

test('taker allowance short: refused before sending; if it drops after the read, a failed attempt with an approve fix', () => withChain(async c => {
  const { v, m } = venue(c)
  await v.place(c.walletOf(maker), { market: m, side: 'sell', type: 'limit', price: P('1.27'), amount: G(100) })
  const approve = (n: bigint) => c.call(taker, c.usd, AssetToken.abi, 'approve', [c.settlement, n])
  await approve(1n)
  const order = { market: m, side: 'buy' as const, type: 'limit' as const, price: P('1.27'), amount: G(100) }
  const before = await c.blockNumber()
  await expect(v.place(c.walletOf(taker), order)).rejects.toThrow('Settlement can spend 0.000001 USD of yours; this order needs 127.00 USD')
  expect(await c.blockNumber()).toBe(before)
  await approve(10n ** 12n)
  const r = await v.place(racing(c.walletOf(taker), () => approve(1n)), order)
  expect(r.reverted?.error).toBe('ERC20InsufficientAllowance')
  expect(r.order).toMatchObject({ id: `tx:${r.tx}`, status: 'failed', side: 'buy', amount: G(100) })
  expect((await v.orders({ owner: taker.address, status: ['failed'] })).map(o => o.id)).toEqual([`tx:${r.tx}`])
  const rep = await v.report(r.order!.id)
  expect(rep.failure).toMatchObject({ tx: r.tx, error: 'ERC20InsufficientAllowance' })
  expect(rep.failure!.fix).toBe('Approve Settlement to spend at least 127.00 USD, then place the order again.')
  expect((await v.book(m)).asks.map(l => l.size)).toEqual([G(100)]) // the maker's order is untouched
}), T)

test('Review Focus 4: two Settlement deploys and a second chain share a store but never mix books', () => withChain(async c => {
  const store = memoryStore(bookSchema)
  const s2 = (await c.deploy(Settlement, [])).address
  await c.call(taker, c.usd, AssetToken.abi, 'approve', [s2, 2n ** 255n])
  const { v: v1, m } = venue(c, store), { v: v2 } = venue(c, store, s2)
  await v1.place(c.walletOf(maker), { market: m, side: 'sell', type: 'limit', price: P('1.27'), amount: G(100) })
  expect((await v2.book(m)).asks).toEqual([])
  const before = await c.blockNumber()
  await v2.place(c.walletOf(taker), { market: m, side: 'buy', type: 'limit', price: P('1.28'), amount: G(10) })
  expect(await c.blockNumber()).toBe(before) // nothing crossed on deploy 2
  expect((await v1.book(m)).bids).toEqual([])
  expect((await v2.orders({ owner: maker.address }))).toEqual([])
  await withChain(async c2 => {
    expect([c2.settlement, c2.gbp, c2.usd]).toEqual([c.settlement, c.gbp, c.usd]) // same addresses, other chain id
    const { v: v3 } = venue(c2, store)
    expect(await v3.book(m)).toEqual({ bids: [], asks: [] })
    expect(await v3.orders({ owner: maker.address })).toEqual([])
  }, 31338)
  expect((await v1.book(m)).asks.map(l => l.size)).toEqual([G(100)])
}), T)
