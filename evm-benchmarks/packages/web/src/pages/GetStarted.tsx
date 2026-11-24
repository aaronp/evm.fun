import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../state'
import { accounts } from '../store/accounts'
import { registry } from '../chain/revm'
import { install } from '../walkthrough/install'
import { binding, pageChain } from '../walkthrough/bindings'
import { checkText } from '../components/Ribbon'
import type { Outputs } from '../walkthrough/types'
import { bundled } from '../../walkthroughs'
import { kv } from '../store/kv'
import { useAppBar } from '../state/appBar'
import { validate } from '../walkthrough/validate'
import { clearRun, loadRun } from '../walkthrough/runs'
import { useWizard, type Wizard } from '../walkthrough/wizard'
import type { Walkthrough } from '../walkthrough/types'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input } from '../ui/input'

const EDITS = 'walkthroughEdits'
type Entry = { w: Walkthrough; edited: boolean; /** steps recorded in the saved run */ done: number }

/** Bundled walkthroughs, each replaced by its edited copy when there is one, with progress from its saved run. */
export async function loadAll(): Promise<Entry[]> {
  return Promise.all(bundled.map(async b => {
    try {
      const edit = await kv.get<Walkthrough>(EDITS, b.id)
      const w = edit ?? b, run = await loadRun(w.id)
      return { w, edited: !!edit, done: run ? w.steps.filter(s => run.steps[s.id]).length : 0 }
    } catch { return { w: b, edited: false, done: 0 } } // storage failed: the bundled copy, no progress
  }))
}
/** What Start/Resume and Restart do: both run the entry's copy (the edited one when there is one). */
export const begin = (wz: Pick<Wizard, 'start' | 'restart'> | null, w: Walkthrough) => ({
  start: () => wz?.start(w),
  restart: async () => { await clearRun(w.id); wz?.restart(w) },
})
/** Every tag in the entries, sorted and without repeats. */
export const allTags = (es: Entry[]) => [...new Set(es.flatMap(e => e.w.tags ?? []))].sort((a, b) => a.localeCompare(b))
/** Entries whose title, summary or tag contains the text (any case) and that carry every selected tag. */
export function filterWalkthroughs(es: Entry[], text: string, tags: string[]): Entry[] {
  const q = text.trim().toLowerCase()
  return es.filter(({ w }) => {
    const own = w.tags ?? []
    return tags.every(t => own.includes(t)) && (!q || [w.title, w.summary, ...own].some(x => x.toLowerCase().includes(q)))
  })
}
export const saveEdit = (w: Walkthrough) => kv.set(EDITS, w.id, w)
export const resetEdit = (id: string) => kv.del(EDITS, id)

/** The text as a walkthrough, or its errors as `step · field — message`. The id may not change (it keys the saved run). */
export function check(text: string, id: string): { ok: Walkthrough } | { errors: string[] } {
  let json: unknown
  try { json = JSON.parse(text) } catch (e) { return { errors: [`json — ${(e as Error).message}`] } }
  const r = validate(json)
  if ('errors' in r) return { errors: r.errors.map(e => `${e.step ? `${e.step} · ` : ''}${e.field} — ${e.message}`) }
  return r.ok.id === id ? r : { errors: [`id — must stay "${id}"`] }
}

