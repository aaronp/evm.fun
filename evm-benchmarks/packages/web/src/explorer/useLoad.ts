import { useEffect, useState } from 'react'

/** Run `f` when deps change; `undefined` = loading, `null` = not found. Rejections read as not found. */
export function useLoad<T>(f: () => Promise<T | null>, deps: unknown[]) {
  const [v, setV] = useState<T | null | undefined>()
  useEffect(() => {
    let live = true
    setV(undefined)
    f().then(x => live && setV(x), () => live && setV(null))
    return () => { live = false }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return v
}
