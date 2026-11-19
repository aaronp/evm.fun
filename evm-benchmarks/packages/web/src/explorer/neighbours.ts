/** Up to `span` parents (ascending) and children of block `n` on a chain whose tip is `head`. */
export function neighbours(n: number, head: number, span = 3) {
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)
  return { parents: range(Math.max(0, n - span), n - 1), children: range(n + 1, Math.min(head, n + span)) }
}

/** Block to step to from `focus` (dir -1 parent, +1 child), or null if disabled. Beyond the tip, parent jumps to the tip. */
export function stepTarget(focus: number, head: number, dir: -1 | 1): number | null {
  if (head < 0) return null
  if (focus > head) return dir < 0 ? head : null
  const t = focus + dir
  return t < 0 || t > head ? null : t
}
