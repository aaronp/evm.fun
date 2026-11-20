import { expect, test } from 'bun:test'
import { encodeFunctionData } from 'viem'
import { AssetToken, OrderBook } from '@evmb/contracts'
import { bookSchema, cancelCall, memoryStore, onchainVenue, placeCall, type Wallet } from '../src'
import { maker, other, taker, withChain } from './chain'

const P = (s: string) => BigInt(Math.round(Number(s) * 1e6)) // USD (6 dp) per whole GBP
const G = (n: number) => BigInt(n * 100) // GBP raw (2 dp)
const T = 60_000

test('placeCall / cancelCall encode OrderBook.place / cancel', () => {
  const a = '0x00000000000000000000000000000000000000aa', b = '0x00000000000000000000000000000000000000bb'
  expect(placeCall(a, { base: a, quote: b, side: 'sell', price: 5n, amount: 7n, maxLevels: 20, hint: 3n, rest: true })).toEqual({
    to: a, data: encodeFunctionData({ abi: OrderBook.abi, functionName: 'place', args: [a, b, 1, 5n, 7n, 20n, 3n, true] }),
  })
  expect(cancelCall(a, 9n)).toEqual({ to: a, data: encodeFunctionData({ abi: OrderBook.abi, functionName: 'cancel', args: [9n] }) })
})

const setup = (c: { request: any; book: `0x${string}`; fromBlock: bigint; gbp: `0x${string}`; usd: `0x${string}` }) => {
  const store = memoryStore(bookSchema)
  return { store, v: onchainVenue({ request: c.request, scope: 'a', address: c.book, store, fromBlock: c.fromBlock }), m: { base: c.gbp, quote: c.usd } }
}

test('limit orders rest and read back as the book, best first, with cumulative totals', () => withChain(async c => {
  const { v, m } = setup(c)
  const mk = c.walletOf(maker)
  expect(v.kind).toBe('onchain')
  const r = await v.place(mk, { market: m, side: 'sell', type: 'limit', price: P('1.28'), amount: G(50) })
  expect(r.fills).toEqual([])
  expect(r.order).toMatchObject({ id: '1', venue: 'onchain', owner: maker.address, side: 'sell', price: P('1.28'), amount: G(50), filled: 0n, status: 'open' })
  expect(r.order!.placedAt.block).toBeGreaterThan(0n)
  await v.place(mk, { market: m, side: 'sell', type: 'limit', price: P('1.27'), amount: G(100) })
  await v.place(mk, { market: m, side: 'sell', type: 'limit', price: P('1.275'), amount: G(10) }) // between: hinted insert
  await v.place(mk, { market: m, side: 'sell', type: 'limit', price: P('1.27'), amount: G(5) })
  await v.place(mk, { market: m, side: 'buy', type: 'limit', price: P('1.25'), amount: G(20) })
  await v.place(mk, { market: m, side: 'buy', type: 'limit', price: P('1.26'), amount: G(10) })
  expect(await v.book(m)).toEqual({
    asks: [
      { price: P('1.27'), size: G(105), total: G(105), orders: 2 },
      { price: P('1.275'), size: G(10), total: G(115), orders: 1 },
      { price: P('1.28'), size: G(50), total: G(165), orders: 1 },
    ],
    bids: [
      { price: P('1.26'), size: G(10), total: G(10), orders: 1 },
      { price: P('1.25'), size: G(20), total: G(30), orders: 1 },
    ],
  })
  expect((await v.book(m, 1)).asks.length).toBe(1)
  expect((await v.orders({ owner: maker.address })).map(o => [o.id, o.status])).toEqual(
    [['1', 'open'], ['2', 'open'], ['3', 'open'], ['4', 'open'], ['5', 'open'], ['6', 'open']])
}), T)

test('a crossing buy fills at maker prices, partials show as partial, the report lists both fills, trades newest first', () => withChain(async c => {
  const { v, m } = setup(c)
  const mk = c.walletOf(maker), tk = c.walletOf(taker)
  await v.place(mk, { market: m, side: 'sell', type: 'limit', price: P('1.27'), amount: G(100) }) // 1
  await v.place(mk, { market: m, side: 'sell', type: 'limit', price: P('1.28'), amount: G(50) }) // 2
  const r = await v.place(tk, { market: m, side: 'buy', type: 'limit', price: P('1.28'), amount: G(120) }) // 3
  expect(r.fills.map(f => [f.price, f.amount, f.maker, f.taker, f.takerSide])).toEqual([
    [P('1.27'), G(100), maker.address, taker.address, 'buy'], [P('1.28'), G(20), maker.address, taker.address, 'buy']])
  expect(r.order).toMatchObject({ id: '3', status: 'filled', filled: G(120) })
  const r2 = await v.place(tk, { market: m, side: 'buy', type: 'limit', price: P('1.28'), amount: G(40) }) // 4: 30 fill, 10 rests
  expect(r2.order).toMatchObject({ id: '4', status: 'partial', filled: G(30) })
  expect((await v.orders({ owner: maker.address })).map(o => o.status)).toEqual(['filled', 'filled'])
  expect((await v.orders({ owner: taker.address, status: ['partial'] })).map(o => o.id)).toEqual(['4'])
  expect((await v.book(m)).bids).toEqual([{ price: P('1.28'), size: G(10), total: G(10), orders: 1 }])

  const rep = await v.report('3')
  expect(rep.order).toMatchObject({ id: '3', status: 'filled' })
  expect(rep.fills.map(f => [f.price, f.amount, f.tx])).toEqual([[P('1.27'), G(100), r.tx!], [P('1.28'), G(20), r.tx!]])
  expect((await v.report('2')).fills.map(f => f.amount)).toEqual([G(20), G(30)]) // a maker's fills from two takers
  expect((await v.trades(m)).map(t => t.amount)).toEqual([G(30), G(20), G(100)])
  expect((await v.trades(m, 1)).length).toBe(1)
  expect(await v.trades({ base: c.usd, quote: c.gbp })).toEqual([])
}), T)

