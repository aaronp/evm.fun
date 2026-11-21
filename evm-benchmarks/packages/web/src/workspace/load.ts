import type { ChainSource } from '../chain/chainFile'
import { CROSS_ENGINE_OK, parseJson } from '../chain/chainFile'
import { createSnapshotStore } from '../chain/snapshots'
import { personaParam, withParams } from '../links'
import { ACCOUNTS_KEY, type Account } from '../store/accounts'
import { ACTIVE_WALKTHROUGH, EDITS, RUNS, SELECTED_CHAIN, saveWorkspace } from './build'
import { clearWorkspace, type WriteEnv } from './clear'
import type { WorkspaceFile } from './types'
import { validateWorkspace } from './validate'

type Download = (f: { name: string; text: string }) => void
export type OpenResult =
  | { ok: true }
  | { errors: string[] }
  /** failedText/previousText back the "Download the file that failed / your previous workspace" choice */
  | { error: string; failedText?: string; previousText?: string; restoreError?: string }

const message = (e: unknown) => e instanceof Error ? e.message : String(e)

/** Only the fields a source has, rebuilt: the file's `source` passed decodeChainFile's shape check but is otherwise untrusted. */
const cleanSource = (s?: ChainSource): ChainSource | undefined =>
  !s ? undefined
    : s.kind === 'import' ? { kind: 'import', fileName: s.fileName, height: s.height }
    : { kind: 'snapshot', snapshotName: s.snapshotName, fromChainName: s.fromChainName, height: s.height }

/** Writes a validated file into an empty workspace: accounts, then each chain one at a time keeping its id (closed
 *  again unless it is the selection, so any number of chains loads), snapshots, walkthroughs, order-book rows, selection. */
export async function loadWorkspace(f: WorkspaceFile, env: WriteEnv) {
  const { registry, kv, book, storage } = env
  storage.setItem(ACCOUNTS_KEY, JSON.stringify(f.accounts.map(({ label, address, privateKey }) => ({ label, address, privateKey }))))
  const selected = f.selection?.chain
  for (const c of f.chains) {
    try {
      await registry.createFrom(c.dump, { id: c.id, name: c.chain.name, type: c.chain.type, contracts: c.contracts, assets: c.assets, source: cleanSource(c.source) })
    } catch (e) { throw new Error(`Chain "${c.chain.name}": ${message(e)}`) }
    if (c.id !== selected) await registry.close(c.id)
  }
  const snaps = createSnapshotStore(kv)
  for (const s of f.snapshots) await snaps.put(s)
  for (const w of f.walkthroughs.edits) await kv.set(EDITS, w.id, w)
  for (const r of f.walkthroughs.runs) await kv.set(RUNS, r.walkthrough, r)
  if (f.activeWalkthrough) storage.setItem(ACTIVE_WALKTHROUGH, f.activeWalkthrough)
  for (const r of f.orderbook) await book.put(r.table, r.key, r.value)
  if (selected) storage.setItem(SELECTED_CHAIN, selected)
}

export const NOT_KEEPING = "This browser isn't keeping data (private window or storage blocked), so New and Open are off. Save still works."
const LOST = "This browser stopped keeping data (storage full or blocked), so the workspace wasn't kept"
/** Storage fell back to memory: what was just written would be gone after a reload. */
const kept = (env: WriteEnv) => { if (!env.kv.persistent) throw new Error(LOST) }

/** Clear (best effort: it may be what just failed), then load our own earlier Save; the error if that fails too. */
async function restore(text: string, env: WriteEnv): Promise<string | undefined> {
  try {
    await clearWorkspace(env, { bestEffort: true })
    const p = parseJson(text)
    if ('error' in p) throw new Error(p.error)
    await loadWorkspace(p.value as WorkspaceFile, env)
    kept(env)
  } catch (e) { return message(e) }
}

/** New: optionally Save first (`download`), then clear. If the clear fails part-way, the previous workspace is restored. */
export async function newWorkspace(env: WriteEnv, o: { download?: Download } = {}): Promise<OpenResult> {
  if (!env.kv.persistent) return { error: NOT_KEEPING }
  let backup: { name: string; text: string } | undefined
  try { backup = await saveWorkspace(env) } catch (e) {
    if (o.download) return { error: message(e) } // "Save first" must not clear unsaved
    // ponytail: no backup when the current workspace can't be built (a broken chain): New is the way out, so it still clears
  }
  if (backup) o.download?.(backup)
  try {
    await clearWorkspace(env)
    kept(env)
    return { ok: true }
  } catch (e) {
    if (!backup) return { error: `Couldn't clear: ${message(e)}` }
    const restoreError = await restore(backup.text, env)
    return { error: `Couldn't clear: ${message(e)}`, previousText: backup.text, ...(restoreError && { restoreError }) }
  }
}

/** Open: validate (errors → nothing changed) → back up the current workspace (Save first downloads that backup) →
 *  clear → load. On any load failure the backup is restored. Never throws. */
export async function openWorkspace(text: string, env: WriteEnv, o: { download?: Download } = {}): Promise<OpenResult> {
  const v = validateWorkspace(text, { engine: env.engine, crossEngineOk: CROSS_ENGINE_OK })
  if ('errors' in v) return v
  if (!env.kv.persistent) return { error: NOT_KEEPING }
  let backup: { name: string; text: string }
  try { backup = await saveWorkspace(env) } catch (e) { return { error: message(e) } } // nothing changed
  o.download?.(backup)
  try {
    await clearWorkspace(env)
    await loadWorkspace(v.ok, env)
    kept(env)
    return { ok: true }
  } catch (e) {
    const restoreError = await restore(backup.text, env)
    return { error: message(e), failedText: text, previousText: backup.text, ...(restoreError && { restoreError }) }
  }
}

/** The address to reload at after New/Open: the loaded selection replaces any stale `?chain=&as=` (state.tsx lets a link win). */
export function selectionHash(hash: string, sel: WorkspaceFile['selection'], accounts: Account[]): string {
  return '#' + withParams(hash.replace(/^#/, '') || '/', { chain: sel?.chain, as: sel?.account && personaParam(sel.account, accounts) })
}
