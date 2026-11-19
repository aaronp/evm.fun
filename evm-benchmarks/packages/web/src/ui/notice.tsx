import { useEffect, useState } from 'react'
import { kv } from '../store/kv'
import { accounts } from '../store/accounts'

export const KEYS_WARNING = 'Playground keys only — stored unencrypted in this browser. Never use a real key.'
export const STORAGE_UNAVAILABLE = 'Storage unavailable — nothing will be saved.'

export function Notice({ children, onDismiss, tone = 'warn' }: { children: string; onDismiss?: () => void; tone?: 'warn' | 'success' }) {
  const cls = tone === 'success' ? 'border-success bg-success-soft text-success-text' : 'border-warn bg-warn-soft text-warn-text'
  return (
    <div role={tone === 'success' ? 'status' : 'alert'} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${cls}`}>
      <span>{children}</span>
      {onDismiss && (
        <button aria-label="Dismiss" className="ml-4 font-bold focus-visible:outline-2 focus-visible:outline-accent" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  )
}

export function StorageNotice() {
  const [dismissed, setDismissed] = useState(false)
  const [settled, setSettled] = useState(false) // hide until kv.ready, no flash on load
  const [, bump] = useState(0)
  useEffect(() => {
    const rerender = () => bump(n => n + 1)
    const off = [kv.onPersistenceChange(rerender), accounts.onPersistenceChange(rerender)]
    kv.ready.then(() => { setSettled(true); rerender() })
    return () => off.forEach(f => f())
  }, [])
  if (!settled || dismissed || (kv.persistent && accounts.persistent)) return null
  return <Notice onDismiss={() => setDismissed(true)}>{STORAGE_UNAVAILABLE}</Notice>
}
