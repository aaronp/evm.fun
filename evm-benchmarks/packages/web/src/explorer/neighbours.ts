/** Up to `span` parents (ascending) and children of block `n` on a chain whose tip is `head`. */
export function neighbours(n: number, head: number, span = 3) {
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)
  return { parents: range(Math.max(0, n - span), n - 1), children: range(n + 1, Math.min(head, n + span)) }
}
