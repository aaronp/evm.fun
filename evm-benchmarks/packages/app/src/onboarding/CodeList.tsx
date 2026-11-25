import type { Hex } from 'viem'
import { C, FONT, R } from '../theme'
import { card } from './IssueForm'
import { LOOK, codeRow, type CodeView, type Plain } from './view'

export const ISSUER_ONLY = 'Only people with this contract’s Issuer role can see its codes.'
const head = (sub?: string) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
    <h3 id="onb-codes" style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Codes</h3>
    {sub && <span style={{ fontSize: 13, color: C.muted }}>{sub}</span>}
  </div>
)

/** The prototype's Codes card for non-issuers: the issuer-only message. */
export const CodesHidden = () => (
  <section aria-labelledby="onb-codes" style={{ ...card, gap: 14 }}>
    {head()}
    <p style={{ margin: 0, fontSize: 14, color: C.muted }}>{ISSUER_ONLY}</p>
  </section>
)

/** The prototype's Codes card, newest first; Revoke for active codes (disabled while `busy`). */
export function CodeList(p: { codes: CodeView[]; plain: Plain; now: number; busy: boolean; onRevoke(hash: Hex): void }) {
  return (
    <section aria-labelledby="onb-codes" style={{ ...card, gap: 14 }}>
      {head(`${p.codes.filter((c) => c.status === 'active').length} active`)}
      <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid #EAECF0', borderRadius: R.lg }}>
        {p.codes.map((c, i) => {
          const r = codeRow(c, p.now, p.plain)
          const look = LOOK[c.status]
          return (
            <div key={c.hash} style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '14px 16px', ...(i === 0 ? {} : { borderTop: '1px solid #EAECF0' }), ...(r.canRevoke ? {} : { opacity: 0.8 }) }}>
              <span style={{ minWidth: 128, fontFamily: FONT.mono, fontSize: 18, fontWeight: 500, letterSpacing: '.12em', color: C.ink }}>{r.code}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 999, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', background: look.bg, color: look.fg }}>{r.status}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 220px', minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{r.forText}</span>
                <span style={{ fontSize: 13, color: C.muted }}>{r.usesText} · {r.expiryText}</span>
                {r.grants.map((g) => <span key={g} style={{ fontSize: 12, color: C.muted }}>{g}</span>)}
              </span>
              {r.canRevoke && (
                <button type="button" onClick={() => p.onRevoke(c.hash)} disabled={p.busy} aria-label={`Revoke code ${r.code}`} className="hov"
                  style={{ minHeight: 40, padding: '0 14px', border: `1px solid ${C.field}`, borderRadius: R.md, background: '#FFFFFF', font: 'inherit', fontSize: 13, fontWeight: 600, color: p.busy ? C.faint : C.text, cursor: p.busy ? 'default' : 'pointer' }}>Revoke</button>
              )}
            </div>
          )
        })}
        {p.codes.length === 0 && <p style={{ margin: 0, padding: 16, fontSize: 14, color: C.muted }}>No codes yet.</p>}
      </div>
    </section>
  )
}
