import { useEffect, useState, type ReactNode } from 'react'
import { AppBar } from './shell/AppBar'
import { Footer } from './shell/Footer'
import { Nav, type Section } from './shell/Nav'
import type { ProfileProps } from './shell/ProfileMenu'
import { ImportKeyDialog } from './keys/ImportKeyDialog'
import { UnlockDialog } from './keys/UnlockDialog'
import { useApp, type Notice } from './state'
import { C, FONT } from './theme'

/** The layout, all state injected: app bar, notice, nav + main, footer. */
export function Shell(p: {
  navOpen: boolean; onToggleNav(): void; section: Section; onSection(s: Section): void
  issuer: boolean; chainCount: number; profile: ProfileProps; workerUrl: string
  notice?: Notice; onDismiss?(): void; children?: ReactNode
}) {
  return (
    <div style={{ fontFamily: FONT.sans, color: C.ink, background: C.bg, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar navOpen={p.navOpen} onToggleNav={p.onToggleNav} section={p.section} profile={p.profile} />
      {p.notice && (
        <div role="status" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px 6px 20px', fontSize: 14, fontWeight: 500, ...(p.notice.kind === 'warn' ? { background: '#FFFAEB', color: '#93370D', borderBottom: '1px solid #FEDF89' } : { background: '#ECFDF3', color: '#054F31', borderBottom: '1px solid #ABEFC6' }) }}>
          <span style={{ flex: 1 }}>{p.notice.text}</span>
          <button type="button" onClick={p.onDismiss} className="hov" style={{ minHeight: 32, padding: '0 12px', border: 0, borderRadius: 8, background: 'transparent', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'inherit', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}
      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <Nav open={p.navOpen} section={p.section} issuer={p.issuer} chainCount={p.chainCount} onPick={p.onSection} />
        <main style={{ flex: '1 1 480px', minWidth: 0, overflowY: 'auto', background: C.bg }}>{p.children}</main>
      </div>
      <Footer me={p.profile.me} workerUrl={p.workerUrl} />
    </div>
  )
}

export function App() {
  const s = useApp()
  const [navOpen, setNavOpen] = useState(true)
  const [section, setSection] = useState<Section>('chains')
  const [profileOpen, setProfileOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [, rerender] = useState(0)
  useEffect(() => s.workspace?.onChange(() => rerender((n) => n + 1)), [s.workspace])
  useEffect(() => { if (!s.issuer && section === 'onboarding') setSection('chains') }, [s.issuer])

  return (
    <>
      <Shell
        navOpen={navOpen} onToggleNav={() => setNavOpen(!navOpen)} section={section} onSection={setSection}
        issuer={s.issuer} chainCount={s.workspace?.chains().length ?? 0} workerUrl={s.workerUrl}
        notice={s.notice} onDismiss={() => s.setNotice(undefined)}
        profile={{
          open: profileOpen, me: s.me, keys: s.held, onToggle: () => setProfileOpen(!profileOpen),
          onChoose: s.choose, onGenerate: () => void s.generate(), onImport: () => setImporting(true), onLock: s.lock,
        }}
      >
        {/* Chains (Task 7) and Onboarding (Task 8) fill this */}
      </Shell>
      {importing && <ImportKeyDialog onClose={() => setImporting(false)} onImport={async (k) => { await s.importKey(k); setImporting(false) }} />}
      {s.prompt && <UnlockDialog key={s.prompt.seq} {...s.prompt} onSubmit={s.submitPassphrase} onCancel={s.cancelPassphrase} />}
    </>
  )
}
