import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ENGINE, registry } from '../chain/revm'
import { CROSS_ENGINE_OK } from '../chain/chainFile'
import { kv } from '../store/kv'
import { accounts } from '../store/accounts'
import { bookStore } from '../orderbook/store'
import { useApp } from '../state'
import { useWizard } from '../walkthrough/wizard'
import { useNavigate } from 'react-router-dom'
import { saveWorkspace } from '../workspace/build'
import { unsentChanges, unsentWarning } from '../cloud/followerStore'
import { NOT_KEEPING, newWorkspace, openWorkspace, selectionHash, type OpenResult } from '../workspace/load'
import { SELECTED_CHAIN } from '../workspace/build'
import { validateWorkspace } from '../workspace/validate'
import type { WorkspaceFile } from '../workspace/types'
import { Button } from '../ui/button'
import { Notice } from '../ui/notice'
import { ImportButton } from './ImportButton'
import { downloadText, exportChain } from './exportFile'
import type { FileActions } from './TopBar'

export const NEW_CONFIRM = 'Start a new workspace? This clears every account, chain, record and walkthrough in this browser.'
/** Close after a restore failed: the previous workspace exists only in the downloaded file. */
export const RESTORE_CLOSE = 'Close? Your previous workspace is only in the downloaded previous-workspace.json now — open it to get it back.'
export const KEYS_NOTICE = "This file contains your accounts' private keys. Playground keys only — never real ones."
/** Per browser (never saved, cleared or opened): the keys notice was shown. */
const SEEN = 'evmb.notice.workspaceKeys'

const message = (e: unknown) => e instanceof Error ? e.message : String(e)
const safe = <T,>(f: () => T, fallback: T) => { try { return f() } catch { return fallback } }
// writes throw (blocked storage): a load then fails and the previous workspace is restored
const storage = {
  getItem: (k: string) => safe(() => localStorage.getItem(k), null),
  setItem: (k: string, v: string) => localStorage.setItem(k, v),
  removeItem: (k: string) => localStorage.removeItem(k),
}

type View =
  | { kind: 'new' }
  | { kind: 'keys' }
  | { kind: 'errors'; name: string; errors: string[] }
  | { kind: 'open'; name: string; text: string; file: WorkspaceFile }
  | { kind: 'busy'; text: string }
  | { kind: 'failed'; name?: string; r: Extract<OpenResult, { error: string }> }
  | { kind: 'message'; tone: 'success' | 'warn'; text: string }

/** kv, the accounts store and the order book are on disk: a reload keeps what New/Open wrote. */
const keeping = () => kv.persistent && accounts.persistent && bookStore.persistent

/** Why New/Open/Import can't run now (they would clear or change what a running task writes to). */
export const busyReason = (s: { tx?: boolean; step?: boolean; installing?: number }) =>
  s.tx ? 'A transaction is in flight' : s.step ? 'A walkthrough step is running' : s.installing ? 'A walkthrough is installing' : undefined

