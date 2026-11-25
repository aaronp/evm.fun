import { C, FONT, ICONS } from '../theme'

/** The prototype's FOOTER: my address, the selected chain, the worker it talks to. */
export function Footer(p: { me?: string; chain?: string; chainDot?: string; workerUrl: string }) {
  const bar = <span aria-hidden="true" style={{ color: C.field }}>|</span>
  return (
    <footer style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', minHeight: 40, padding: '6px 16px', background: '#FFFFFF', borderTop: `1px solid ${C.border}`, fontSize: 13, color: C.muted }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS.person} /></svg>
        <span style={{ fontFamily: FONT.mono, color: C.text }}>{p.me ?? 'No keys yet'}</span>
      </span>
      <div style={{ flex: '1 1 16px' }} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: p.chainDot ?? C.dotLocal }} />
        <span style={{ color: C.text }}>{p.chain ?? 'No chain selected'}</span>
      </span>
      {bar}
      <span>Worker {p.workerUrl}</span>
    </footer>
  )
}
