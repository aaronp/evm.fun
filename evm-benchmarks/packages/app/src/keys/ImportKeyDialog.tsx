import { useState } from 'react'
import type { Hex } from 'viem'
import { Modal } from '../shell/Modal'
import { S } from '../theme'

export const NOT_A_KEY = "That isn't a private key"
/** null when `v` is a 0x… 64-hex private key. */
export const checkPrivateKey = (v: string) => (/^0x[0-9a-fA-F]{64}$/.test(v.trim()) ? null : NOT_A_KEY)

export function ImportKeyDialog(p: { onImport(key: Hex): Promise<void>; onClose(): void; initial?: { value: string; error: string } }) {
  const [value, setValue] = useState(p.initial?.value ?? '')
  const [error, setError] = useState(p.initial?.error ?? '')
  const [busy, setBusy] = useState(false)
  const submit = () => {
    const bad = checkPrivateKey(value)
    if (bad) return setError(bad)
    setBusy(true)
    p.onImport(value.trim() as Hex).catch((e) => {
      const m = e instanceof Error ? e.message : String(e)
      setError(m === 'cancelled' ? '' : m) // passphrase prompt cancelled: stay open, no error
      setBusy(false)
    })
  }
  return (
    <Modal title="Import key" intro="Paste a private key. It's encrypted with your passphrase and stays in this browser."
      error={error} confirmLabel="Import key" canConfirm={value.trim().length > 0 && !busy} onConfirm={submit} onClose={p.onClose}>
      <label style={S.label}>Private key
        <input type="password" autoFocus spellCheck={false} autoComplete="off" placeholder="0x…" value={value}
          onChange={(e) => { setValue(e.target.value); setError('') }} style={{ ...S.input, fontFamily: "'JetBrains Mono', monospace" }} />
      </label>
    </Modal>
  )
}
