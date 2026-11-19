// Fisheye lens maths, ported from the design mockup (pure).
export const LENS_MAG = 12, LENS_SPREAD = 2.5

/** Item sizes: weight 1 + mag·exp(-((i-f)/spread)²) around focus index f, normalised to `len`. */
export function lensSizes(n: number, f: number, mag: number, spread: number, len: number): number[] {
  if (n < 1) throw new Error('lensSizes needs at least one item')
  const w = Array.from({ length: n }, (_, i) => 1 + mag * Math.exp(-(((i - f) / spread) ** 2)))
  const sum = w.reduce((a, b) => a + b, 0)
  return w.map(x => (x / sum) * len)
}

/** Pixel position of continuous coordinate u (item i spans [i, i+1)). */
export function lensPos(sizes: number[], u: number): number {
  const k = Math.min(sizes.length - 1, Math.floor(u))
  let acc = 0
  for (let j = 0; j < k; j++) acc += sizes[j]!
  return acc + (u - k) * sizes[k]!
}

/** Inverse of lensPos: the focus index whose magnified item is centred under offset p (28-step bisection). */
export function lensFocus(n: number, p: number, mag: number, spread: number, len: number): number {
  let lo = 0, hi = n - 1
  for (let it = 0; it < 28; it++) {
    const mid = (lo + hi) / 2
    if (lensPos(lensSizes(n, mid, mag, spread, len), mid + 0.5) < p) lo = mid; else hi = mid
  }
  return (lo + hi) / 2
}

/** Tile look from the mockup: cross size (H: tile height 36..150 px; V: tile width 160..440 px) by size/max; full and mid label thresholds per orientation; filled from 6 px. */
export function tileStyle(size: number, maxSize: number, horizontal: boolean) {
  const rel = maxSize > 0 ? size / maxSize : 0
  const full = size >= (horizontal ? 130 : 64)
  return {
    cross: Math.round(horizontal ? 36 + 114 * rel : 160 + 280 * rel),
    full,
    mid: !full && size >= (horizontal ? 44 : 22),
    filled: size >= 6,
  }
}

/** A `span`-sized window of indexes [start, end) around `anchor`, clamped to [0, total). */
export function lensWindow(total: number, anchor: number, span = 36): { start: number; end: number } {
  const w = Math.min(span, total)
  const start = Math.max(0, Math.min(total - w, anchor - Math.floor(w / 2)))
  return { start, end: start + w }
}
