import { useEffect, useState, type RefObject, type SyntheticEvent } from 'react'
import { registry } from '../chain/revm'
import type { ChainHandle } from '../chain/handle'
import type { Snapshot } from '../chain/snapshots'
import { restoreBlockedReason } from '../chain/snapshotUi'
import { Button } from '../ui/button'
import { Notice } from '../ui/notice'

/** Native modal; the parent opens it with showModal(). Esc/Cancel close it and the browser returns focus to the opener. */
export function RestoreDialog({ dialogRef, chain, snap, onClose, onRestored }: {
  dialogRef: RefObject<HTMLDialogElement | null>; chain: ChainHandle; snap?: Snapshot; onClose: () => void; onRestored: (snap: Snapshot, saved?: Snapshot) => void
}) {
  const [save, setSave] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const [pending, setPending] = useState(0)
  // While open (a snapshot is targeted) keep the pending count current so Restore re-enables when it settles.
  useEffect(() => {
    if (!snap) return
    const read = () => setPending(chain.approach.pending?.() ?? 0)
    read()
    const t = setInterval(read, 500)
    return () => clearInterval(t)
  }, [snap, chain])
  const blocked = restoreBlockedReason(pending)
  const reset = (e: SyntheticEvent) => { e.stopPropagation(); setSave(true); setErr(undefined); setPending(0); onClose() }

  async function restore() {
    if (!snap) return
    setBusy(true)
    setErr(undefined)
    try {
      const { saved } = await registry.restoreTo(chain.info.id, snap, { saveFirst: save })
      dialogRef.current?.close()
      onRestored(snap, saved)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialogRef} onClose={reset} aria-labelledby="restore-title" className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-5 text-text backdrop:bg-bg/70">
      <form method="dialog" className="space-y-3" onSubmit={e => { e.preventDefault(); restore() }}>
        <h2 id="restore-title" className="font-display text-base font-semibold">Restore {chain.info.name}</h2>
        <p className="text-sm">Blocks after #{snap?.height} will be discarded.</p>
        {(err ?? blocked) && <Notice>{(err ?? blocked)!}</Notice>}
        <label className="flex items-center gap-2 text-sm">
          <input className="accent-accent" type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} />
          Save current state as a snapshot first
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>Cancel</Button>
          <Button type="submit" disabled={busy || !!blocked}>{busy ? 'Restoring…' : 'Restore'}</Button>
        </div>
      </form>
    </dialog>
  )
}
