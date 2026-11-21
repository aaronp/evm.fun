import type { PoolActivity, PoolState } from '@evmb/pool'
import { priceText, type book } from '@evmb/swap'
import { formatAmount } from '../assets/ui'
import { amountText, same } from '../swap/ui'

type Reserves = Pick<PoolState, 'reserveBase' | 'reserveQuote'>
type Tok = { symbol: string; decimals: number; address?: string }
const pow10 = (d: number) => 10n ** BigInt(d)

/** Pool price (quote per base) from the reserves as an exact rational, 4 dp half-up; '—' while empty. */
export const poolPriceText = (s: PoolState) =>
  s.reserveBase ? priceText({ num: s.reserveQuote * pow10(s.baseDecimals), den: s.reserveBase * pow10(s.quoteDecimals) }) : '—'

/** Trade header reference beside the last price: "pool 1.2700", or nothing without a funded pool. */
export const poolRef = (s?: PoolState) => (s?.reserveBase ? `pool ${poolPriceText(s)}` : undefined)

/** k = x · y in whole units. */
export const kText = (s: PoolState) => formatAmount(s.reserveBase * s.reserveQuote, s.baseDecimals + s.quoteDecimals, 0)

/** LP shares (18 dp), half-up 2 dp. */
export const lpText = (v: bigint) => formatAmount(v, 18, 2)

/** shares / total as a percentage, half-up 2 dp. */
export const shareText = (shares: bigint, total: bigint) => `${total ? priceText({ num: shares * 100n, den: total }, 2) : '0.00'}%`

/** base + quote valued in quote raw units at the pool price (floor). */
export const worth = (s: PoolState, base: bigint, quote: bigint) => quote + (s.reserveBase ? base * s.reserveQuote / s.reserveBase : 0n)

const whole = (v: bigint, d: number) => Number(v) / 10 ** d

/** The curve x · y = k in whole units around the current point (and the after point, when given): x from now/2.2 to
 * now·1.9, y from 0 to k/x0 — the mockup's framing. Sampled geometrically in x so the steep end stays smooth. */
export function curve(s: PoolState, next?: Reserves, n = 64) {
  if (!s.reserveBase || !s.reserveQuote) return
  const now = { x: whole(s.reserveBase, s.baseDecimals), y: whole(s.reserveQuote, s.quoteDecimals) }
  const after = next && { x: whole(next.reserveBase, s.baseDecimals), y: whole(next.reserveQuote, s.quoteDecimals) }
  const k = now.x * now.y
  const x0 = Math.min(now.x, after?.x ?? now.x) / 2.2, x1 = Math.max(now.x, after?.x ?? now.x) * 1.9
  const points = Array.from({ length: n }, (_, i) => { const x = x0 * (x1 / x0) ** (i / (n - 1)); return [x, k / x] as [number, number] })
  return { now, after, x0, x1, y1: Math.max(k / x0, after?.y ?? 0), points }
}

/** One Pool activity row in the page's order (a reversed pool's amounts are swapped back). */
export function activityRow(i: PoolActivity, raw: PoolState, t: { base: Tok; quote: Tok }, name: (a: string) => string) {
  const who = name(i.who)
  if (i.kind === 'swap') {
    const [inT, outT] = same(i.tokenIn, t.base.address) ? [t.base, t.quote] : [t.quote, t.base]
    return { kind: i.kind, text: `${who} · ${amountText(i.amountIn!, inT.decimals)} ${inT.symbol} → ${amountText(i.amountOut!, outT.decimals)} ${outT.symbol}` }
  }
  const [b, q] = same(raw.base, t.base.address) ? [i.base, i.quote] : [i.quote, i.base]
  return {
    kind: i.kind,
    text: `${who} · ${amountText(b, t.base.decimals)} ${t.base.symbol} + ${amountText(q, t.quote.decimals)} ${t.quote.symbol}`,
    lp: `${i.kind === 'add' ? '+' : '−'}${lpText(i.shares!)} LP`,
  }
}

/** "Swap offers (step 2)": the Swap page's best bid · ask for the pair, or "none". */
export function offersText(b?: ReturnType<typeof book>) {
  if (!b?.bestBid && !b?.bestAsk) return 'none'
  const p = (r?: { price: { num: bigint; den: bigint } }) => (r ? priceText(r.price) : '—')
  return `bid ${p(b.bestBid)} · ask ${p(b.bestAsk)}`
}
