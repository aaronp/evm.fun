import { useEffect, useState, type ReactNode } from 'react'
import type { ChainRecord } from '@evmb/workspace'
import { C, FONT, R, S } from '../theme'
import { MY_ACCESS, STATUS, ago, badge, glyph, initials } from './view'

const card = { display: 'flex', flexDirection: 'column', gap: 16, padding: 24, background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 14 } as const
const h3 = (t: string) => <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{t}</h3>
const state = (o: { title: string; text: string; tone: { bg: string; border: string; title?: string }; action?: ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: 16, borderRadius: R.lg, background: o.tone.bg, border: `1px solid ${o.tone.border}` }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 260px' }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: o.tone.title }}>{o.title}</span>
      <span style={{ fontSize: 13, lineHeight: 1.5, color: o.tone.title ? C.text : C.muted }}>{o.text}</span>
    </div>
    {o.action}
  </div>
)

/**
 * The prototype's chain detail, General and Deployment only. A deployed chain is followed (kept in sync) while this
 * is open. `onSave` rejects with the message to show (e.g. a taken name).
 */
export function ChainDetail(p: {
  chain: ChainRecord; busy?: boolean; onSave(name: string, desc: string): Promise<void>; onDeploy(): void; onRetry(): void
  follow?(id: string): () => void
}) {
  const c = p.chain
  const deployed = c.status === 'deployed'
  useEffect(() => (deployed ? p.follow?.(c.id) : undefined), [c.id, deployed])
  const [name, setName] = useState(c.name)
  const [desc, setDesc] = useState(c.desc)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const unchanged = name === c.name && desc === c.desc
  const save = () => {
    setSaving(true)
    p.onSave(name, desc).then(() => { setName(name.trim()); setDesc(desc.trim()); setError('') }, (e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false))
  }
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px 24px 64px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span aria-hidden="true" style={glyph(c.id, 56)}>{initials(c.name)}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>{c.name}</h2>
            <span style={badge(c.status)}>{STATUS[c.status].label}</span>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: C.muted }}>
            <span style={{ fontFamily: FONT.mono }}>{c.id}</span>
            <span>You: {MY_ACCESS}</span>
          </div>
        </div>
      </section>

      <section style={card}>
        {h3('General')}
        <label style={S.label}>Name
          <input type="text" value={name} onChange={(e) => { setName(e.target.value); setError('') }} style={S.input} />
        </label>
        <label style={S.label}>Description
          <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} style={S.input} />
        </label>
        {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: C.error }}>{error}</p>}
        <div><button type="button" onClick={save} disabled={unchanged || saving} style={S.primary(!unchanged && !saving)}>Save changes</button></div>
      </section>

      <section style={card}>
        {h3('Deployment')}
        {c.status === 'local' && state({
          title: 'Local only', text: 'This chain lives in this browser. Deploy it to the cloud to give people and devices access.',
          tone: { bg: '#F9FAFB', border: '#EAECF0' },
          action: <button type="button" onClick={p.onDeploy} style={S.primary(true)}>Deploy chain…</button>,
        })}
        {c.status === 'unfinished' && state({
          title: 'Unfinished', text: `Your code was accepted but the chain wasn't created: ${c.error ?? ''}`,
          tone: { bg: '#FFFAEB', border: '#FEDF89', title: '#93370D' },
          action: <button type="button" onClick={p.onRetry} disabled={p.busy} style={S.primary(!p.busy)}>Retry</button>,
        })}
        {deployed && state({
          title: 'Deployed and syncing', text: `Deployed ${c.deployedAt === undefined ? '' : ago(Date.now(), c.deployedAt)}`,
          tone: { bg: '#F6FEF9', border: '#ABEFC6', title: '#054F31' },
        })}
      </section>
    </div>
  )
}