test('a market buy fills within slippage; too thin when read: an error and no tx', () => withChain(async c => {
  const { v, m, store } = setup(c)
  const mk = c.walletOf(maker), tk = c.walletOf(taker)
  await v.place(mk, { market: m, side: 'sell', type: 'limit', price: P('1.27'), amount: G(100) })
  await v.place(mk, { market: m, side: 'sell', type: 'limit', price: P('1.28'), amount: G(50) })
  const before = await c.blockNumber()
  await expect(v.place(tk, { market: m, side: 'buy', type: 'market', amount: G(200) })).rejects.toThrow('Book too thin: only 150.00 GBP of 200.00 GBP can fill')
  expect(await c.blockNumber()).toBe(before)
  expect((await store.scan('attempts', 'owner', {})).length).toBe(2) // the makers' two places only
  const r = await v.place(tk, { market: m, side: 'buy', type: 'market', amount: G(120) })
  expect(r.order).toMatchObject({ status: 'filled', filled: G(120) })
  expect(r.fills.length).toBe(2)
}), T)

/** A wallet that lets `before` run (on another account) between the venue's read and its send. */
const racing = (w: Wallet, before: () => Promise<unknown>): Wallet => ({ ...w, sendTransaction: async tx => { await before(); return w.sendTransaction(tx) } })

test('thinned between read and send: a failed attempt tx:<hash> whose report says BookTooThin', () => withChain(async c => {
  const { v, m } = setup(c)
  await v.place(c.walletOf(maker), { market: m, side: 'sell', type: 'limit', price: P('1.27'), amount: G(100) })
  const tk = racing(c.walletOf(taker), () => v.place(c.walletOf(other), { market: m, side: 'buy', type: 'market', amount: G(50) }))
  const r = await v.place(tk, { market: m, side: 'buy', type: 'market', amount: G(80) })
  expect(r.reverted).toEqual({ error: 'BookTooThin', args: [G(50)] })
  expect(r.order).toMatchObject({ id: `tx:${r.tx}`, status: 'failed', side: 'buy', amount: G(80) })
  const failed = await v.orders({ owner: taker.address, status: ['failed'] })
  expect(failed.map(o => o.id)).toEqual([`tx:${r.tx}`])
  const rep = await v.report(`tx:${r.tx}`)
  expect(rep.order.status).toBe('failed')
  expect(rep.failure).toMatchObject({ tx: r.tx, error: 'BookTooThin', args: [G(50)] })
  expect(rep.failure!.fix).toContain('Only 50.00 GBP of 80.00 GBP')
}), T)

test('allowance short: refused before sending; if it drops after the read, a failed attempt with an approve fix', () => withChain(async c => {
  const { v, m } = setup(c)
  const approve = (n: bigint) => c.call(taker, c.usd, AssetToken.abi, 'approve', [c.book, n])
  await approve(1n)
  const order = { market: m, side: 'buy' as const, type: 'limit' as const, price: P('1.27'), amount: G(100) }
  const before = await c.blockNumber()
  await expect(v.place(c.walletOf(taker), order)).rejects.toThrow('OrderBook can spend 0.000001 USD of yours; this order needs 127.00 USD')
  expect(await c.blockNumber()).toBe(before)
  await approve(10n ** 12n)
  const r = await v.place(racing(c.walletOf(taker), () => approve(1n)), order)
  expect(r.reverted?.error).toBe('ERC20InsufficientAllowance')
  const rep = await v.report(r.order!.id)
  expect(rep.failure!.fix).toBe('Approve OrderBook to spend at least 127.00 USD, then place the order again.')
}), T)

test('cancel returns the escrow, empties the level, and the report says cancelled', () => withChain(async c => {
  const { v, m } = setup(c)
  const mk = c.walletOf(maker)
  const bal = () => c.read(c.gbp, AssetToken.abi, 'balanceOf', [maker.address])
  const start = await bal()
  const r = await v.place(mk, { market: m, side: 'sell', type: 'limit', price: P('1.27'), amount: G(100) })
  await v.cancel(mk, r.order!.id)
  expect(await bal()).toBe(start)
  expect((await v.book(m)).asks).toEqual([])
  expect((await v.orders({ owner: maker.address }))[0]!.status).toBe('cancelled')
  const rep = await v.report(r.order!.id)
  expect(rep.cancelled?.block).toBeGreaterThan(r.order!.placedAt.block!)
  expect(rep.cancelled?.tx).toMatch(/^0x/)
  await expect(v.cancel(c.walletOf(taker), r.order!.id)).rejects.toThrow(/OrderNotOpen/)
}), T)
