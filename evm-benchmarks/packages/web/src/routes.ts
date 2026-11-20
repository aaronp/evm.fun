/** Maps an old `/explorer…` path to its `/chains…` equivalent; anything else gives null. */
export function legacyRoute(path: string): string | null {
  const m = /^\/explorer(\/.*)?$/.exec(path)
  return m ? `/chains${(m[1] ?? '').replace(/\/$/, '')}` : null
}

/** Where to land after switching chain: the top-level page, without chain-specific detail (`?asset=`, `/chains/tx/…`, `/swap/report?tx=`). */
export const pageOf = (path: string) => `/${path.split('/')[1] ?? ''}`
