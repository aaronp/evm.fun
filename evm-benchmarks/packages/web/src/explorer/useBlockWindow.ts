import { useCallback, useEffect, useState } from 'react'
import type { ChainHandle } from '../chain/handle'
import { useApp } from '../state'
import { blockWindow, type Header } from './window'

type S = { h?: ChainHandle; headers: Header[]; total: number; loading: boolean }

/** The latest-500 window; re-reads on `refresh()` and whenever balanceTick changes (every send bumps it). */
export function useBlockWindow(h?: ChainHandle) {
  const { balanceTick } = useApp()
  const [manual, setManual] = useState(0)
  const [s, set] = useState<S>({ h, headers: [], total: 0, loading: !!h })
  useEffect(() => {
    let live = true
    if (!h) return set({ h, headers: [], total: 0, loading: false })
    set(x => ({ ...x, loading: true }))
    blockWindow(h).then(w => live && set({ h, ...w, loading: false }))
    return () => { live = false }
  }, [h, balanceTick, manual])
  const refresh = useCallback(() => setManual(m => m + 1), [])
  // Never show another chain's blocks while the new chain's window loads.
  const cur = s.h === h ? s : { headers: [], total: 0, loading: !!h }
  return { headers: cur.headers, total: cur.total, loading: cur.loading, refresh }
}
