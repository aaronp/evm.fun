import { useState } from 'react'
import { Modal } from '../shell/Modal'
import { S } from '../theme'

export const FIRST_RUN = "It encrypts your keys in this browser; it can't be recovered."
export const MISMATCH = "Passphrases don't match"
/** First run only: the confirmation must match, or the key is lost to a typo. */
export const confirmError = (pass: string, confirm: string) => (confirm && confirm !== pass ? MISMATCH : '')
// BrowserKeyStore's own purposes; others (from the workspace) are shown as given
const PURPOSES: Record<string, string> = { generate: 'Generate a key', import: 'Import a key' }

export type UnlockPrompt = { purpose: string; firstRun: boolean; error: string; busy: boolean }

/** The passphrase prompt: the purpose as its intro (first run: FIRST_RUN + a confirm field), "Wrong passphrase" inline. */
export function UnlockDialog(p: UnlockPrompt & { onSubmit(passphrase: string): void; onCancel(): void }) {
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const mismatch = p.firstRun ? confirmError(pass, confirm) : ''
  const can = pass.length > 0 && !p.busy && (!p.firstRun || confirm === pass)
  return (
    <Modal
      title={p.firstRun ? 'Choose a passphrase' : 'Unlock your keys'}
      intro={p.firstRun ? FIRST_RUN : (PURPOSES[p.purpose] ?? p.purpose)}
      error={mismatch || p.error} confirmLabel={p.firstRun ? 'Continue' : 'Unlock'} canConfirm={can}
      onConfirm={() => p.onSubmit(pass)} onClose={p.onCancel}
    >
      <label style={S.label}>Passphrase
        <input type="password" autoFocus autoComplete={p.firstRun ? 'new-password' : 'current-password'} value={pass} onChange={(e) => setPass(e.target.value)} style={S.input} />
      </label>
      {p.firstRun && (
        <label style={S.label}>Confirm passphrase
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={S.input} />
        </label>
      )}
    </Modal>
  )
}
