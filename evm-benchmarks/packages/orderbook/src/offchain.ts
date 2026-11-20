import { createPublicClient, custom, decodeFunctionData, getAddress, parseEventLogs, type Address, type Hash, type Hex, type Log } from 'viem'
import { allocate } from './allocate'
import { journal, sendAndJournal, type Attempt } from './attempts'
import { erc20Abi, settleCall, settlementAbi, settlementCancelCall, sideNum } from './calls'
import { domainOf, hashOrder, signOrder, type SignedOrder } from './eip712'
import { levels, match, type Fill } from './match'
import { quoteFor } from './price'
import { amountText, fixFor, replayError, type Token } from './report'
import { priceKey, type Store } from './store'
import type { Level, Market, Order, OrderReport, Resting, Side, Trade } from './types'
import type { Request, Venue } from './venue'

const SIDES: Side[] = ['buy', 'sell']
const opposite = (s: Side): Side => (s === 'buy' ? 'sell' : 'buy')
const WEEK = 7n * 24n * 3600n

/** A signed order in the store. `closed` is written once the chain says it can never fill again (final state). */
type Row = {
  id: Hex; scope: string; venue: Address; owner: Address; base: Address; quote: Address; side: Side; priceKey: string
  seq: number; price: bigint; amount: bigint; order: SignedOrder; sig: Hex; time: string
  closed?: { filled: bigint; cancelled: boolean }
}
/** A row as the chain sees it now: `covered` = what its maker's balance and allowance can honour (0 when closed). */
type State = { filled: bigint; cancelled: boolean; covered: bigint }

/**
 * The off-chain venue: makers sign orders (no gas, they keep custody), the book is the `orders` table in `store`, the
 * package matches, and the taker sends one `settle` to Settlement.sol at `address`. Fills and cancels are read from
 * the chain per order; each maker's give-asset min(balance, allowance to Settlement) covers their orders oldest first.
 */
