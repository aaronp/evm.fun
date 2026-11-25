import type { Address } from 'viem'
import { C, FONT, S, short } from '../theme'

export type ProfileProps = {
  open: boolean; me?: Address; keys: Address[]
  onToggle(): void; onChoose(a: Address): void; onGenerate(): void; onImport(): void; onLock(): void
}

/** The prototype's profile menu: "You" + my address, the other held keys to switch to, Generate key, Import key…, Lock. */
export function ProfileMenu(p: ProfileProps) {
  const item = (label: string, run: () => void, mono = false) => (
    <button key={label} type="button" role="menuitem" className="hov" onClick={() => { p.onToggle(); run() }}
      style={mono ? { ...S.menuItem, fontFamily: FONT.mono, fontSize: 13 } : S.menuItem}>{label}</button>
  )
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={p.onToggle} aria-haspopup="menu" aria-expanded={p.open} aria-label="Profile menu" style={{ ...S.avatar, cursor: 'pointer' }}>You</button>
      {p.open && (
        <div role="menu" aria-label="Profile" style={S.menu}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10 }}>
            <span aria-hidden="true" style={S.avatar}>You</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>You</span>
              <span title={p.me} style={{ fontFamily: FONT.mono, fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.me ? short(p.me) : 'No keys yet'}</span>
            </span>
          </div>
          <div style={{ height: 1, background: C.divider, margin: '2px 0' }} />
          {p.keys.filter((a) => a !== p.me).map((a) => item(`Use ${short(a)}`, () => p.onChoose(a), true))}
          {item('Generate key', p.onGenerate)}
          {item('Import key…', p.onImport)}
          {item('Lock', p.onLock)}
        </div>
      )}
    </div>
  )
}
