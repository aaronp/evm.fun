import { useEffect, useRef, useState, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { registry, snapshots } from '../chain/revm'
import { defaultSnapshotName, MAX_NAME } from '../chain/chainFile'
import type { ChainHandle } from '../chain/handle'
import type { Snapshot } from '../chain/snapshots'
import { forkName, NO_SNAPSHOT, sizeKb, WARN_BYTES } from '../chain/snapshotUi'
import { useApp } from '../state'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Notice } from '../ui/notice'
import { exportChain } from './exportFile'
import { RestoreDialog } from './RestoreDialog'

export type Flash = { tone: 'success' | 'warn'; text: string }
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const dialogCls = 'm-auto rounded-xl border border-line bg-panel p-5 text-text backdrop:bg-bg/70'

/** "Snapshot": a name field prefilled with the default. `openTick` changes each time the parent opens it. */
export function TakeSnapshotDialog({ dialogRef, chain, openTick, onFlash }: {
  dialogRef: RefObject<HTMLDialogElement | null>; chain?: ChainHandle; openTick: number; onFlash: (f: Flash) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  useEffect(() => {
    if (!chain || !openTick) return
    let on = true
    Promise.resolve(chain.request('eth_blockNumber', [])).then(h => on && setName(defaultSnapshotName(chain.info.name, Number(BigInt(h as string)))), () => {})
    return () => { on = false }
  }, [chain, openTick])

  async function take() {
    if (!chain) return
    setBusy(true)
    setErr(undefined)
    try {
      if (!chain.approach.snapshot) throw new Error(NO_SNAPSHOT)
      const s = await snapshots.take(chain, name.trim() || undefined)
      dialogRef.current?.close()
      onFlash({ tone: 'success', text: `Snapshot "${s.name}" saved at block #${s.height}.` })
    } catch (e) {
      setErr(msg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialogRef} onClose={() => { setName(''); setErr(undefined) }} aria-labelledby="take-snapshot-title" className={`${dialogCls} w-[min(30rem,calc(100vw-2rem))]`}>
      <form method="dialog" className="space-y-3" onSubmit={e => { e.preventDefault(); take() }}>
        <h2 id="take-snapshot-title" className="font-display text-base font-semibold">Take snapshot</h2>
        {err && <Notice>{err}</Notice>}
        <Input aria-label="Snapshot name" className="w-full" maxLength={MAX_NAME} value={name} onChange={e => setName(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Take snapshot'}</Button>
        </div>
      </form>
    </dialog>
  )
}

/** The selected chain's snapshots. `openTick` changes each time the parent opens it, which reloads the list. */
export function SnapshotsDialog({ dialogRef, chain, openTick, onFlash }: {
  dialogRef: RefObject<HTMLDialogElement | null>; chain?: ChainHandle; openTick: number; onFlash: (f: Flash) => void
}) {
  const { refresh, selectChain, bumpBalance } = useApp()
  const nav = useNavigate()
  const restoreRef = useRef<HTMLDialogElement>(null)
  const [list, setList] = useState<Snapshot[]>()
  const [err, setErr] = useState<string>()
  const [target, setTarget] = useState<Snapshot>()
  const load = () => { if (chain) snapshots.list(chain.info.id).then(setList, (e: unknown) => setErr(msg(e))) }
  useEffect(() => { setList(undefined); setErr(undefined); load() }, [chain, openTick]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (target) restoreRef.current?.showModal() }, [target])

  async function run(f: () => Promise<void>) {
    setErr(undefined)
    try { await f() } catch (e) { setErr(msg(e)) }
  }
  const fork = (s: Snapshot) => run(async () => {
    if (!chain!.approach.snapshot) throw new Error(NO_SNAPSHOT)
    const h = await registry.createFrom(s.dump, {
      name: forkName(s.name), type: chain!.info.type, contracts: s.contracts, assets: s.assets,
      source: { kind: 'snapshot', snapshotName: s.name, fromChainName: chain!.info.name, height: s.height },
    })
    await refresh()
    await selectChain(h.info.id)
    nav('/chains')
    dialogRef.current?.close()
    onFlash({ tone: 'success', text: `Opened "${h.info.name}" as a new chain.` })
  })
  const del = (s: Snapshot) => run(async () => {
    if (!confirm(`Delete snapshot "${s.name}"?`)) return
    await snapshots.remove(s.id)
    load()
  })
  const restored = (s: Snapshot, saved?: Snapshot) => {
    dialogRef.current?.close()
    nav('/chains')
    bumpBalance() // block window, cached height and balance re-read
    onFlash({ tone: 'success', text: `Restored ${chain!.info.name} to "${s.name}" (block #${s.height}).${saved ? ` Previous state saved as "${saved.name}".` : ''}` })
  }

  return (
    <>
    <dialog ref={dialogRef} onClose={() => { setList(undefined); setErr(undefined) }} aria-labelledby="snapshots-title" className={`${dialogCls} w-[min(44rem,calc(100vw-2rem))]`}>
      <div className="space-y-3">
        <h2 id="snapshots-title" className="font-display text-base font-semibold">Snapshots{chain ? ` of ${chain.info.name}` : ''}</h2>
        {err && <Notice>{err}</Notice>}
        {list?.length === 0 && <p className="text-sm text-muted">No snapshots yet. Use Snapshot in the app bar to take one.</p>}
        <ul className="space-y-2">
          {list?.map(s => (
            <li key={s.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-all font-medium">{s.name}</span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-mono">#{s.height}</span>
                  <span>{new Date(s.createdAt).toLocaleString()}</span>
                  <span>{sizeKb(s.bytes)}</span>
                  {s.bytes > WARN_BYTES && <Badge variant="warn">large</Badge>}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => fork(s)}>Open as new chain</Button>
                <Button size="sm" variant="ghost" onClick={() => setTarget(s)}>Restore this chain…</Button>
                <Button size="sm" variant="ghost" onClick={() => run(() => exportChain(chain!, s))}>Export</Button>
                <Button size="sm" variant="danger" onClick={() => del(s)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end"><Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>Close</Button></div>
      </div>
    </dialog>
    {chain && <RestoreDialog dialogRef={restoreRef} chain={chain} snap={target} onClose={() => setTarget(undefined)} onRestored={restored} />}
    </>
  )
}