export function offchainVenue(o: { request: Request; chainId: number; scope: string; address: Address; store: Store; maxLevels?: number }): Venue {
  const venue = getAddress(o.address), maxLevels = o.maxLevels ?? 20, domain = domainOf(o.chainId, venue)
  const client = createPublicClient({ transport: custom({ request: ({ method, params }) => o.request(method, params ?? []) }, { retryCount: 0 }) })
  const attempts = journal(o.store, { scope: o.scope, venue })
  const read = (functionName: 'filled' | 'cancelled', id: Hex): Promise<any> =>
    client.readContract({ address: venue, abi: settlementAbi, functionName, args: [id] })
  const erc20 = (t: Address, functionName: 'balanceOf' | 'allowance', args: Address[]): Promise<bigint> =>
    client.readContract({ address: t, abi: erc20Abi, functionName, args } as any) as Promise<bigint>
  const tokens = new Map<Address, Promise<Token>>()
  const token = (t: Address) => tokens.get(t) ?? tokens.set(t, (async () => ({
    symbol: await client.readContract({ address: t, abi: erc20Abi, functionName: 'symbol' }),
    decimals: await client.readContract({ address: t, abi: erc20Abi, functionName: 'decimals' }),
  }))()).get(t)!
  const giveOf = (r: { side: Side; base: Address; quote: Address }) => (r.side === 'buy' ? r.quote : r.base)
  const mine = (r: Row | undefined): r is Row => !!r && r.scope === o.scope && r.venue === venue
  /** store key: the hash alone could repeat across scopes (same chain id and Settlement address) */
  const key = (id: string) => `${o.scope}:${id}`

  /** The chain's view of every order of `owners` (one owner-index scan each; closed rows need no reads). */
  async function states(owners: Address[]) {
    const now = (await client.getBlock()).timestamp
    const rows: Row[] = [], out = new Map<string, State>()
    for (const owner of new Set(owners)) {
      const p = [o.scope, venue, owner]
      const all = await o.store.scan<Row>('orders', 'owner', { from: p, to: p })
      rows.push(...all)
      const live: (Row & State)[] = []
      await Promise.all(all.map(async r => {
        if (r.closed) return out.set(r.id, { ...r.closed, covered: 0n })
        const [filled, cancelled] = await Promise.all([read('filled', r.id), read('cancelled', r.id)])
        // expiry <= the latest block's time: a settle lands in a later block and would revert Expired. ponytail: an
        // expired order is closed as cancelled (Order has no 'expired' status); add one if the UI needs it
        if (cancelled || filled >= r.amount || r.order.expiry <= now) {
          const closed = { filled, cancelled: cancelled || filled < r.amount }
          await o.store.put('orders', key(r.id), { ...r, closed })
          return out.set(r.id, { ...closed, covered: 0n })
        }
        live.push({ ...r, filled, cancelled, covered: 0n })
      }))
      // per give-asset: min(balance, allowance to Settlement) over this owner's live orders, oldest first
      for (const give of new Set(live.map(giveOf))) {
        const [balance, allowance] = await Promise.all([erc20(give, 'balanceOf', [owner]), erc20(give, 'allowance', [owner, venue])])
        const these = live.filter(r => giveOf(r) === give)
        const dec = new Map<string, number>(await Promise.all(these.map(async r => [r.id, (await token(r.base)).decimals] as const)))
        const resting: Resting[] = these.map(r => ({ id: r.id, owner, side: r.side, price: r.price, remaining: r.amount - r.filled, seq: r.seq }))
        const cover = allocate(resting, balance < allowance ? balance : allowance,
          x => (x.side === 'sell' ? x.remaining : quoteFor(x.remaining, x.price, dec.get(x.id)!, 'up')))
        for (const r of these) out.set(r.id, { filled: r.filled, cancelled: false, covered: cover.get(r.id)! })
      }
    }
    return { rows, state: out }
  }

  /** One side of a market's open orders, best first, at their covered size; unfunded ones have remaining 0. */
  async function side(m: Market, s: Side) {
    const p = [o.scope, venue, getAddress(m.base), getAddress(m.quote), s]
    // ponytail: reads every open order on the side (plus each maker's other orders) per call; page the scan by price
    // when books get deep — O(open orders) risk, ADR-0018
    const rows = await o.store.scan<Row>('orders', 'book', { from: p, to: p })
    const { state } = await states(rows.map(r => r.owner))
    return {
      rows: new Map<string, Row>(rows.map(r => [r.id, r])),
      resting: rows.map((r): Resting => ({ id: r.id, owner: r.owner, side: s, price: r.price, remaining: state.get(r.id)?.covered ?? 0n, seq: r.seq })),
    }
  }

  const toOrder = (r: Row, s: State): Order => ({
    id: r.id, venue: 'offchain', owner: r.owner, market: { base: r.base, quote: r.quote }, side: r.side, price: r.price,
    amount: r.amount, filled: s.filled, placedAt: { time: r.time },
    status: s.cancelled ? 'cancelled' : s.filled >= r.amount ? 'filled' : s.covered === 0n ? 'unfunded' : s.filled > 0n ? 'partial' : 'open',
  })
  const failedOrder = (a: Pick<Attempt, 'owner' | 'tx' | 'block' | 'time' | 'input'>): Order => ({
    id: `tx:${a.tx}`, venue: 'offchain', owner: a.owner, market: a.input.market, side: a.input.side, price: a.input.price,
    amount: a.input.amount, filled: 0n, status: 'failed', placedAt: { block: a.block, time: a.time },
  })
  const toTrade = (l: any, takerSide: Side): Trade => ({
    price: l.args.price, amount: l.args.amount, maker: getAddress(l.args.maker), taker: getAddress(l.args.taker),
    takerSide, tx: l.transactionHash, block: l.blockNumber,
  })
  const logs = (eventName: 'Trade' | 'OrderCancelled', args: object): Promise<any[]> =>
    client.getLogs({ address: venue, event: settlementAbi.find(e => e.type === 'event' && e.name === eventName) as any, args, fromBlock: 0n } as any)

  return {
    kind: 'offchain',

    async book(m, depth = 10) {
      const [bids, asks] = await Promise.all((['buy', 'sell'] as const).map(async s => levels((await side(m, s)).resting, depth)))
      return { bids: bids as Level[], asks: asks as Level[] }
    },

    async place(wallet, input) {
      const { market, side: s, amount } = input
      if (amount <= 0n) throw new Error('Amount must be above zero')
      if (input.type === 'limit' && !input.price) throw new Error('A limit order needs a price')
      const m = { base: getAddress(market.base), quote: getAddress(market.quote) }
      const limit = input.type === 'limit' ? input.price : undefined
      const [base, quote] = await Promise.all([token(m.base), token(m.quote)])
      const owner = getAddress(wallet.address)
      const opp = await side(m, opposite(s))
      // what each fill moves in quote: the taker pays rounded up (buy) or receives rounded down (sell)
      const quoteOf = (f: Fill) => quoteFor(f.amount, f.price, base.decimals, s === 'buy' ? 'up' : 'down')
      let mt = match({ side: s, price: limit, amount }, opp.resting, maxLevels)
      // never a fill whose quote rounds to 0 (the maker would give base for nothing): skip that order and match again
      for (let z; (z = mt.fills.find(f => quoteOf(f) === 0n));) {
        opp.resting.find(r => r.id === z!.id)!.remaining = 0n
        mt = match({ side: s, price: limit, amount }, opp.resting, maxLevels)
      }
      if (mt.thin) throw new Error(`Book too thin: only ${amountText(mt.filled, base)} of ${amountText(amount, base)} can fill`)
      const rest = limit !== undefined ? amount - mt.filled : 0n

      const give = s === 'buy' ? m.quote : m.base, giveT = s === 'buy' ? quote : base
      const need = s === 'buy' ? mt.fills.reduce((n, f) => n + quoteOf(f), 0n) + (rest ? quoteFor(rest, limit!, base.decimals, 'up') : 0n) : mt.filled + rest
      const [allowance, balance] = await Promise.all([erc20(give, 'allowance', [owner, venue]), erc20(give, 'balanceOf', [owner])])
      if (allowance < need) throw new Error(`Settlement can spend ${amountText(allowance, giveT)} of yours; this order needs ${amountText(need, giveT)}. Approve more or lower the amount.`)
      if (balance < need) throw new Error(`You hold ${amountText(balance, giveT)}; this order needs ${amountText(need, giveT)}.`)

      let fills: Trade[] = [], tx: Hash | undefined
      if (mt.fills.length) {
        const makers = mt.fills.map(f => opp.rows.get(f.id)!)
        const price = limit ?? mt.fills.at(-1)!.price
        const sent = { market: m, side: s, type: input.type, price, amount, need }
        const { rc } = await sendAndJournal(attempts, wallet, sent,
          settleCall(venue, makers.map(r => r.order), makers.map(r => r.sig), mt.fills.map(f => f.amount)))
        tx = rc.transactionHash
        if (rc.status !== 'success') {
          const reverted = await replayError(o.request, rc.transactionHash, settlementAbi)
          return { order: failedOrder({ owner, tx, block: rc.blockNumber, time: new Date().toISOString(), input: sent }), fills: [], tx, reverted }
        }
        fills = parseEventLogs({ abi: settlementAbi, eventName: 'Trade', logs: (rc.logs as Log[]).filter(l => getAddress(l.address) === venue) })
          .map(l => toTrade(l, s))
      }
      if (!rest) return { fills, tx }

      // the remainder rests as a signed order: nonce = the venue's store seq, expiry a week past the chain's time
      const counter = `orders:${o.scope}:${venue}`
      const seq = ((await o.store.get<number>('meta', counter)) ?? 0) + 1
      await o.store.put('meta', counter, seq)
      const order: SignedOrder = {
        maker: owner, base: m.base, quote: m.quote, side: sideNum(s), price: limit!, amount: rest, nonce: BigInt(seq),
        expiry: (await client.getBlock()).timestamp + WEEK,
      }
      const row: Row = {
        id: hashOrder(order, domain), scope: o.scope, venue, owner, ...m, side: s, priceKey: priceKey(s, limit!), seq,
        price: limit!, amount: rest, order, sig: await signOrder(wallet, order, domain), time: new Date().toISOString(),
      }
      await o.store.put('orders', key(row.id), row)
      return { order: toOrder(row, (await states([owner])).state.get(row.id)!), fills, tx }
    },

    async cancel(wallet, id) {
      const r = await o.store.get<Row>('orders', key(id))
      if (!mine(r)) throw new Error(`No order ${id}`)
      if (getAddress(wallet.address) !== r.owner) throw new Error('Only the maker can cancel this order')
      const now = toOrder(r, (await states([r.owner])).state.get(id)!).status
      if (now === 'filled' || now === 'cancelled') throw new Error(`This order is already ${now}`)
      const { rc } = await sendAndJournal(attempts, wallet, { cancel: id }, settlementCancelCall(venue, r.order))
      if (rc.status !== 'success') {
        const e = await replayError(o.request, rc.transactionHash, settlementAbi)
        throw new Error(`Cancel reverted: ${e.error}(${e.args.join(', ')})`)
      }
      await o.store.put('orders', key(id), { ...r, closed: { filled: await read('filled', r.id as Hex), cancelled: true } })
    },

    async orders(q) {
      if (!q.owner) throw new Error('Off-chain orders are listed per owner')
      const owner = getAddress(q.owner)
      const { rows, state } = await states([owner])
      const out = [
        ...rows.map(r => toOrder(r, state.get(r.id)!)),
        ...(await attempts.failed(owner)).filter(a => a.input?.market).map(failedOrder),
      ].sort((a, b) => a.placedAt.time.localeCompare(b.placedAt.time))
      return out.filter(x => (!q.market || (x.market.base === getAddress(q.market.base) && x.market.quote === getAddress(q.market.quote)))
        && (!q.status || q.status.includes(x.status)))
    },

    async trades(m, limit = 50) {
      // ponytail: every Settlement Trade since block 0 plus a store read each, O(history); index trades per market when
      // it gets long — risk, ADR-0018. Fills of orders this store never held are not shown (no market to place them in).
      const [b, q] = [getAddress(m.base), getAddress(m.quote)]
      const out: Trade[] = []
      for (const l of await logs('Trade', {})) {
        const r = await o.store.get<Row>('orders', key(l.args.orderHash))
        if (mine(r) && r.base === b && r.quote === q) out.push(toTrade(l, opposite(r.side)))
      }
      return out.reverse().slice(0, limit)
    },

    async report(id): Promise<OrderReport> {
      if (id.startsWith('tx:')) {
        const tx = id.slice(3) as Hash
        const t = await client.getTransaction({ hash: tx })
        const rc = await client.getTransactionReceipt({ hash: tx })
        if (rc.status === 'success') throw new Error(`${tx} did not revert`)
        let a: Pick<Attempt, 'owner' | 'tx' | 'block' | 'time' | 'input'> | undefined = (await attempts.failed(t.from)).find(x => x.tx === tx)
        if (!a) { // sent from elsewhere: rebuild what it asked for from the calldata
          const [makers, , fs] = decodeFunctionData({ abi: settlementAbi, data: t.input }).args as [SignedOrder[], Hex[], bigint[]]
          const side = opposite(SIDES[makers[0]!.side]!), market = { base: getAddress(makers[0]!.base), quote: getAddress(makers[0]!.quote) }
          const dec = (await token(market.base)).decimals
          const need = side === 'buy' ? makers.reduce((n, mk, i) => n + quoteFor(fs[i]!, mk.price, dec, 'up'), 0n) : fs.reduce((n, f) => n + f, 0n)
          a = { owner: getAddress(t.from), tx, block: rc.blockNumber, time: new Date(Number((await client.getBlock({ blockNumber: rc.blockNumber })).timestamp) * 1000).toISOString(),
            input: { market, side, price: makers.at(-1)!.price, amount: fs.reduce((n, f) => n + f, 0n), need } }
        }
        const { market, side, amount, need } = a.input
        const [base, quote] = await Promise.all([token(market.base), token(market.quote)])
        const e = await replayError(o.request, tx, settlementAbi)
        const fix = fixFor(e, { spender: 'Settlement', give: side === 'buy' ? quote : base, need, base, amount })
        return { order: failedOrder(a), fills: [], failure: { tx, error: e.error, args: e.args, ...(fix && { fix }) } }
      }
      const r = await o.store.get<Row>('orders', key(id))
      if (!mine(r)) throw new Error(`No order ${id}`)
      const [{ state }, fills, [c]] = await Promise.all([states([r.owner]), logs('Trade', { orderHash: id }), logs('OrderCancelled', { orderHash: id })])
      return {
        order: toOrder(r, state.get(id)!), fills: fills.map(l => toTrade(l, opposite(r.side))),
        ...(c && { cancelled: { tx: c.transactionHash, block: c.blockNumber } }),
      }
    },
  }
}
