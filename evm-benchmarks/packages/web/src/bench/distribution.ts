export interface Series { id: string; name: string; samples: number[] /* sorted ascending, ms */ }

function range(series: Series[]): [number, number] | undefined {
  const all = series.filter(s => s.samples.length)
  if (!all.length) return undefined
  return [Math.min(...all.map(s => s.samples[0]!)), Math.max(...all.map(s => s.samples[s.samples.length - 1]!))]
}

/** Samples <= x in a sorted array. */
function countAtOrBelow(sorted: number[], x: number): number {
  let lo = 0, hi = sorted.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m]! <= x) lo = m + 1; else hi = m }
  return lo
}

/** Shared equal-width bins; shares are each series' % of its own txs per bin. */
export function histogram(series: Series[], bins = 40): { edges: number[]; shares: number[][] } {
  const r = range(series)
  if (!r) return { edges: [], shares: [] }
  const [lo, max] = r
  const hi = max > lo ? max : lo + 1 // all-equal samples: one unit-wide bin
  const nb = max > lo ? bins : 1
  const w = (hi - lo) / nb
  const edges = Array.from({ length: nb + 1 }, (_, i) => (i === nb ? hi : lo + i * w))
  const shares = series.map(s => {
    const counts = new Array<number>(nb).fill(0)
    for (const v of s.samples) counts[Math.min(nb - 1, Math.floor((v - lo) / w))]!++
    return counts.map(c => (s.samples.length ? (c * 100) / s.samples.length : 0))
  })
  return { edges, shares }
}

/** Shared x grid min..max; ys are the % of each series' txs at or below x. */
export function cumulative(series: Series[], points = 100): { xs: number[]; ys: number[][] } {
  const r = range(series)
  if (!r) return { xs: [], ys: [] }
  const [lo, hi] = r
  const xs = Array.from({ length: points }, (_, i) => (i === points - 1 ? hi : lo + ((hi - lo) * i) / (points - 1)))
  const ys = series.map(s => xs.map(x => (s.samples.length ? (countAtOrBelow(s.samples, x) * 100) / s.samples.length : 0)))
  return { xs, ys }
}
