import { amountText, priceText, quoteFor, tickOf, worstPrice, type Level, type Side, type Token } from '@evmb/orderbook'
import { sizeText } from './ui'

type Shape = { side: Side; type: 'limit' | 'market'; price?: bigint; slippageBps: number }

/**
 * What an order would do against `levels` (the opposite side, best first), as the venue checks it.
 * `fills`: resting orders it would take (every order of a level it reaches: an upper bound); `estimate`: the quote of
 * those fills (rounded per level the taker's way); `bound`: a buy's "at most", a sell's "at least"; `need`: what the
 * give asset must cover (buy: `bound`, sell: `amount`); `thin`: a market order the book can't fill.
 * On-chain (`OrderBook`) the order is sent at `price`: the limit, or a market order's worst price (furthest level ±
 * slippage), and a buy's bound is amount × price rounded up + one raw unit per fill. Off-chain (`Settlement`) fills settle
 * at the makers' prices with no slippage (`price` is the limit or undefined), so the bound is the sum of per-fill
 * roundings, bounded per level by ceil(take × price) + one raw unit per further order in it, plus a limit buy's rest at
 * the limit rounded up.
 */
export function plan(o: Shape & { amount: bigint }, levels: Level[], baseDecimals: number, venue: 'onchain' | 'offchain' = 'onchain') {
  const buy = o.side === 'buy', round = buy ? 'up' : 'down'
  let filled = 0n, fills = 0, estimate = 0n, slack = 0n, far: bigint | undefined
  for (const l of levels) {
    if (filled === o.amount) break
    if (o.type === 'limit' && o.price !== undefined && (buy ? l.price > o.price : l.price < o.price)) break
    const take = l.size < o.amount - filled ? l.size : o.amount - filled
    filled += take; fills += l.orders; far = l.price; slack += BigInt(l.orders - 1)
    estimate += quoteFor(take, l.price, baseDecimals, round)
  }
  const thin = o.type === 'market' && filled < o.amount
  let price: bigint | undefined, bound: bigint | undefined
  if (venue === 'offchain') {
    price = o.type === 'limit' ? o.price : undefined
    const rest = o.type === 'limit' && o.price !== undefined ? quoteFor(o.amount - filled, o.price, baseDecimals, round) : 0n
    bound = o.type === 'limit' && o.price === undefined ? undefined
      : buy ? estimate + slack + rest : (estimate > slack ? estimate - slack : 0n) + rest
  } else {
    price = o.type === 'limit' ? o.price : far === undefined ? undefined : worstPrice([{ id: '', price: far, amount: 0n }], o.side, o.slippageBps)
    bound = price === undefined ? undefined : quoteFor(o.amount, price, baseDecimals, round) + (buy ? BigInt(fills) : 0n)
  }
  return { filled, fills, estimate, price, bound, need: buy ? bound : o.amount, thin }
}

/** 25/50/75/Max: `pct` of `available` (the give asset). A buy gets the largest base amount whose "at most" fits that
 * share; a market buy never more than `levels` hold. */
export function percentAmount(pct: number, o: Shape, available: bigint, levels: Level[], baseDecimals: number, venue: 'onchain' | 'offchain' = 'onchain'): bigint {
  const budget = (available * BigInt(pct)) / 100n
  if (o.side === 'sell') return budget
  // no unit costs less than the best ask (or a lower limit), so this many can't be exceeded
  const best = levels[0]?.price
  const start = o.type === 'market' ? best : o.price === undefined ? undefined : best !== undefined && best < o.price ? best : o.price
  if (!start) return 0n
  let hi = (budget * 10n ** BigInt(baseDecimals)) / start
  if (o.type === 'market') hi = [hi, levels.at(-1)?.total ?? 0n].reduce((a, b) => (a < b ? a : b))
  // the bound only grows with the amount: binary search for the largest that fits (about 50 plans at most)
  const fits = (amount: bigint) => { const { bound } = plan({ ...o, amount }, levels, baseDecimals, venue); return bound !== undefined && bound <= budget }
  let lo = 0n
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n
    if (fits(mid)) lo = mid; else hi = mid - 1n
  }
  return lo
}

/** Slippage typed in percent (≤ 2 dp) as basis points, clamped to 0–50% (a sell's worst price must stay above 0). */
export function slippageOf(text: string): number | { error: string } {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!m) return { error: 'Slippage must be a percentage with at most 2 decimals' }
  return Math.min(Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')), 5000)
}

/** A price finer than the tick (a worst price) at 4 dp, rounded away from the book: up for a buy, down for a sell. */
export function priceAway(price: bigint, side: Side, quoteDecimals: number) {
  const t = tickOf(quoteDecimals)
  return priceText(side === 'buy' ? ((price + t - 1n) / t) * t : price, quoteDecimals)
}

/** "Buy 5,000 GBP"; "Buy GBP" before an amount is typed. */
export const submitText = (side: Side, amount: bigint | undefined, base: Token) =>
  `${side === 'buy' ? 'Buy' : 'Sell'} ${amount ? `${sizeText(amount, base.decimals)} ` : ''}${base.symbol}`

/** The allowance warning's first sentence. */
export const allowanceNote = (spender: string, allowance: bigint, need: bigint, give: Token) =>
  `${spender} can spend ${amountText(allowance, give)} of yours; this order needs ${amountText(need, give)}.`

/** What "Approve more" approves when the allowance is short: `approve` sets the allowance, so `need` raises it by
 * exactly the shortfall. */
export const approveFor = (need: bigint, allowance: bigint) => (allowance < need ? need : undefined)
