import { useState } from 'react'
import { percentile } from '@evmb/core'
import { Segmented } from '../ui/segmented'
import { cumulative, histogram, type Series } from '../bench/distribution'

type View = 'histogram' | 'cumulative'
const W = 640, H = 280, L = 44, R = 12, T = 10, B = 34
const PW = W - L - R, PH = H - T - B
const colour = (i: number) => `var(--c-series-${(i % 6) + 1})`
const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1))

/** ~4 round y ticks up to a rounded-up max. */
function niceMax(v: number) {
  const step = 10 ** Math.floor(Math.log10(Math.max(v, 1e-9)))
  return Math.ceil(v / step) * step
}

export function DistributionChart({ series }: { series: Series[] }) {
  const [view, setView] = useState<View>('histogram')
  if (!series.length) return null

  const h = view === 'histogram' ? histogram(series) : undefined
  const c = view === 'cumulative' ? cumulative(series) : undefined
  const xs = h ? h.edges : c!.xs
  const x0 = xs[0]!, x1 = xs[xs.length - 1]! > x0 ? xs[xs.length - 1]! : x0 + 1 // all-equal samples: widen like histogram
  const ymax = h ? niceMax(Math.max(...h.shares.flat())) : 100
  const X = (v: number) => L + ((v - x0) / (x1 - x0)) * PW
  const Y = (v: number) => T + PH - (v / ymax) * PH
  const xTicks = Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4)
  const yTicks = Array.from({ length: 5 }, (_, i) => (ymax * i) / 4)

  const stats = series.map(s => ({ p50: percentile(s.samples, 50), p99: percentile(s.samples, 99) }))
  const label = `${view === 'histogram' ? 'Latency histogram' : 'Cumulative latency distribution'} of ${series.length} run${series.length > 1 ? 's' : ''}, ${fmt(x0)} to ${fmt(x1)} ms: `
    + series.map((s, i) => `${s.name} p50 ${fmt(stats[i]!.p50)} ms, p99 ${fmt(stats[i]!.p99)} ms`).join('; ')

  const lines = series.map((_, i) => {
    if (h) {
      // step outline along the top of each bin (the fill below is closed to the baseline)
      const sh = h.shares[i]!
      const d = sh.map((v, b) => `${b ? 'L' : 'M'}${X(h.edges[b]!)} ${Y(v)}L${X(h.edges[b + 1]!)} ${Y(v)}`).join('')
      return { d, fill: `${d}L${X(x1)} ${Y(0)}L${X(x0)} ${Y(0)}Z` }
    }
    return { d: c!.xs.map((x, k) => `${k ? 'L' : 'M'}${X(x)} ${Y(c!.ys[i]![k]!)}`).join('') }
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-xs font-medium text-muted" aria-hidden="true">View:</span>
        <Segmented<View>
          label="View" name="dist-view" value={view} onChange={setView} className="flex items-center gap-3" itemClassName="px-2.5 py-1 text-xs font-medium"
          options={[{ value: 'histogram', content: 'Histogram' }, { value: 'cumulative', content: 'Cumulative' }]}
        />
      </div>
      <div className="overflow-x-auto"><svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px]">
        {yTicks.map(t => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} className="stroke-line" strokeWidth={1} />
            <text x={L - 6} y={Y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted text-[10px]">{fmt(t)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={X(t)} y={H - B + 14} textAnchor="middle" className="fill-muted text-[10px]">{fmt(t)}</text>
        ))}
        <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} className="stroke-line-strong" strokeWidth={1} />
        <text x={L + PW / 2} y={H - 4} textAnchor="middle" className="fill-muted text-[10px]">latency (ms)</text>
        <text x={12} y={T + PH / 2} textAnchor="middle" transform={`rotate(-90 12 ${T + PH / 2})`} className="fill-muted text-[10px]">{h ? '% of run’s txs per bin' : '% of txs ≤ latency'}</text>
        {lines.map((l, i) => (
          <g key={series[i]!.id} style={{ stroke: colour(i), fill: colour(i) }}>
            {l.fill && <path d={l.fill} stroke="none" fillOpacity={0.15} />}
            <path d={l.d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
      </svg></div>
      <ul className="space-y-1 text-sm">
        {series.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colour(i) }} />
            <span className="font-medium">{s.name}</span>
            <span className="font-mono text-xs text-muted">p50 {fmt(stats[i]!.p50)} ms · p99 {fmt(stats[i]!.p99)} ms</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">All transactions are submitted at once, so latency largely reflects queue position rather than per-transaction cost.</p>
    </div>
  )
}
