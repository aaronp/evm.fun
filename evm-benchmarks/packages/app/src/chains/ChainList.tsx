import { useState } from 'react'
import type { ChainRecord } from '@evmb/workspace'
import { C, ICONS, R, SHADOW } from '../theme'
import { MY_ACCESS, STATUS, badge, glyph, initials, plural } from './view'

const PLUS = 'M12 5v14M5 12h14'
const plusIcon = (size: number) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ flex: 'none' }}><path d={PLUS} /></svg>
)
const chevron = (size: number, stroke = 'currentColor') => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
)

/** The prototype's SECOND TIER for Chains: New chain, then "Your chains". */
export function ChainList(p: { chains: ChainRecord[]; selected?: string; onPick(id: string): void; onNew(): void }) {
  return (
    <aside aria-label="Chains list" style={{ flex: '0 0 300px', display: 'flex', flexDirection: 'column', gap: 2, padding: 12, background: '#F5F8FF', borderRight: `1px solid ${C.border}`, overflowY: 'auto' }}>
      <button type="button" onClick={p.onNew} className="hov" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: '0 12px', border: 0, borderRadius: R.md, background: 'transparent', font: 'inherit', fontSize: 15, color: C.text, cursor: 'pointer' }}>
        {plusIcon(18)}
        New chain
      </button>
      <div style={{ height: 1, background: C.border, margin: '8px 4px' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h2 style={{ margin: '12px 12px 4px', fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>Your chains</h2>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {p.chains.map((c) => {
            const on = c.id === p.selected
            return (
              <li key={c.id}>
                <button type="button" onClick={() => p.onPick(c.id)} aria-current={on ? 'true' : 'false'}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 48, padding: '7px 10px', borderRadius: R.md, font: 'inherit', color: C.ink, cursor: 'pointer', ...(on ? { background: '#FFFFFF', border: '1px solid #C7D7FE', boxShadow: '0 1px 2px rgba(16,24,40,.06)' } : { background: 'transparent', border: '1px solid transparent' }) }}>
                  <span aria-hidden="true" style={glyph(c.id, 30)}>{initials(c.name)}</span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, textAlign: 'left' }}>
                    <span style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    <span style={{ fontSize: 12, color: C.muted }}>{STATUS[c.status].label} · {MY_ACCESS}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {p.chains.length === 0 && <p style={{ margin: '0 12px', fontSize: 13, color: C.muted }}>No chains yet</p>}
      </div>
    </aside>
  )
}

/** The prototype's heading slot for Chains: the selected chain (or the section with "Select chain"), and the switcher. */
export function ChainPicker(p: { chains: ChainRecord[]; selected?: ChainRecord; onPick(id: string): void; onNew(): void; onClear(): void }) {
  const [open, setOpen] = useState(false)
  const run = (fn: () => void) => () => { setOpen(false); fn() }
  const c = p.selected
  const toggle = { onClick: () => setOpen(!open), 'aria-haspopup': 'listbox' as const, 'aria-expanded': open, className: 'hov' }
  const deployed = p.chains.filter((x) => x.status === 'deployed').length
  const menuItem = { display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '0 10px', border: 0, borderRadius: R.sm, background: 'transparent', font: 'inherit', fontSize: 14, cursor: 'pointer' } as const
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      {c ? (
        <button type="button" {...toggle} aria-label={`Current chain: ${c.name}. Switch chain`}
          style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '4px 10px 4px 4px', border: 0, borderRadius: R.lg, background: 'transparent', font: 'inherit', color: C.ink, cursor: 'pointer', textAlign: 'left' }}>
          <span aria-hidden="true" style={glyph(c.id, 40)}>{initials(c.name)}</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, lineHeight: 1.25 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 17, fontWeight: 600, whiteSpace: 'nowrap' }}>{c.name}</span>
              <span style={badge(c.status)}>{STATUS[c.status].label}</span>
            </span>
            <span style={{ fontSize: 13, color: C.muted, whiteSpace: 'nowrap' }}>You: {MY_ACCESS}</span>
          </span>
          {chevron(16, C.muted)}
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: 4 }}>
          <span aria-hidden="true" style={{ flex: 'none', width: 40, height: 40, borderRadius: R.md, background: C.accent, color: '#FFFFFF', display: 'grid', placeItems: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS.chains} /></svg>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.25 }}>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Chains</span>
            <span style={{ fontSize: 13, color: C.muted, whiteSpace: 'nowrap' }}>{plural(p.chains.length, 'chain', 'chains')} · {deployed} deployed</span>
          </span>
          <button type="button" {...toggle}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, padding: '0 10px', border: `1px dashed ${C.field}`, borderRadius: R.sm, background: 'transparent', font: 'inherit', fontSize: 13, fontWeight: 600, color: C.text, cursor: 'pointer' }}>
            Select chain
            {chevron(14)}
          </button>
        </div>
      )}
      {open && (
        <div role="listbox" aria-label="Switch chain" style={{ position: 'absolute', top: 56, left: 0, width: 320, maxHeight: 440, overflowY: 'auto', padding: 6, background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: R.lg, boxShadow: SHADOW.menu, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {p.chains.map((x) => {
            const on = x.id === c?.id
            return (
              <button key={x.id} type="button" role="option" aria-selected={on} onClick={run(() => p.onPick(x.id))}
                style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '6px 10px', border: 0, borderRadius: R.sm, font: 'inherit', color: C.ink, cursor: 'pointer', background: on ? C.accentSoft : 'transparent' }}>
                <span aria-hidden="true" style={glyph(x.id, 28)}>{initials(x.name)}</span>
                <span style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: 600 }}>{x.name}</span>
                <span style={badge(x.status)}>{STATUS[x.status].label}</span>
              </button>
            )
          })}
          <div style={{ height: 1, background: C.divider, margin: '4px 0' }} />
          <button type="button" onClick={run(p.onNew)} className="hov" style={{ ...menuItem, fontWeight: 600, color: C.accent }}>
            {plusIcon(18)}
            New chain
          </button>
          {c && (
            <button type="button" onClick={run(p.onClear)} className="hov" style={{ ...menuItem, fontWeight: 500, color: C.text }}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={ICONS.close} /></svg>
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  )
}