/** File menu handlers and their dialogs (New, Open…, Save, Import chain…, Export chain). */
export function useWorkspaceDialogs(): { actions: FileActions; dialogs: ReactNode } {
  const { chain, account, busy: txBusy, installing, refresh, selectChain } = useApp()
  const wz = useWizard()
  const nav = useNavigate()
  const [view, setView] = useState<View>()
  const [unsent, setUnsent] = useState<string>()
  const dialog = useRef<HTMLDialogElement>(null)
  const openInput = useRef<HTMLInputElement>(null), importInput = useRef<HTMLInputElement>(null)
  const seen = !!storage.getItem(SEEN)
  const env = () => ({ registry, kv, accounts: accounts.list(), book: bookStore, storage, engine: ENGINE, account: account as `0x${string}` | undefined })
  const download = (f: { name: string; text: string }) => { downloadText(f.name, f.text); safe(() => storage.setItem(SEEN, '1'), undefined) }

  useEffect(() => {
    const d = dialog.current
    if (view && d && !d.open) d.showModal()
    if (!view && d?.open) d.close()
  }, [view])

  /** Reload at the given selection: the app re-reads accounts and chains, and a stale `?chain=&as=` can't win (state.tsx
   *  lets a link win). Never when storage isn't kept (a reload would come back empty): re-read in place instead. */
  function reload(sel?: WorkspaceFile['selection'], people: WorkspaceFile['accounts'] = []) {
    if (!keeping()) { setView(undefined); void refresh().then(() => selectChain(storage.getItem(SELECTED_CHAIN) ?? undefined)); return }
    history.replaceState(null, '', selectionHash(location.hash, sel, people))
    location.reload()
  }

  async function save() {
    setView({ kind: 'busy', text: 'Saving…' })
    try { download(await saveWorkspace(env())); setView(undefined) } catch (e) { setView({ kind: 'message', tone: 'warn', text: message(e) }) }
  }
  /** The restore failed and no "Save first" file exists: download the only backup now, before anything can close it. */
  function showFailure(r: Extract<OpenResult, { error: string }>, saveFirst: boolean, name?: string) {
    if (r.restoreError && r.previousText && !saveFirst) downloadText('previous-workspace.json', r.previousText)
    setView({ kind: 'failed', name, r })
  }
  /** Unsent follower changes would be lost by New/Open: shown in the confirm. */
  const checkUnsent = async () => setUnsent(unsentWarning(await unsentChanges(kv, await registry.list()).catch(() => [])))
  async function doNew(saveFirst: boolean) {
    setView({ kind: 'busy', text: saveFirst ? 'Saving, then clearing…' : 'Clearing…' })
    const r = await newWorkspace(env(), { ...(saveFirst && { download }), busy: () => why.current })
    if ('ok' in r) return reload()
    if ('error' in r) r.previousText ? showFailure(r, saveFirst) : setView({ kind: 'message', tone: 'warn', text: r.error })
  }
  async function pick(file: File) {
    const text = await file.text()
    const v = validateWorkspace(text, { engine: ENGINE, crossEngineOk: CROSS_ENGINE_OK })
    await checkUnsent()
    setView('errors' in v ? { kind: 'errors', name: file.name, errors: v.errors } : { kind: 'open', name: file.name, text, file: v.ok })
  }
  async function doOpen(o: Extract<View, { kind: 'open' }>, saveFirst: boolean) {
    setView({ kind: 'busy', text: `Opening ${o.name}…` })
    const r = await openWorkspace(o.text, env(), { ...(saveFirst && { download }), busy: () => why.current })
    if ('ok' in r) return reload(o.file.selection, o.file.accounts)
    if ('errors' in r) return setView({ kind: 'errors', name: o.name, errors: r.errors })
    r.failedText ? showFailure(r, saveFirst, o.name) : setView({ kind: 'message', tone: 'warn', text: r.error })
  }

  const busyWhy = busyReason({ tx: txBusy, step: wz?.busy, installing })
  const why = useRef(busyWhy)
  why.current = busyWhy // read again right before clearing: the auto fuse can start a step while the file picker is open
  const exportWhy = !chain ? 'Select a chain first' : chain.info.ephemeral ? "Benchmark chains aren't exported" : undefined
  const refuse = () => setView({ kind: 'message', tone: 'warn', text: NOT_KEEPING })
  const actions: FileActions = {
    new: () => keeping() ? void checkUnsent().then(() => setView({ kind: 'new' })) : refuse(),
    open: () => keeping() ? openInput.current?.click() : refuse(),
    save: () => seen ? void save() : setView({ kind: 'keys' }),
    importChain: () => importInput.current?.click(),
    exportChain: () => { exportChain(chain!).catch(e => setView({ kind: 'message', tone: 'warn', text: `Export failed: ${message(e)}` })) },
    reasons: { new: busyWhy, open: busyWhy, importChain: busyWhy, exportChain: exportWhy },
  }

  const close = () => setView(undefined)
  const busy = view?.kind === 'busy'
  const lost = view?.kind === 'failed' && view.r
  /** After a failed restore, closing needs a confirm (the backup is only in the downloaded file). */
  const leave = () => { if (!(lost && lost.restoreError) || confirm(RESTORE_CLOSE)) dialog.current?.close() }
  const keysLine = !seen && <p className="text-xs text-muted">Save first: {KEYS_NOTICE}</p>
  const dialogs = (
    <>
      <input ref={openInput} type="file" hidden accept=".json,application/json" aria-label="Open workspace file"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f).catch(err => setView({ kind: 'message', tone: 'warn', text: message(err) })) }} />
      <ImportButton inputRef={importInput} onFlash={f => setView({ kind: 'message', ...f })} onImported={(id, funded) => { if (!funded) nav('/chains', { state: { noFunds: id } }) }} />
      <dialog ref={dialog} aria-labelledby="ws-title" aria-busy={busy || undefined}
        onCancel={e => { if (busy || lost) { e.preventDefault(); if (lost) leave() } }} // never close while clearing or loading
        onClose={() => { if (lost) reload(); else setView(undefined) }} // after a failed Open the restored workspace needs a fresh app
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-5 text-text backdrop:bg-bg/70">
        <div className="space-y-3">
          <h2 id="ws-title" className="font-display text-base font-semibold">
            {view?.kind === 'new' ? 'New workspace' : view?.kind === 'keys' ? 'Save workspace' : view?.kind === 'errors' ? "Can't open this file"
              : view?.kind === 'open' ? `Open ${view.name}` : view?.kind === 'failed' ? "Couldn't open the workspace" : busy ? 'Working…' : 'Workspace'}
          </h2>
          {view?.kind === 'new' && <>
            <p className="text-sm">{NEW_CONFIRM}</p>
            {unsent && <Notice tone="warn">{unsent}</Notice>}
            {keysLine}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button variant="ghost" onClick={() => doNew(true)}>Save first</Button>
              <Button variant="danger" onClick={() => doNew(false)}>Clear</Button>
            </div>
          </>}
          {view?.kind === 'keys' && <>
            <Notice>{KEYS_NOTICE}</Notice>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button onClick={() => save()}>Save</Button>
            </div>
          </>}
          {view?.kind === 'errors' && <>
            <p className="text-sm">{view.name} wasn't opened. Nothing changed.</p>
            <ul className="max-h-60 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-danger">{view.errors.map((x, i) => <li key={i}>{x}</li>)}</ul>
            <div className="flex justify-end"><Button variant="ghost" onClick={close}>Close</Button></div>
          </>}
          {view?.kind === 'open' && <>
            <p className="text-sm">Replace the workspace? This clears every account, chain, record and walkthrough in this browser and opens {view.name} instead.</p>
            {unsent && <Notice tone="warn">{unsent}</Notice>}
            {keysLine}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button variant="ghost" onClick={() => doOpen(view, true)}>Save first</Button>
              <Button variant="danger" onClick={() => doOpen(view, false)}>Replace</Button>
            </div>
          </>}
          {view?.kind === 'busy' && <p role="status" className="text-sm">{view.text}</p>}
          {lost && <>
            <Notice>{view.name ? `${view.name} couldn't be opened: ${lost.error}` : lost.error}</Notice>
            <p className="text-sm">{lost.restoreError
              ? `Restoring your previous workspace failed too: ${lost.restoreError}. It was downloaded (previous-workspace.json, or your "Save first" file): open it again.`
              : 'Your previous workspace is back as it was.'}</p>
            <div className="flex flex-wrap justify-end gap-2">
              {lost.failedText && <Button variant="ghost" onClick={() => downloadText(view.name ?? 'failed-workspace.json', lost.failedText!)}>Download the file that failed</Button>}
              {lost.previousText && <Button variant="ghost" onClick={() => downloadText('previous-workspace.json', lost.previousText!)}>Download your previous workspace</Button>}
              <Button onClick={leave}>Close</Button>
            </div>
          </>}
          {view?.kind === 'message' && <>
            <Notice tone={view.tone}>{view.text}</Notice>
            <div className="flex justify-end"><Button variant="ghost" onClick={close}>Close</Button></div>
          </>}
        </div>
      </dialog>
    </>
  )
  return { actions, dialogs }
}
