import { C, ICONS, R } from '../theme'
import type { Section } from './Nav'
import { ProfileMenu, type ProfileProps } from './ProfileMenu'

const HEADINGS: Record<Section, { title: string; icon: string }> = {
  chains: { title: 'Chains', icon: ICONS.chains },
  onboarding: { title: 'Onboarding', icon: ICONS.access },
}

/** The prototype's APP BAR: nav toggle + brand, the section heading, the profile menu. */
export function AppBar(p: { navOpen: boolean; onToggleNav(): void; section: Section; profile: ProfileProps }) {
  const h = HEADINGS[p.section]
  return (
    <header style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minHeight: 64, padding: '8px 16px 8px 8px', background: '#FFFFFF', borderBottom: `1px solid ${C.border}`, position: 'relative', zIndex: 20 }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, width: p.navOpen ? 232 : 64 }}>
        <button type="button" onClick={p.onToggleNav} aria-label={p.navOpen ? 'Collapse navigation' : 'Expand navigation'} aria-expanded={p.navOpen} className="hov"
          style={{ flex: 'none', width: 44, height: 44, border: 0, borderRadius: R.md, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.text} strokeWidth="2" strokeLinecap="round"><path d={ICONS.menu} /></svg>
        </button>
        {p.navOpen && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span aria-hidden="true" style={{ flex: 'none', width: 30, height: 30, borderRadius: R.sm, background: C.ink, display: 'grid', placeItems: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><path d="M10 6.5h4a3 3 0 0 1 3 3V14" /></svg>
            </span>
            <span style={{ fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap' }}>Chain workspace</span>
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: 4 }}>
        <span aria-hidden="true" style={{ flex: 'none', width: 40, height: 40, borderRadius: R.md, background: C.accent, color: '#FFFFFF', display: 'grid', placeItems: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={h.icon} /></svg>
        </span>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{h.title}</span>
      </div>
      <div style={{ flex: '1 1 8px' }} />
      <ProfileMenu {...p.profile} />
    </header>
  )
}
