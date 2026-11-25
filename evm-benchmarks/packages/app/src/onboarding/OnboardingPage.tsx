import { useEffect, useState } from 'react'
import type { Hex } from 'viem'
import { VALID_FOR, codeHash, formatCode, type Workspace } from '@evmb/workspace'
import { C, ICONS } from '../theme'
import { cancelled, text, type Notice } from '../state'
import { CodeList, CodesHidden } from './CodeList'
import { IssueForm, card, type Issue } from './IssueForm'
import { codeLink, type CodeView, type Plain } from './view'

/**
 * The prototype's contract detail for root's Onboarding: issue, list and revoke codes. Codes are read when the page
 * opens and after each issue or revoke; one signing action at a time.
 */
export function OnboardingPage(p: {
  workspace?: Pick<Workspace, 'issueCode' | 'codes' | 'revokeCode'>; issuer: boolean
  /** codes issued in this session, by hash; kept by the caller across visits */
  plain: Plain; onNotice(n: Notice): void
}) {
  const ws = p.workspace
  const [codes, setCodes] = useState<CodeView[]>([])
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<{ code: string; link: string }>()
  const warn = (e: unknown) => { if (!cancelled(e)) p.onNotice({ text: text(e), kind: 'warn' }) }
  const load = () => ws?.codes().then(setCodes, warn)
  useEffect(() => { if (p.issuer) void load() }, [ws, p.issuer])

  const issue = async (o: Issue) => {
    setBusy(true)
    try {
      const { code } = await ws!.issueCode(o)
      p.plain.set(codeHash(code), code)
      setIssued({ code, link: codeLink(location.origin, location.pathname, code) })
      p.onNotice({ text: `Issued code ${formatCode(code)}, valid for ${VALID_FOR.find((v) => v.key === o.validFor)!.label}.`, kind: 'ok' })
      void load()
    } finally { setBusy(false) }
  }
  const revoke = (hash: Hex) => {
    setBusy(true)
    ws!.revokeCode(hash).then(load, warn).finally(() => setBusy(false))
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '28px 24px 64px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span aria-hidden="true" style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 56, height: 56, borderRadius: 14, background: '#FDF2FA', color: '#C11574' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS.access} /></svg>
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 260px' }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>Onboarding</h2>
          <span style={{ fontSize: 14, color: C.muted }}>Access on Root · Built-in</span>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: C.text }}>Issues access codes that let someone deploy a chain of their own. Set how long each code lasts and how many deployments it allows.</p>
      {p.issuer ? (
        <>
          <IssueForm busy={busy || !ws} codes={codes} issued={issued} onIssue={issue} onDismiss={() => setIssued(undefined)} />
          <CodeList codes={codes} plain={p.plain} now={Math.floor(Date.now() / 1000)} busy={busy} onRevoke={revoke} />
        </>
      ) : (
        <>
          <section style={{ ...card, gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Issue an access code</h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: C.muted }}>Whoever enters the code can deploy a chain of their own, vouched for by Root.</p>
            </div>
            <p style={{ margin: 0, padding: 14, borderRadius: 10, background: '#FFFAEB', border: '1px solid #FEDF89', fontSize: 14, color: '#93370D' }}>Only people with this contract’s Issuer role can create or see codes.</p>
          </section>
          <CodesHidden />
        </>
      )}
    </div>
  )
}
