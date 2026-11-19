import { useState } from 'react'
import { kv } from '../store/kv'
import { accounts } from '../store/accounts'

export const KEYS_WARNING = 'Playground keys only — stored unencrypted in this browser. Never use a real key.'
export const STORAGE_UNAVAILABLE = 'Storage unavailable — nothing will be saved.'

export function Notice({ children, onDismiss }: { children: string; onDismiss?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span>{children}</span>
      {onDismiss && (
        <button aria-label="Dismiss" className="ml-4 font-bold" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  )
}

export function StorageNotice() {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || (kv.persistent && accounts.persistent)) return null
  return <Notice onDismiss={() => setDismissed(true)}>{STORAGE_UNAVAILABLE}</Notice>
}
