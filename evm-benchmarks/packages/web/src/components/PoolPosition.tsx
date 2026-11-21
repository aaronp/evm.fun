import type { PoolState } from '@evmb/pool'
import { amountText } from '../swap/ui'
import { lpText, shareText, worth } from '../pool/ui'
import { card } from './TakePanel'

const row = 'flex justify-between gap-3 text-[13px]'

/** "Your position": share of the pool, LP, what removing it all would pay and its worth at the pool price. */
export function PoolPosition({ s, pos, base, quote }: { s?: PoolState; pos?: { shares: bigint; base: bigint; quote: bigint }; base: string; quote: string }) {
  const pct = s && pos ? shareText(pos.shares, s.totalShares) : undefined
  return (
    <section aria-labelledby="ps-h" className={`${card} flex flex-col gap-3 p-[18px]`}>
      <h2 id="ps-h" className="text-sm font-semibold">Your position</h2>
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="font-display text-2xl font-semibold">{pct ?? '—'}</span>
        <span className="text-[13px] text-muted">of the pool · {pos ? lpText(pos.shares) : '—'} LP</span>
      </p>
      <div role="progressbar" aria-label="Your share of the pool" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ? Number.parseFloat(pct) : 0} className="h-1.5 overflow-hidden rounded-full bg-selected">
        <div className="h-full rounded-full bg-accent" style={{ width: pct ?? '0%' }} />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className={row}><span className="text-text-2">Your {base} in the pool</span><span className="font-mono">{s && pos ? amountText(pos.base, s.baseDecimals) : '—'}</span></div>
        <div className={row}><span className="text-text-2">Your {quote} in the pool</span><span className="font-mono">{s && pos ? amountText(pos.quote, s.quoteDecimals) : '—'}</span></div>
      </div>
      <div className={`${row} border-t border-line pt-3`}><span className="text-text-2">Worth at pool price</span><span className="font-mono font-semibold">{s && pos ? `${amountText(worth(s, pos.base, pos.quote), s.quoteDecimals)} ${quote}` : '—'}</span></div>
    </section>
  )
}
