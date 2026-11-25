import { useState } from 'react'
import { isValidCode, type ChainRecord, type CodeSource } from '@evmb/workspace'
import { Modal } from '../shell/Modal'
import { C, FONT, R } from '../theme'
import { refusalCopy } from './view'

type Mode = 'code' | 'vouch'

/**
 * The prototype's `deploy` modal: *Someone gave me a code*, or *Vouch* (issuers only; root is the one chain that can
 * vouch). `onDeploy` rejects with the worker's reason, shown as the prototype's copy; a cancelled passphrase shows nothing.
 */
export function DeployModal(p: {
  chain: ChainRecord; issuer: boolean; initialCode?: string; initialMode?: Mode
  onDeploy(src: CodeSource): Promise<void>; onClose(): void
}) {
  const [mode, setMode] = useState<Mode>(p.issuer ? (p.initialMode ?? 'code') : 'code')
  const [code, setCode] = useState(p.initialCode ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const modes: { key: Mode; title: string; desc: string }[] = [
    { key: 'code', title: 'Someone gave me a code', desc: 'An admin issued you a code.' },
    ...(p.issuer ? [{ key: 'vouch' as const, title: 'Vouch', desc: 'You’re an admin, so Root can vouch for this one.' }] : []),
  ]
  const submit = () => {
    if (mode === 'code') {
      if (code.trim() === '') return setError('Enter the access code you were given.')
      if (!isValidCode(code)) return setError(refusalCopy('bad code'))
    }
    setBusy(true)
    p.onDeploy(mode === 'code' ? { code } : { vouch: true }).catch((e) => {
      const m = e instanceof Error ? e.message : String(e)
      setError(m === 'cancelled' ? '' : refusalCopy(m))
      setBusy(false)
    })
  }
  return (
    <Modal title={`Deploy ${p.chain.name}`} intro="Deploying moves this chain to the cloud so the people and devices you choose can connect. You need a one-time code from an admin."
      error={error} confirmLabel="Deploy chain" canConfirm={!busy} canClose={!busy} onConfirm={submit} onClose={p.onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <fieldset style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <legend style={{ padding: 0, marginBottom: 10, fontSize: 14, fontWeight: 600 }}>Where's your code from?</legend>
          {modes.map((o) => {
            const on = o.key === mode
            return (
              <label key={o.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: R.lg, cursor: 'pointer', ...(on ? { border: `2px solid ${C.accent}`, background: '#F5F8FF' } : { border: `1px solid ${C.field}`, background: '#FFFFFF' }) }}>
                <input type="radio" name="deploy-mode" checked={on} onChange={() => { setMode(o.key); setError('') }} style={{ width: 20, height: 20, margin: '2px 0 0' }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{o.title}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.45, color: C.muted }}>{o.desc}</span>
                </span>
              </label>
            )
          })}
        </fieldset>
        {mode === 'code' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label htmlFor="otp" style={{ fontSize: 14, fontWeight: 600 }}>Access code</label>
            <input id="otp" type="text" autoFocus autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} value={code}
              onChange={(e) => { setCode(e.target.value); setError('') }} placeholder="e.g. 205 117"
              style={{ minHeight: 60, padding: '0 20px', border: `1.5px solid ${C.field}`, borderRadius: R.lg, fontFamily: FONT.mono, fontSize: 24, letterSpacing: '.2em', color: C.ink, textAlign: 'center' }} />
          </div>
        )}
        {mode === 'vouch' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 600 }}>Vouch with
            <select defaultValue="root" style={{ minHeight: 44, padding: '0 12px', border: `1px solid ${C.field}`, borderRadius: R.md, background: '#FFFFFF', font: 'inherit', fontSize: 14, fontWeight: 400, color: C.ink }}>
              <option value="root">Root</option>
            </select>
          </label>
        )}
        <p style={{ margin: 0, padding: '12px 14px', borderRadius: R.md, background: '#F9FAFB', border: '1px solid #EAECF0', fontSize: 13, lineHeight: 1.5, color: C.text }}>After deploying, only you have access.</p>
      </div>
    </Modal>
  )
}
