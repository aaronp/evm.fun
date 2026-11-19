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
