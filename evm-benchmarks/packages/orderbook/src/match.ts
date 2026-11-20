import type { Level, Resting, Side } from './types'

export type Fill = { id: string; price: bigint; amount: bigint }

/**
 * Price-time matching against `resting` (opposite side, best first, FIFO within a price). Fills are at each resting
 * order's price. Stops at the taker's limit price (if any) or after `maxLevels` distinct prices. `thin`: not fully
 * filled and either a market order or more crossable liquidity sat beyond the level cap.
 */
export function match(taker: { side: Side; price?: bigint; amount: bigint }, resting: Resting[], maxLevels: number) {
  const fills: Fill[] = []
  let filled = 0n, levels = 0, last: bigint | undefined, capped = false
  for (const r of resting) {
    if (filled === taker.amount) break
    if (r.remaining === 0n) continue
    if (taker.price !== undefined && (taker.side === 'buy' ? r.price > taker.price : r.price < taker.price)) break
    if (r.price !== last) {
      if (levels === maxLevels) { capped = true; break }
      levels++; last = r.price
    }
    const amount = r.remaining < taker.amount - filled ? r.remaining : taker.amount - filled
    fills.push({ id: r.id, price: r.price, amount })
    filled += amount
  }
  return { fills, filled, levels, thin: filled < taker.amount && (taker.price === undefined || capped) }
}

/** Market order limit: the furthest price the fills need, moved `slippageBps` away from the book (rounded outward). */
export function worstPrice(fills: Fill[], side: Side, slippageBps: number): bigint {
  if (!fills.length) throw new Error('No fills to price')
  const bps = BigInt(slippageBps)
  if (side === 'buy') {
    const p = fills.reduce((m, f) => (f.price > m ? f.price : m), 0n)
    return (p * (10000n + bps) + 9999n) / 10000n
  }
  const p = fills.reduce((m, f) => (f.price < m ? f.price : m), fills[0]!.price)
  return (p * (10000n - bps)) / 10000n
}

/** Aggregate one side (best first) into at most `depth` price levels with cumulative totals. Empty orders skipped. */
export function levels(resting: Resting[], depth: number): Level[] {
  const out: Level[] = []
  let total = 0n
  for (const r of resting) {
    if (r.remaining === 0n) continue
    let l = out[out.length - 1]
    if (l?.price !== r.price) {
      if (out.length === depth) break
      out.push(l = { price: r.price, size: 0n, total, orders: 0 })
    }
    l.size += r.remaining; l.orders++; total += r.remaining; l.total = total
  }
  return out
}
