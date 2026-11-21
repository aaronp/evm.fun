import { bookSchema } from '@evmb/orderbook'
import { ACCOUNTS_KEY } from '../store/accounts'
import { ACTIVE_WALKTHROUGH, SELECTED_CHAIN, type WorkspaceEnv } from './build'

/** The workspace env for New/Open: storage is written too (localStorage in the app). */
export type WriteEnv = WorkspaceEnv & { storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }

/** Deletes all workspace data: the storage keys first (accounts, selected chain, active walkthrough — the likeliest
 *  failure, before anything is destroyed), then every chain (benchmark ones too) with its persisted state, all of kv
 *  (records, snapshots, walkthrough edits/runs, incl. orphans) and every order-book row. Per-browser keys stay.
 *  `bestEffort` (restoring a backup): carry on past each item's error. */
export async function clearWorkspace(env: WriteEnv, o: { bestEffort?: boolean } = {}) {
  const { registry, kv, book, storage } = env
  const step = async (f: () => unknown) => { try { await f() } catch (e) { if (!o.bestEffort) throw e } }
  for (const k of [ACCOUNTS_KEY, SELECTED_CHAIN, ACTIVE_WALKTHROUGH]) await step(() => storage.removeItem(k))
  for (const c of await registry.list().catch(e => { if (o.bestEffort) return []; throw e })) await step(() => registry.remove(c.id))
  await step(() => kv.clear())
  for (const t of Object.keys(bookSchema)) await step(async () => { for (const { key } of await book.entries(t)) await book.del(t, key) })
}
