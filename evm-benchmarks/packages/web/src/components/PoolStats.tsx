import type { PoolState } from '@evmb/pool'
import { amountText } from '../swap/ui'
import { kText, poolPriceText } from '../pool/ui'

const stat = 'flex flex-col gap-1 rounded-xl border border-line-strong bg-surface px-3.5 py-3'
const label = 'text-xs text-muted'
const value = 'font-mono text-lg font-semibold'
const note = 'text-xs text-muted'

/** The five stat cards: pool price, both reserves, k, the fee. `s` is seen from the page's pair. */
export function PoolStats({ s, base, quote }: { s?: PoolState; base: string; quote: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <div className={stat}><span className={label}>Pool price</span><span className={value}>{s ? poolPriceText(s) : '—'}</span><span className={note}>{quote} per {base} = {quote} ÷ {base}</span></div>
      <div className={stat}><span className={label}>Reserve x · {base}</span><span className={value}>{s ? amountText(s.reserveBase, s.baseDecimals) : '—'}</span></div>
      <div className={stat}><span className={label}>Reserve y · {quote}</span><span className={value}>{s ? amountText(s.reserveQuote, s.quoteDecimals) : '—'}</span></div>
      <div className={stat}><span className={label}>k = x · y</span><span className="font-mono text-sm font-semibold">{s ? kText(s) : '—'}</span><span className={note}>only grows (fees)</span></div>
      <div className={stat}><span className={label}>Swap fee</span><span className={value}>0.30%</span><span className={note}>paid to liquidity providers</span></div>
    </div>
  )
}
