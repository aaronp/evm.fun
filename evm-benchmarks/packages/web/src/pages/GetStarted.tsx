import { useEffect, useState } from 'react'
import { bundled } from '../../walkthroughs'
import { kv } from '../store/kv'
import { useAppBar } from '../state/appBar'
import { validate } from '../walkthrough/validate'
import { clearRun, loadRun } from '../walkthrough/runs'
import { useWizard } from '../walkthrough/wizard'
import type { Walkthrough } from '../walkthrough/types'
import { Button } from '../ui/button'
import { Card } from '../ui/card'

const EDITS = 'walkthroughEdits'
type Entry = { w: Walkthrough; edited: boolean; /** steps recorded in the saved run */ done: number }

/** Bundled walkthroughs, each replaced by its edited copy when there is one, with progress from its saved run. */
export async function loadAll(): Promise<Entry[]> {
  return Promise.all(bundled.map(async b => {
    const edit = await kv.get<Walkthrough>(EDITS, b.id)
    const w = edit ?? b, run = await loadRun(w.id)
    return { w, edited: !!edit, done: run ? w.steps.filter(s => run.steps[s.id]).length : 0 }
  }))
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
  const [open, setOpen] = useState<{ id: string; mode: 'view' | 'edit' }>()
  return (
    <div className="space-y-4">
      {entries.map(({ w, edited, done }) => {
        const shown = open?.id === w.id ? open.mode : undefined
        const json = JSON.stringify(w, null, 2)
        const toggle = (mode: 'view' | 'edit') => setOpen(shown === mode ? undefined : { id: w.id, mode })
        return (
          <Card key={w.id} className="space-y-3">
            <div>
              <h2 className="font-display text-base font-semibold">{w.title}{edited && <span className="ml-2 rounded-md border border-line-strong px-1.5 py-0.5 align-middle text-[11px] font-medium text-muted">edited</span>}</h2>
              <p className="text-sm text-text-2">{w.summary}</p>
              <p className="mt-1 text-xs text-muted">{w.steps.length} steps{done > 0 && ` · ${done} of ${w.steps.length} done`}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => wz?.start(w)}>{done > 0 ? 'Resume' : 'Start'}</Button>
              {done > 0 && <Button size="sm" variant="ghost" onClick={async () => { await clearRun(w.id); wz?.restart(w); onChange?.() }}>Restart</Button>}
              <Button size="sm" variant="ghost" onClick={() => toggle('view')}>View JSON</Button>
              <Button size="sm" variant="ghost" onClick={() => toggle('edit')}>Edit JSON</Button>
              {edited && <Button size="sm" variant="ghost" onClick={async () => { await resetEdit(w.id); setOpen(undefined); onChange?.() }}>Reset to original</Button>}
            </div>
            {shown === 'view' && <pre className="max-h-96 overflow-auto rounded-lg border border-line bg-bg p-2 font-mono text-xs">{json}</pre>}
            {shown === 'edit' && <Editor id={w.id} initial={json} onCancel={() => setOpen(undefined)} onSave={async nw => { await saveEdit(nw); setOpen(undefined); onChange?.() }} />}
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
  useEffect(() => { loadAll().then(setEntries) }, [n])
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-2">Guided walkthroughs that drive the real pages, one step at a time.</p>
      {entries ? <Walkthroughs entries={entries} onChange={() => setN(x => x + 1)} /> : null}
    </div>
  )
}
