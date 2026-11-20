import { createPublicClient, custom, decodeFunctionData, getAddress, parseEventLogs, type Address, type Hash, type Log } from 'viem'
import { journal, type Attempt } from './attempts'
import { cancelCall, erc20Abi, orderBookAbi, placeCall, sideNum } from './calls'
import { match, worstPrice } from './match'
import { quoteFor } from './price'
import { amountText, fixFor, replayError, type Token } from './report'
import type { Store } from './store'
import type { Level, Market, Order, OrderReport, Resting, Side, Trade } from './types'
import type { Request, Venue } from './venue'

const SIDES: Side[] = ['buy', 'sell']
const STATUS = ['none', 'open', 'filled', 'cancelled'] as const
const opposite = (s: Side): Side => (s === 'buy' ? 'sell' : 'buy')
type Rec = { owner: Address; base: Address; quote: Address; side: number; status: number; closedBlock: bigint; price: bigint; amount: bigint; filled: bigint }

/**
 * The on-chain venue: OrderBook.sol at `address`. `fromBlock` is the block it was deployed in (the caller has its
 * deploy tx); order and trade history is read with topic-filtered `eth_getLogs` from there.
 */
export function onchainVenue(o: {
  request: Request; chainId: number; address: Address; store: Store; fromBlock?: bigint; maxLevels?: number
}): Venue {
  const book = getAddress(o.address), fromBlock = o.fromBlock ?? 0n, maxLevels = o.maxLevels ?? 20
  const client = createPublicClient({ transport: custom({ request: ({ method, params }) => o.request(method, params ?? []) }, { retryCount: 0 }) })
  const attempts = journal(o.store, { chainId: o.chainId, venue: book })
  const read = (functionName: string, args: unknown[]): Promise<any> =>
    client.readContract({ address: book, abi: orderBookAbi, functionName, args } as any)
  const tokens = new Map<Address, Promise<Token>>()
  const token = (t: Address) => tokens.get(t) ?? tokens.set(t, (async () => ({
    symbol: await client.readContract({ address: t, abi: erc20Abi, functionName: 'symbol' }),
    decimals: await client.readContract({ address: t, abi: erc20Abi, functionName: 'decimals' }),
  }))()).get(t)!
  const times = new Map<bigint, Promise<string>>()
  const timeOf = (block: bigint) => times.get(block) ?? times.set(block,
    client.getBlock({ blockNumber: block }).then(b => new Date(Number(b.timestamp) * 1000).toISOString())).get(block)!
  const logs = (eventName: 'OrderPlaced' | 'Trade' | 'OrderCancelled', args: object, from = fromBlock, to?: bigint): Promise<any[]> =>
    client.getLogs({ address: book, event: orderBookAbi.find(e => e.type === 'event' && e.name === eventName) as any, args, fromBlock: from, toBlock: to } as any)

  const toOrder = async (id: bigint, r: Rec, block: bigint): Promise<Order> => ({
    id: String(id), venue: 'onchain', owner: getAddress(r.owner), market: { base: getAddress(r.base), quote: getAddress(r.quote) },
    side: SIDES[r.side]!, price: r.price, amount: r.amount, filled: r.filled,
    status: r.status === 1 ? (r.filled > 0n ? 'partial' : 'open') : (STATUS[r.status] as 'filled' | 'cancelled'),
    placedAt: { block, time: await timeOf(block) },
  })
  const failedOrder = (a: Attempt): Order => ({
    id: `tx:${a.tx}`, venue: 'onchain', owner: a.owner, market: a.input.market, side: a.input.side, price: a.input.price,
    amount: a.input.amount, filled: 0n, status: 'failed', placedAt: { block: a.block, time: a.time },
  })
  const toTrade = (l: any, takerSide: Side): Trade => ({
    price: l.args.price, amount: l.args.amount, maker: getAddress(l.args.maker), taker: getAddress(l.args.taker),
    takerSide, tx: l.transactionHash, block: l.blockNumber,
  })

  /** One side's price levels, best first, while `go(price)` holds. */
  async function walk(m: Market, side: Side, go: (price: bigint, n: number) => boolean) {
    const out: { price: bigint; size: bigint; count: bigint }[] = []
    for (let p: bigint = await read('best', [m.base, m.quote, sideNum(side)]); p !== 0n && go(p, out.length);) {
      const [, next, size, count] = await read('level', [m.base, m.quote, sideNum(side), p])
      out.push({ price: p, size, count })
      p = next
    }
    return out
  }

  async function sendAndJournal(wallet: { address: Address; sendTransaction: (tx: any) => Promise<any> }, input: unknown, call: { to: Address; data: `0x${string}` }) {
    const seq = await attempts.begin(input, wallet.address)
    try {
      const rc = await wallet.sendTransaction(call)
      await attempts.end(seq, { tx: rc.transactionHash, block: rc.blockNumber, status: rc.status === 'success' ? 'success' : 'reverted' })
      return { rc, seq }
    } catch (e) {
      await attempts.end(seq, { status: 'error', error: String((e as Error)?.message ?? e) })
      throw e
    }
  }

  return {
    kind: 'onchain',

    async book(m, depth = 10) {
      const side = async (s: Side): Promise<Level[]> => {
        let total = 0n
        return (await walk(m, s, (_, n) => n < depth)).map(l => ({ price: l.price, size: l.size, total: total += l.size, orders: Number(l.count) }))
      }
      const [bids, asks] = await Promise.all([side('buy'), side('sell')])
      return { bids, asks }
    },

    async place(wallet, input) {
      const { market: m, side, amount } = input
      if (amount <= 0n) throw new Error('Amount must be above zero')
      if (input.type === 'limit' && !input.price) throw new Error('A limit order needs a price')
      const limit = input.type === 'limit' ? input.price : undefined
      const [base, quote] = await Promise.all([token(m.base), token(m.quote)])
      const opp = opposite(side)
      const crosses = (p: bigint) => limit === undefined || (side === 'buy' ? p <= limit : p >= limit)
      // the opposite side's orders this one would take: one level past the cap, so `match` can tell it was capped
      const resting: Resting[] = []
      let have = 0n
      for (const l of await walk(m, opp, (p, n) => n <= maxLevels && have < amount && crosses(p))) {
        have += l.size
        for (const id of (await read('levelOrders', [m.base, m.quote, sideNum(opp), l.price])) as bigint[]) {
          const r: Rec = await read('orders', [id])
          resting.push({ id: String(id), owner: r.owner, side: opp, price: l.price, remaining: r.amount - r.filled, seq: Number(id) })
        }
      }
      const mt = match({ side, price: limit, amount }, resting, maxLevels)
      if (mt.thin) throw new Error(`Book too thin: only ${amountText(mt.filled, base)} of ${amountText(amount, base)} can fill`)
      const price = limit ?? worstPrice(mt.fills, side, input.slippageBps ?? 100)

      // what the order can spend: a buy pays each fill rounded up, so "at most" adds one raw unit per expected fill
      const give = side === 'buy' ? m.quote : m.base, giveT = side === 'buy' ? quote : base
      const need = side === 'buy' ? quoteFor(amount, price, base.decimals, 'up') + BigInt(mt.fills.length) : amount
      const owner = getAddress(wallet.address)
      const [allowance, balance] = await Promise.all([
        client.readContract({ address: give, abi: erc20Abi, functionName: 'allowance', args: [owner, book] }),
        client.readContract({ address: give, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
      ])
      if (allowance < need) throw new Error(`OrderBook can spend ${amountText(allowance, giveT)} of yours; this order needs ${amountText(need, giveT)}. Approve more or lower the amount.`)
      if (balance < need) throw new Error(`You hold ${amountText(balance, giveT)}; this order needs ${amountText(need, giveT)}.`)

      // a resting remainder is inserted next to the last own-side level better than its price (0: it becomes the best)
      // ponytail: walks the own side from the best, O(levels better) reads; free off-chain, cap it if books get deep
      const rests = input.type === 'limit' && mt.filled < amount
      const better = rests ? await walk(m, side, p => (side === 'buy' ? p > price : p < price)) : []
      const hint = better.at(-1)?.price ?? 0n

      const sent = { market: m, side, type: input.type, price, amount, need }
      const { rc } = await sendAndJournal(wallet, sent, placeCall(book, { base: m.base, quote: m.quote, side, price, amount, maxLevels, hint, rest: input.type === 'limit' }))
      const tx: Hash = rc.transactionHash
      if (rc.status !== 'success') {
        const e = await replayError(o.request, tx, orderBookAbi)
        return { order: failedOrder({ owner, tx, block: rc.blockNumber, time: new Date().toISOString(), input: sent } as Attempt), fills: [], tx, reverted: e }
      }
      const events = parseEventLogs({ abi: orderBookAbi, logs: (rc.logs as Log[]).filter(l => getAddress(l.address) === book) })
      const id = (events.find(e => e.eventName === 'OrderPlaced') as any).args.id as bigint
      return {
        order: await toOrder(id, await read('orders', [id]), rc.blockNumber),
        fills: events.filter(e => e.eventName === 'Trade').map(l => toTrade(l, side)),
        tx,
      }
    },

    async cancel(wallet, id) {
      if (!/^\d+$/.test(id)) throw new Error(`Not an on-chain order: ${id}`)
      const { rc } = await sendAndJournal(wallet, { cancel: id }, cancelCall(book, BigInt(id)))
      if (rc.status !== 'success') {
        const e = await replayError(o.request, rc.transactionHash, orderBookAbi)
        throw new Error(`Cancel reverted: ${e.error}(${e.args.join(', ')})`)
      }
    },

    async orders(q) {
      if (!q.owner) throw new Error('On-chain orders are listed per owner')
      const owner = getAddress(q.owner)
      const ids: readonly bigint[] = await read('ordersOf', [owner])
      // placed blocks of all the owner's orders in one topic-filtered read
      const placed = new Map((await logs('OrderPlaced', { owner })).map(l => [l.args.id as bigint, l.blockNumber as bigint]))
      const out = [
        ...(await Promise.all(ids.map(async id => toOrder(id, await read('orders', [id]), placed.get(id)!)))),
        ...(await attempts.failed(owner)).filter(a => a.input?.market).map(failedOrder),
      ].sort((a, b) => (a.placedAt.block! < b.placedAt.block! ? -1 : a.placedAt.block! > b.placedAt.block! ? 1 : 0))
      return out.filter(x => (!q.market || (x.market.base === getAddress(q.market.base) && x.market.quote === getAddress(q.market.quote)))
        && (!q.status || q.status.includes(x.status)))
    },

    async trades(m, limit = 50) {
      // ponytail: every OrderPlaced and Trade since the deploy block, O(chain history) per call (topic-filtered by the
      // node, no block scan); index trades per market (or cache by block) when the history gets long — risk, ADR-0018
      const ls: any[] = await client.getLogs({
        address: book, fromBlock, events: orderBookAbi.filter(e => e.type === 'event' && e.name !== 'OrderCancelled') as any,
      } as any)
      const placed = new Map<bigint, { base: Address; quote: Address; side: number }>()
      const out: Trade[] = []
      const [b, q] = [getAddress(m.base), getAddress(m.quote)]
      for (const l of ls) {
        if (l.eventName === 'OrderPlaced') placed.set(l.args.id, l.args)
        else {
          const t = placed.get(l.args.takerId)
          if (t && getAddress(t.base) === b && getAddress(t.quote) === q) out.push(toTrade(l, SIDES[t.side]!))
        }
      }
      return out.reverse().slice(0, limit)
    },

    async report(id): Promise<OrderReport> {
      if (id.startsWith('tx:')) {
        const tx = id.slice(3) as Hash
        const t = await client.getTransaction({ hash: tx })
        const rc = await client.getTransactionReceipt({ hash: tx })
        if (rc.status === 'success') throw new Error(`${tx} did not revert`)
        const { args } = decodeFunctionData({ abi: orderBookAbi, data: t.input }) as any
        const [baseA, quoteA, sideN, price, amount] = args as [Address, Address, number, bigint, bigint]
        const side = SIDES[sideN]!, market = { base: getAddress(baseA), quote: getAddress(quoteA) }
        const [base, quote] = await Promise.all([token(market.base), token(market.quote)])
        // the journal knows what the package checked the order needed; a tx sent from elsewhere gets the plain size
        const a = (await attempts.failed(t.from)).find(x => x.tx === tx)
        const need: bigint = a?.input.need ?? (side === 'buy' ? quoteFor(amount, price, base.decimals, 'up') : amount)
        const e = await replayError(o.request, tx, orderBookAbi)
        const fix = fixFor(e, { spender: 'OrderBook', give: side === 'buy' ? quote : base, need, base, amount })
        return {
          order: failedOrder(a ?? { owner: getAddress(t.from), tx, block: rc.blockNumber, time: await timeOf(rc.blockNumber), input: { market, side, price, amount } } as Attempt),
          fills: [], failure: { tx, error: e.error, args: e.args, ...(fix && { fix }) },
        }
      }
      const n = BigInt(id)
      const r: Rec = await read('orders', [n])
      if (r.status === 0) throw new Error(`No order ${id}`)
      const placedBlock: bigint = (await logs('OrderPlaced', { id: n }))[0].blockNumber
      const closed = r.status >= 2 ? r.closedBlock : undefined
      // fills only lie between the order's place and close blocks; found by its indexed id as maker or as taker
      const [asMaker, asTaker] = await Promise.all([
        logs('Trade', { makerId: n }, placedBlock, closed), logs('Trade', { takerId: n }, placedBlock, closed)])
      const side = SIDES[r.side]!
      const fills = [...asMaker.map(l => ({ l, s: opposite(side) })), ...asTaker.map(l => ({ l, s: side }))]
        .sort((x, y) => Number(x.l.blockNumber - y.l.blockNumber) || x.l.logIndex - y.l.logIndex)
        .map(({ l, s }) => toTrade(l, s))
      const c = r.status === 3 ? (await logs('OrderCancelled', { id: n }, closed, closed))[0] : undefined
      return {
        order: await toOrder(n, r, placedBlock), fills,
        ...(c && { cancelled: { tx: c.transactionHash, block: c.blockNumber } }),
      }
    },
  }
}
