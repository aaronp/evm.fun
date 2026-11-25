import { C, ICONS, R } from '../theme'

export type Section = 'chains' | 'onboarding'

/** The prototype's NAV: Chains, and Onboarding for issuers. */
export function Nav(p: { open: boolean; section: Section; issuer: boolean; chainCount: number; onPick(s: Section): void }) {
  const items: { key: Section; label: string; icon: string; count?: number }[] = [
    { key: 'chains', label: 'Chains', icon: ICONS.chains, count: p.chainCount },
    ...(p.issuer ? [{ key: 'onboarding' as const, label: 'Onboarding', icon: ICONS.access }] : []),
  ]
  return (
    <nav aria-label="Primary" style={{ flex: 'none', width: p.open ? 240 : 72, display: 'flex', flexDirection: 'column', gap: 4, padding: 12, background: '#FFFFFF', borderRight: `1px solid ${C.border}`, overflowY: 'auto' }}>
      {items.map((n) => {
        const on = n.key === p.section
        return (
          <button key={n.key} type="button" onClick={() => p.onPick(n.key)} aria-current={on ? 'page' : undefined} aria-label={n.label} title={n.label}
            style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 48, padding: '8px 12px', border: 0, borderRadius: R.md, font: 'inherit', fontWeight: 600, textAlign: 'left', cursor: 'pointer', background: on ? C.accent : 'transparent', color: on ? '#FFFFFF' : C.text }}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d={n.icon} /></svg>
            {p.open && (
              <>
                <span style={{ flex: 1, minWidth: 0, fontSize: 15 }}>{n.label}</span>
                {n.count !== undefined && <span style={{ fontSize: 13, fontWeight: 500, color: on ? '#FFFFFF' : C.muted }}>{n.count}</span>}
              </>
            )}
          </button>
        )
      })}
    </nav>
  )
}
