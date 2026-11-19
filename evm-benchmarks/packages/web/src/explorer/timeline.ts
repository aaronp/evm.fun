import type { Header } from './window'

/** Maps min..max timestamp onto pad..width-pad; a single block or equal timestamps sit at the centre. */
export function timeScale(headers: Header[], width: number, pad = 16): (ts: number) => number {
  const ts = headers.map(h => h.timestamp)
  const lo = Math.min(...ts), hi = Math.max(...ts)
  if (!(hi > lo)) return () => width / 2
  return t => pad + ((t - lo) / (hi - lo)) * (width - 2 * pad)
}

/** 3 px at 0 txs, rising with sqrt(txCount/maxTx) to 14 px. */
export const markRadius = (txCount: number, maxTx: number) =>
  maxTx > 0 ? 3 + 11 * Math.sqrt(Math.min(txCount, maxTx) / maxTx) : 3

/** n evenly spaced whole-second ticks from lo to hi, deduplicated (a tiny span yields fewer). */
export const ticks = (lo: number, hi: number, n = 5): number[] =>
  hi > lo ? [...new Set(Array.from({ length: n }, (_, i) => lo + Math.round(((hi - lo) * i) / (n - 1))))] : [lo]

/** Time axis, unless timestamps are so clustered (few distinct pixel columns) that marks pile up; then spread by block number. */
export function timelineLayout(headers: Header[], width: number, pad = 16): { mode: 'time' | 'index'; x: (h: Header) => number } {
  const X = timeScale(headers, width, pad)
  const cols = new Set(headers.map(h => Math.round(X(h.timestamp)))).size
  if (cols >= Math.max(2, headers.length / 4)) return { mode: 'time', x: h => X(h.timestamp) }
  const ns = headers.map(h => h.number)
  const lo = Math.min(...ns), hi = Math.max(...ns)
  return { mode: 'index', x: h => (hi > lo ? pad + ((h.number - lo) / (hi - lo)) * (width - 2 * pad) : width / 2) }
}
