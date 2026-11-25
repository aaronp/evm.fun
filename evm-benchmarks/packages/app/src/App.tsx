import { useEffect, useState, type ReactNode } from 'react'
import type { CodeSource } from '@evmb/workspace'
import { AppBar } from './shell/AppBar'
import { Footer } from './shell/Footer'
import { Nav, type Section } from './shell/Nav'
import type { ProfileProps } from './shell/ProfileMenu'
import { ImportKeyDialog } from './keys/ImportKeyDialog'
import { UnlockDialog } from './keys/UnlockDialog'
import { ChainDetail } from './chains/ChainDetail'
import { ChainList, ChainPicker } from './chains/ChainList'
import { DeployModal } from './chains/DeployModal'
import { NewChainModal } from './chains/NewChainModal'
import { STATUS, afterCreate, checkChainName, codeFromSearch, linkDialog, refusalCopy } from './chains/view'
import { useApp, type Notice } from './state'
import { C, FONT } from './theme'

const text = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The layout, all state injected: app bar (with `heading`), notice, nav + `aside` + main, footer (with `chain`). */
export function Shell(p: {
  navOpen: boolean; onToggleNav(): void; section: Section; onSection(s: Section): void
  issuer: boolean; chainCount: number; profile: ProfileProps; workerUrl: string
  notice?: Notice; onDismiss?(): void; children?: ReactNode
  heading?: ReactNode; aside?: ReactNode; chain?: { label: string; dot: string }
}) {
  return (
    <div style={{ fontFamily: FONT.sans, color: C.ink, background: C.bg, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar navOpen={p.navOpen} onToggleNav={p.onToggleNav} section={p.section} profile={p.profile} heading={p.heading} />
      {p.notice && (
        <div role="status" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px 6px 20px', fontSize: 14, fontWeight: 500, ...(p.notice.kind === 'warn' ? { background: '#FFFAEB', color: '#93370D', borderBottom: '1px solid #FEDF89' } : { background: '#ECFDF3', color: '#054F31', borderBottom: '1px solid #ABEFC6' }) }}>
          <span style={{ flex: 1 }}>{p.notice.text}</span>
          <button type="button" onClick={p.onDismiss} className="hov" style={{ minHeight: 32, padding: '0 12px', border: 0, borderRadius: 8, background: 'transparent', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'inherit', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}
      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <Nav open={p.navOpen} section={p.section} issuer={p.issuer} chainCount={p.chainCount} onPick={p.onSection} />
        {p.aside}
        <main style={{ flex: '1 1 480px', minWidth: 0, overflowY: 'auto', background: C.bg }}>{p.children}</main>
      </div>
      <Footer me={p.profile.me} chain={p.chain?.label} chainDot={p.chain?.dot} workerUrl={p.workerUrl} />
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
  const [selected, setSelected] = useState<string>()
  const [retrying, setRetrying] = useState(false)
  // a ?code= link: read once, then dropped from the URL; it opens New chain, and Deploy (filled in) after the create
  const [linkCode, setLinkCode] = useState(() => codeFromSearch(location.search))
  const [dialog, setDialog] = useState(() => linkDialog(linkCode))
  useEffect(() => {
    if (!linkCode) return
    const u = new URL(location.href)
    u.searchParams.delete('code')
    history.replaceState(history.state, '', u)
  }, [])
  useEffect(() => s.workspace?.onChange(() => rerender((n) => n + 1)), [s.workspace])
  useEffect(() => { if (!s.issuer && section === 'onboarding') setSection('chains') }, [s.issuer])

  const ws = s.workspace
  const chains = (ws?.chains() ?? []).sort((a, b) => a.createdAt - b.createdAt)
  const chain = section === 'chains' ? chains.find((c) => c.id === selected) : undefined
  const deploying = dialog?.kind === 'deploy' ? chains.find((c) => c.id === dialog.id) : undefined
  const openNew = () => { setSection('chains'); setDialog({ kind: 'new' }) }
  const pick = (id: string) => { setSection('chains'); setSelected(id) }

  const create = async (name: string, desc: string) => {
    const c = await ws!.createChain(name, desc)
    setSelected(c.id)
    s.setNotice({ text: `Created “${c.name}”. It’s local until you deploy it.`, kind: 'ok' })
    setDialog(afterCreate(linkCode, c.id))
    setLinkCode(undefined)
  }
  // closes this chain's Deploy only, not a dialog opened since
  const closeDeploy = (id: string) => setDialog((d) => (d?.kind === 'deploy' && d.id === id ? undefined : d))
  const deploy = (id: string) => async (src: CodeSource) => {
    try {
      const c = await ws!.deploy(id, src)
      closeDeploy(id)
      s.setNotice({ text: `${c.name} is deployed. Only you have access so far.`, kind: 'ok' })
    } catch (e) {
      // accepted but not created: Deployment shows it with Retry
      if (ws!.chains().find((c) => c.id === id)?.status === 'unfinished') return closeDeploy(id)
      throw e
    }
  }
  const save = async (id: string, name: string, desc: string) => {
    const bad = checkChainName(chains, name, id)
    if (bad) throw new Error(bad)
    await ws!.renameChain(id, name.trim(), desc.trim())
    s.setNotice({ text: 'Saved.', kind: 'ok' })
  }
  const retry = (id: string) => {
    setRetrying(true)
    ws!.retryDeploy(id).then(
      (c) => s.setNotice({ text: `${c.name} is deployed. Only you have access so far.`, kind: 'ok' }),
      (e) => { if (text(e) !== 'cancelled') s.setNotice({ text: refusalCopy(text(e)), kind: 'warn' }) },
    ).finally(() => setRetrying(false))
  }

  return (
    <>
      <Shell
        navOpen={navOpen} onToggleNav={() => setNavOpen(!navOpen)} section={section} onSection={setSection}
        issuer={s.issuer} chainCount={s.workspace?.chains().length ?? 0} workerUrl={s.workerUrl}
        notice={s.notice} onDismiss={() => s.setNotice(undefined)}
        heading={section === 'chains' ? <ChainPicker chains={chains} selected={chain} onPick={pick} onNew={openNew} onClear={() => setSelected(undefined)} /> : undefined}
        aside={section === 'chains' ? <ChainList chains={chains} selected={chain?.id} onPick={pick} onNew={openNew} /> : undefined}
        chain={chain && { label: `${chain.name} · ${STATUS[chain.status].label}`, dot: STATUS[chain.status].dot }}
        profile={{
          open: profileOpen, me: s.me, keys: s.held, onToggle: () => setProfileOpen(!profileOpen),
          onChoose: s.choose, onGenerate: () => void s.generate(), onImport: () => setImporting(true), onLock: s.lock,
        }}
      >
        {section === 'chains' && (chain
          ? <ChainDetail key={chain.id} chain={chain} busy={retrying} onSave={(n, d) => save(chain.id, n, d)} onDeploy={() => setDialog({ kind: 'deploy', id: chain.id })} onRetry={() => retry(chain.id)} follow={(id) => ws!.follow(id)} />
          : <Empty title="No chain selected" text="Create a chain, or pick one from the list." />)}
        {/* Onboarding (Task 8) fills the rest */}
      </Shell>
      {dialog?.kind === 'new' && <NewChainModal chains={chains} onCreate={ws && create} onClose={() => { setDialog(undefined); setLinkCode(undefined) }} />}
      {deploying && <DeployModal key={deploying.id} chain={deploying} issuer={s.issuer} initialCode={dialog?.kind === 'deploy' ? dialog.code : undefined} onDeploy={deploy(deploying.id)} onClose={() => setDialog(undefined)} />}
      {importing && <ImportKeyDialog onClose={() => setImporting(false)} onImport={async (k) => { await s.importKey(k); setImporting(false) }} />}
      {s.prompt && <UnlockDialog key={s.prompt.seq} {...s.prompt} onSubmit={s.submitPassphrase} onCancel={s.cancelPassphrase} />}
    </>
  )
}

/** The prototype's empty pane. */
function Empty(p: { title: string; text: string }) {
  return (
    <div style={{ height: '100%', minHeight: 360, display: 'grid', placeItems: 'center', padding: 32 }}>
      <div style={{ maxWidth: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{p.title}</span>
        <span style={{ fontSize: 14, lineHeight: 1.5, color: C.muted }}>{p.text}</span>
      </div>
    </div>
  )
}
