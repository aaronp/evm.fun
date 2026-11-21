import type { PoolState } from '@evmb/pool'
import { curve, poolPriceText } from '../pool/ui'
import { card } from './TakePanel'

const W = 560, H = 320, L = 36, B = 300, T = 8, R = 552 // plot box: x L..R, y T..B
const small = 'flex flex-col gap-1 rounded-xl bg-panel px-3 py-2.5 font-mono text-xs'

/** "The curve x · y = k": the pool's curve around now, the now point with guides, and `after` (the swap's quote, from the Swap tab). */
export function PoolCurve({ s, after, base, quote, offers }: {
  s?: PoolState; after?: Pick<PoolState, 'reserveBase' | 'reserveQuote'>; base: string; quote: string; /** "bid … · ask …" or "none" */ offers: string
}) {
  const c = s && curve(s, after)
  const px = (x: number) => L + ((x - c!.x0) / (c!.x1 - c!.x0)) * (R - L)
  const py = (y: number) => B - (Math.min(y, c!.y1) / c!.y1) * (B - T)
  return (
    <section aria-labelledby="cv-h" className={`${card} flex flex-col gap-3 p-[18px]`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="cv-h" className="text-sm font-semibold">The curve x · y = k</h2>
          <p className="text-xs text-muted">Every swap slides the pool along this curve; the steeper it gets, the worse the price.</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-text-2">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-accent" />now</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-warn" />after this swap</span>
        </div>
      </div>
      <svg role="img" aria-label={c ? `x · y = k; now at ${c.now.x} ${base} and ${c.now.y} ${quote}` : 'empty pool'} viewBox={`0 0 ${W} ${H + 24}`} className="w-full">
        <path d={`M${L} ${T}V${B}H${R}`} fill="none" strokeWidth={1} className="stroke-line-strong" />
        <text x={(L + R) / 2} y={H + 18} textAnchor="middle" className="fill-muted font-mono text-[11px]">x · {base} in pool →</text>
        <text transform={`translate(14 ${(T + B) / 2}) rotate(-90)`} textAnchor="middle" className="fill-muted font-mono text-[11px]">y · {quote} in pool →</text>
        {c && <>
          <path d={c.points.map(([x, y], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)} ${py(y).toFixed(1)}`).join('')} fill="none" strokeWidth={2} className="stroke-accent" />
          <path d={`M${L} ${py(c.now.y)}H${px(c.now.x)}V${B}`} fill="none" strokeWidth={1} strokeDasharray="4 4" className="stroke-subtle" />
          <circle cx={px(c.now.x)} cy={py(c.now.y)} r={5} className="fill-accent" />
          {c.after && <circle cx={px(c.after.x)} cy={py(c.after.y)} r={7} fill="none" strokeWidth={2.5} className="stroke-warn" />}
        </>}
      </svg>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={small}><span className="font-sans text-muted">Price now</span><span>{s ? poolPriceText(s) : '—'}</span></div>
        <div className={small}><span className="font-sans text-muted">Price after</span><span>{s && after ? poolPriceText({ ...s, ...after }) : '—'}</span></div>
        <div className={small}><span className="font-sans text-muted">Swap offers (step 2)</span><span className="text-accent">{offers}</span></div>
      </div>
    </section>
  )
}