export function Editor({ id, initial, onSave, onCancel }: { id: string; initial: string; onSave(w: Walkthrough): void; onCancel(): void }) {
  const [text, setText] = useState(initial)
  const r = check(text, id)
  return (
    <div className="space-y-2">
      <textarea aria-label="Walkthrough JSON" value={text} onChange={e => setText(e.target.value)} spellCheck={false} rows={16}
        className="w-full rounded-lg border border-input-line bg-surface p-2 font-mono text-xs text-text focus-visible:outline-2 focus-visible:outline-accent" />
      {'errors' in r && <ul className="space-y-0.5 text-xs text-danger">{r.errors.map(e => <li key={e}>{e}</li>)}</ul>}
      <div className="flex gap-2">
        <Button size="sm" disabled={'errors' in r} onClick={() => 'ok' in r && onSave(r.ok)}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

export function Walkthroughs({ entries, onChange }: { entries: Entry[]; onChange?: () => void }) {
  const wz = useWizard()
  const app = useApp()
  /** per walkthrough: installing (step n), or the outcome of the last install */
  const [inst, setInst] = useState<Record<string, { at?: number; ok?: { chain: string; path: string; failed: string[] }; error?: string }>>({})
  const set = (id: string, v: (typeof inst)[string]) => setInst(m => ({ ...m, [id]: v }))
  /** Install: perform every step from the JSON on a fresh chain (no ribbon), then select that chain. */
  const doInstall = async (w: Walkthrough) => {
    if (wz?.w?.id === w.id) wz.exit() // the ribbon would hold the old run
    set(w.id, { at: 0 })
    app.countInstall(1) // it creates a chain, sends txs and saves a run: New/Open wait for it
    try {
      const { run, failed } = await install(w, { accounts, registry }, i => set(w.id, { at: i }))
      // the last step's page chain (chain A of a cross-chain swap), so "Open →" lands as the walkthrough ends
      const last = w.steps.at(-1)!, id = pageChain(w, last, run)
      const chain = Object.values(run.values).find(v => (v as Outputs['chain']).id === id && 'name' in v) as Outputs['chain'] | undefined
      await app.refresh()
      if (chain) await app.selectChain(chain.id)
      set(w.id, { ok: { chain: chain?.name ?? '', path: binding(w.steps.at(-1)!, w).path(run), failed: failed.map(f => `${f.step}: ${checkText(f.check)} — found ${f.actual}`) } })
    } catch (e) {
      set(w.id, { error: e instanceof Error ? e.message : String(e) })
    } finally { app.countInstall(-1) }
    onChange?.()
  }
  const [open, setOpen] = useState<{ id: string; mode: 'view' | 'edit' }>()
  const [err, setErr] = useState<string>()
  /** runs a storage action; a failure is shown, success refreshes the list */
  const attempt = async (f: () => Promise<unknown>) => {
    setErr(undefined)
    try { await f(); onChange?.() } catch (e) { setErr(`That didn't work: ${e instanceof Error ? e.message : String(e)}`) }
  }
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const flip = (t: string) => setPicked(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])
  const shownEntries = filterWalkthroughs(entries, text, picked)
  const filtering = text.trim() !== '' || picked.length > 0
  const chip = (t: string, small = false) => (
    <button key={t} type="button" aria-pressed={picked.includes(t)} onClick={() => flip(t)}
      className={`rounded-full border ${small ? 'px-1.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'} focus-visible:outline-2 focus-visible:outline-accent ${picked.includes(t) ? 'border-accent bg-selected text-text' : 'border-line text-muted hover:text-text'}`}>{t}</button>
  )
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Input aria-label="Filter walkthroughs" placeholder="Filter by title, summary or tag" value={text} onChange={e => setText(e.target.value)} className="w-full" />
        <div className="flex flex-wrap gap-1.5">{allTags(entries).map(t => chip(t))}</div>
        {filtering && (
          <p className="flex items-center gap-2 text-xs text-muted">Showing {shownEntries.length} of {entries.length}
            <Button size="sm" variant="ghost" onClick={() => { setText(''); setPicked([]) }}>Clear</Button></p>
        )}
      </div>
      {filtering && shownEntries.length === 0 && <p className="text-sm text-text-2">No walkthroughs match.</p>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {shownEntries.map(({ w, edited, done }) => {
        const shown = open?.id === w.id ? open.mode : undefined
        const json = JSON.stringify(w, null, 2)
        const toggle = (mode: 'view' | 'edit') => setOpen(shown === mode ? undefined : { id: w.id, mode })
        return (
          <Card key={w.id} className="space-y-3">
            <div>
              <h2 className="font-display text-base font-semibold">{w.title}{edited && <span className="ml-2 rounded-md border border-line-strong px-1.5 py-0.5 align-middle text-[11px] font-medium text-muted">edited</span>}</h2>
              <p className="text-sm text-text-2">{w.summary}</p>
              <p className="mt-1 text-xs text-muted">{w.steps.length} steps{done > 0 && ` · ${done} of ${w.steps.length} done`}</p>
              {!!w.tags?.length && <div className="mt-1 flex flex-wrap gap-1">{w.tags.map(t => chip(t, true))}</div>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={begin(wz, w).start}>{done > 0 ? 'Resume' : 'Start'}</Button>
              <Button size="sm" variant="ghost" disabled={inst[w.id]?.at !== undefined} title="Run every step from the JSON now, on a new chain, without the walkthrough"
                onClick={() => void doInstall(w)}>{inst[w.id]?.at !== undefined ? `Installing… ${inst[w.id]!.at! + 1} of ${w.steps.length}` : 'Install'}</Button>
              {done > 0 && <Button size="sm" variant="ghost" onClick={() => attempt(begin(wz, w).restart)}>Restart</Button>}
              <Button size="sm" variant="ghost" onClick={() => toggle('view')}>View JSON</Button>
              <Button size="sm" variant="ghost" onClick={() => toggle('edit')}>Edit JSON</Button>
              {edited && <Button size="sm" variant="ghost" onClick={() => attempt(async () => { await resetEdit(w.id); setOpen(undefined) })}>Reset to original</Button>}
            </div>
            {inst[w.id]?.ok && (
              <div className="space-y-1 text-sm">
                <p className="text-success-text">Installed on {inst[w.id]!.ok!.chain}. <Link className="text-accent hover:underline" to={inst[w.id]!.ok!.path}>Open →</Link></p>
                {inst[w.id]!.ok!.failed.map((f, i) => <p key={i} className="text-warn-text">✗ {f}</p>)}
              </div>
            )}
            {inst[w.id]?.error && <p role="alert" className="text-sm text-danger">Install stopped at {inst[w.id]!.error} The steps before it are saved: Resume continues from there.</p>}
            {shown === 'view' && <pre className="max-h-96 overflow-auto rounded-lg border border-line bg-bg p-2 font-mono text-xs">{json}</pre>}
            {shown === 'edit' && <Editor id={w.id} initial={json} onCancel={() => setOpen(undefined)} onSave={nw => attempt(async () => { await saveEdit(nw); setOpen(undefined) })} />}
          </Card>
        )
      })}
    </div>
  )
}

export function GetStarted() {
  const [entries, setEntries] = useState<Entry[]>()
  const [n, setN] = useState(0)
  useAppBar({ title: 'Get started' })
  useEffect(() => { loadAll().then(setEntries, () => setEntries(bundled.map(w => ({ w, edited: false, done: 0 })))) }, [n])
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-2">Guided walkthroughs that drive the real pages, one step at a time.</p>
      {entries ? <Walkthroughs entries={entries} onChange={() => setN(x => x + 1)} /> : null}
    </div>
  )
}
