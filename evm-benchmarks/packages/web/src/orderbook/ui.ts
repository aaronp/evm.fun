import type { Level } from '@evmb/orderbook'
import { formatAmount, shortAddress } from '../assets/ui'

/** Sizes as the mockup shows them: "1,000" when whole, else 2 dp. */
export const sizeText = (v: bigint, decimals: number) => formatAmount(v, decimals, 2).replace(/\.0+$/, '')

/** An order id as shown: "#12" on-chain, a short hash off-chain or for a failed attempt (`tx:<hash>`). */
export const idText = (id: string) => (/^\d+$/.test(id) ? `#${id}` : shortAddress(id.replace(/^tx:/, '')))

/** Best ask − best bid, and that in basis points of the mid (1 dp); undefined unless both sides have a level. */
export function spreadOf(bids: Level[], asks: Level[]): { spread: bigint; bps: string } | undefined {
  const b = bids[0]?.price, a = asks[0]?.price
  if (b === undefined || a === undefined) return
  const spread = a - b
  const tenths = (spread * 200_000n * 2n + (a + b)) / ((a + b) * 2n) // spread / mid × 10⁴, in tenths, rounded half up
  return { spread, bps: `${tenths / 10n}.${tenths % 10n}` }
}

/**
 * The depth chart's step areas in the mockup's 560×220 viewBox (x 10..550, baseline y 200, top y 25): the price axis is
 * centred on the mid (x 280) and spans the further side's worst level plus 6%; `lo`/`hi` are the edge prices.
 */
export function depthPaths(bids: Level[], asks: Level[]) {
  const bb = bids[0]?.price, ba = asks[0]?.price
  if (bb === undefined && ba === undefined) return
  const mid = bb !== undefined && ba !== undefined ? (Number(bb) + Number(ba)) / 2 : Number(bb ?? ba)
  const far = Math.max(mid - Number(bids.at(-1)?.price ?? mid), Number(asks.at(-1)?.price ?? mid) - mid)
  const half = far * 1.06 || mid * 0.05 || 1
  const maxCum = Number([bids.at(-1)?.total ?? 0n, asks.at(-1)?.total ?? 0n].reduce((m, t) => (t > m ? t : m)))
  const x = (p: bigint) => 10 + ((Number(p) - (mid - half)) / (2 * half)) * 540
  const y = (c: bigint) => 200 - (Number(c) / maxCum) * 175
  const step = (lv: Level[], edge: number) => {
    if (!lv.length) return
    let d = `M${x(lv[0]!.price).toFixed(1)} 200`
    lv.forEach((l, i) => { const px = x(l.price).toFixed(1); d += ` L${px} ${y(i ? lv[i - 1]!.total : 0n).toFixed(1)} L${px} ${y(l.total).toFixed(1)}` })
    return `${d} L${edge} ${y(lv.at(-1)!.total).toFixed(1)}`
  }
  const bid = step(bids, 10), ask = step(asks, 550)
  return {
    bid, ask, bidFill: bid && `${bid} L10 200 Z`, askFill: ask && `${ask} L550 200 Z`,
    lo: BigInt(Math.max(0, Math.round(mid - half))), hi: BigInt(Math.round(mid + half)),
  }
}
