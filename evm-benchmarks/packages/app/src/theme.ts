// The prototype's tokens (design/prototype/Prototype.dc.html).
import type { CSSProperties } from 'react'

export const C = {
  ink: '#101828', text: '#344054', muted: '#475467', faint: '#98A2B3', placeholder: '#667085',
  bg: '#F7F8FA', surface: '#FFFFFF', border: '#E4E7EC', field: '#D0D5DD', divider: '#F2F4F7', hover: '#F2F4F7',
  accent: '#3B5BDB', accentHover: '#2F4AC0', accentSoft: '#EEF2FF', disabledBg: '#EAECF0',
  errorBg: '#FEF3F2', errorBorder: '#FECDCA', error: '#B42318', warn: '#B54708',
  dotLocal: '#98A2B3', dotDeployed: '#17B26A', dotShared: '#2E90FA',
} as const

export const R = { sm: 8, md: 10, lg: 12, modal: 18, pill: 999 } as const

export const FONT = { sans: 'Inter, system-ui, sans-serif', mono: "'JetBrains Mono', monospace" } as const

export const SHADOW = {
  menu: '0 12px 32px rgba(16,24,40,.16)',
  modal: '0 24px 48px rgba(16,24,40,.24)',
} as const

export const ICONS = {
  chains: 'M3 3h7v7H3zM14 14h7v7h-7zM10 6.5h4a3 3 0 0 1 3 3V14',
  // the prototype's Access contract type (Onboarding is one)
  access: 'M8 19a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM10.8 12.2 20 3M17 6l3 3M14 9l2 2',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M18 6 6 18M6 6l12 12',
  person: 'M20 21v-1a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v1M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
} as const

/** The prototype's S helpers. */
export const S = {
  primary: (enabled: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, padding: '0 18px', border: 0,
    borderRadius: R.md, font: 'inherit', fontSize: 14, fontWeight: 600,
    ...(enabled ? { background: C.accent, color: '#FFFFFF', cursor: 'pointer' } : { background: C.disabledBg, color: C.muted }),
  }),
  secondary: (enabled = true): CSSProperties => ({
    minHeight: 44, padding: '0 18px', border: `1px solid ${C.field}`, borderRadius: R.md, background: '#FFFFFF', font: 'inherit',
    fontSize: 14, fontWeight: 600, ...(enabled ? { color: C.text, cursor: 'pointer' } : { color: C.faint }),
  }),
  input: { minHeight: 44, padding: '0 12px', border: `1px solid ${C.field}`, borderRadius: R.md, font: 'inherit', fontSize: 14, color: C.ink } as CSSProperties,
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 500, color: C.text } as CSSProperties,
  menu: {
    position: 'absolute', top: 50, right: 0, width: 280, padding: 6, background: '#FFFFFF', border: `1px solid ${C.border}`,
    borderRadius: R.lg, boxShadow: SHADOW.menu, display: 'flex', flexDirection: 'column', gap: 2,
  } as CSSProperties,
  menuItem: {
    display: 'flex', alignItems: 'center', minHeight: 44, padding: '0 10px', border: 0, borderRadius: R.sm, background: 'transparent',
    font: 'inherit', fontSize: 14, fontWeight: 500, color: C.text, cursor: 'pointer', textAlign: 'left',
  } as CSSProperties,
  avatar: {
    flex: 'none', width: 40, height: 40, borderRadius: R.pill, border: 0, background: C.ink, color: '#FFFFFF',
    display: 'grid', placeItems: 'center', font: 'inherit', fontSize: 13, fontWeight: 600,
  } as CSSProperties,
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
