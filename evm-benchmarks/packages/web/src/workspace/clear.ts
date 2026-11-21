import { bookSchema } from '@evmb/orderbook'
import { createSnapshotStore } from '../chain/snapshots'
import { ACCOUNTS_KEY } from '../store/accounts'
import type { Run, Walkthrough } from '../walkthrough/types'
import { ACTIVE_WALKTHROUGH, EDITS, RUNS, SELECTED_CHAIN, type WorkspaceEnv } from './build'

/** The workspace env for New/Open: storage is written too (localStorage in the app). */
export type WriteEnv = WorkspaceEnv & { storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }

/** Deletes all workspace data: every chain (benchmark ones too) with its records and persisted state, snapshots,
 *  walkthrough edits/runs/active id, order-book rows, accounts and the selected chain. Per-browser keys stay. */
export async function clearWorkspace(env: WriteEnv) {
  const { registry, kv, book, storage } = env
  for (const c of await registry.list()) await registry.remove(c.id)
  await createSnapshotStore(kv).pruneOrphans(new Set()) // every chain is gone, so every snapshot
  for (const w of await kv.list<Walkthrough>(EDITS)) await kv.del(EDITS, w.id)
  for (const r of await kv.list<Run>(RUNS)) await kv.del(RUNS, r.walkthrough)
  for (const t of Object.keys(bookSchema)) for (const { key } of await book.entries(t)) await book.del(t, key)
  for (const k of [ACCOUNTS_KEY, SELECTED_CHAIN, ACTIVE_WALKTHROUGH]) storage.removeItem(k)
}
