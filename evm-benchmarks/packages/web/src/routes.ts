/** Maps an old `/explorer…` path to its `/chains…` equivalent; anything else gives null. */
export function legacyRoute(path: string): string | null {
  const m = /^\/explorer(\/.*)?$/.exec(path)
  return m ? `/chains${(m[1] ?? '').replace(/\/$/, '')}` : null
}
