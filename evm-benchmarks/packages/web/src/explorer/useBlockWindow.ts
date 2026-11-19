import { useCallback, useEffect, useState } from 'react'
import type { ChainHandle } from '../chain/handle'
import { useApp } from '../state'
import { blockWindow, type Header } from './window'

/** The latest-500 window; re-reads on `refresh()` and whenever balanceTick changes (every send bumps it). */
export function useBlockWindow(h?: ChainHandle) {
  const { balanceTick } = useApp()
  const [manual, setManual] = useState(0)
  const [s, set] = useState<{ headers: Header[]; total: number; loading: boolean }>({ headers: [], total: 0, loading: !!h })
  useEffect(() => {
    let live = true
    if (!h) return set({ headers: [], total: 0, loading: false })
    set(x => ({ ...x, loading: true }))
    blockWindow(h).then(w => live && set({ ...w, loading: false }))
    return () => { live = false }
  }, [h, balanceTick, manual])
  const refresh = useCallback(() => setManual(m => m + 1), [])
  return { ...s, refresh }
}
