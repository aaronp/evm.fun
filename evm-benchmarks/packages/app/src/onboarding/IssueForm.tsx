import { useState } from 'react'
import { VALID_FOR, formatCode, generateCode } from '@evmb/workspace'
import { C, FONT, R, S } from '../theme'
import { cancelled, text } from '../state'
import { checkIssue, type CodeView } from './view'

export const card = { display: 'flex', flexDirection: 'column', padding: 24, background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 14 } as const
export type Issue = { code: string; label: string; validFor: (typeof VALID_FOR)[number]['key']; uses: number }

const copy = (s: string) => { navigator.clipboard?.writeText(s).catch(() => {}) } // else: the text stays selectable

/** The prototype's "Issue an access code" card; after an issue, the plain code and its link, shown once. */
export function IssueForm(p: {
  busy: boolean; codes: CodeView[]; issued?: { code: string; link: string }
  /** rejects with the message to show */
  onIssue(o: Issue): Promise<void>; onDismiss(): void
}) {
  const [code, setCode] = useState(generateCode)
  const [validFor, setValidFor] = useState<Issue['validFor']>('1h')
  const [uses, setUses] = useState('1')
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  const issue = () => {
    const bad = checkIssue(code, Number(uses), p.codes)
    if (bad) return setError(bad)
    setError('')
    p.onIssue({ code, label: label.trim(), validFor, uses: Number(uses) }).then(
      () => { setCode(generateCode()); setUses('1'); setLabel('') },
      (e) => { if (!cancelled(e)) setError(text(e)) },
    )
  }
  return (
    <section aria-labelledby="onb-issue" style={{ ...card, gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h3 id="onb-issue" style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Issue an access code</h3>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: C.muted }}>Whoever enters the code can deploy a chain of their own, vouched for by Root.</p>
      </div>
      {p.issued && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: R.lg, background: '#ECFDF3', border: '1px solid #ABEFC6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: FONT.mono, fontSize: 22, fontWeight: 500, letterSpacing: '.12em', color: C.ink, userSelect: 'all' }}>{formatCode(p.issued.code)}</span>
            <button type="button" onClick={() => copy(p.issued!.code)} className="hov" style={{ ...S.secondary(), minHeight: 40, fontSize: 13 }}>Copy code</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: FONT.mono, fontSize: 13, color: C.text, wordBreak: 'break-all', userSelect: 'all' }}>{p.issued.link}</span>
            <button type="button" onClick={() => copy(p.issued!.link)} className="hov" style={{ ...S.secondary(), minHeight: 40, fontSize: 13 }}>Copy link</button>
            <button type="button" onClick={p.onDismiss} className="hov" style={{ minHeight: 40, padding: '0 12px', border: 0, borderRadius: R.sm, background: 'transparent', font: 'inherit', fontSize: 13, fontWeight: 600, color: '#054F31', cursor: 'pointer' }}>Done</button>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="onb-code" style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Code</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="onb-code" type="text" autoCapitalize="characters" spellCheck={false} autoComplete="off" value={code} onChange={(e) => { setCode(e.target.value); setError('') }} aria-describedby="onb-code-hint"
              style={{ ...S.input, flex: 1, minWidth: 0, fontFamily: FONT.mono, fontSize: 16, letterSpacing: '.12em' }} />
            <button type="button" onClick={() => { setCode(generateCode()); setError('') }} aria-label="Generate a new code" title="Generate a new code" className="hov"
              style={{ flex: 'none', width: 44, height: 44, border: `1px solid ${C.field}`, borderRadius: R.md, background: '#FFFFFF', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={C.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" /></svg>
            </button>
          </div>
          <span id="onb-code-hint" style={{ fontSize: 12, lineHeight: 1.4, color: C.muted }}>Generated for you. Type your own if you prefer: 4–16 letters or digits.</span>
        </div>
        <label style={S.label}>Valid for
          <select value={validFor} onChange={(e) => setValidFor(e.target.value as Issue['validFor'])} style={{ ...S.input, padding: '0 10px', background: '#FFFFFF', fontWeight: 400 }}>
            {VALID_FOR.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
        </label>
        <label style={S.label}>Deployments allowed
          <input type="number" min={1} max={1000} step={1} value={uses} onChange={(e) => { setUses(e.target.value); setError('') }} style={{ ...S.input, fontWeight: 400 }} />
        </label>
      </div>
      <label style={{ ...S.label, maxWidth: 440 }}>For (optional)
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" style={{ ...S.input, fontWeight: 400 }} />
      </label>
      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: C.error }}>{error}</p>}
      <div><button type="button" onClick={issue} disabled={p.busy} style={{ ...S.primary(!p.busy), padding: '0 20px' }}>Issue code</button></div>
    </section>
  )
}
