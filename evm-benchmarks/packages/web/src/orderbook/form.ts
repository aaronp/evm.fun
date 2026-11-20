import { amountText, priceText, quoteFor, tickOf, worstPrice, type Level, type Side, type Token } from '@evmb/orderbook'
import { sizeText } from './ui'

type Shape = { side: Side; type: 'limit' | 'market'; price?: bigint; slippageBps: number }

/**
 * What an order would do against `levels` (the opposite side, best first), as the venue checks it.
 * `fills`: resting orders it would take (every order of a level it reaches: an upper bound); `estimate`: the quote of
 * those fills (rounded per level the taker's way); `price`: the limit, or a market order's worst price; `bound`: a buy's
 * "at most" (amount × price rounded up + one raw unit per fill), a sell's "at least" (rounded down); `need`: what the
 * give asset must cover (buy: `bound`, sell: `amount`); `thin`: a market order the book can't fill.
 */
export function plan(o: Shape & { amount: bigint }, levels: Level[], baseDecimals: number) {
  const buy = o.side === 'buy', round = buy ? 'up' : 'down'
  let filled = 0n, fills = 0, estimate = 0n, far: bigint | undefined
  for (const l of levels) {
    if (filled === o.amount) break
    if (o.type === 'limit' && o.price !== undefined && (buy ? l.price > o.price : l.price < o.price)) break
    const take = l.size < o.amount - filled ? l.size : o.amount - filled
    filled += take; fills += l.orders; far = l.price
    estimate += quoteFor(take, l.price, baseDecimals, round)
  }
  const price = o.type === 'limit' ? o.price : far === undefined ? undefined : worstPrice([{ id: '', price: far, amount: 0n }], o.side, o.slippageBps)
  const bound = price === undefined ? undefined : quoteFor(o.amount, price, baseDecimals, round) + (buy ? BigInt(fills) : 0n)
  return { filled, fills, estimate, price, bound, need: buy ? bound : o.amount, thin: o.type === 'market' && filled < o.amount }
}

/** 25/50/75/Max: `pct` of `available` (the give asset). A buy gets the largest base amount whose "at most" fits that
 * share; a market buy never more than `levels` hold. */
export function percentAmount(pct: number, o: Shape, available: bigint, levels: Level[], baseDecimals: number): bigint {
  const budget = (available * BigInt(pct)) / 100n
  if (o.side === 'sell') return budget
  const one = 10n ** BigInt(baseDecimals)
  const start = o.type === 'limit' ? o.price : levels[0] && plan({ ...o, amount: 1n }, levels, baseDecimals).price
  if (!start) return 0n
  let amount = (budget * one) / start
  if (o.type === 'market') amount = [amount, levels.at(-1)?.total ?? 0n].reduce((a, b) => (a < b ? a : b))
  // each pass prices the amount at its own worst price and fill count; amounts only shrink, so this ends
  while (amount > 0n) {
    const p = plan({ ...o, amount }, levels, baseDecimals)
    if (p.bound! <= budget) return amount
    const next = ((budget - BigInt(p.fills)) * one) / p.price!
    amount = next < amount ? next : amount - 1n
  }
  return 0n
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
