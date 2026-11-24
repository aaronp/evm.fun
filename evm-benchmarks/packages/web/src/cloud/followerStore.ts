// A follower's confirmed copy and pending txs in the browser's kv (IndexedDB, or memory when that's unavailable).
import type { Confirmed, FollowerStore, PendingTx } from '@evmb/node/src/followerStore'
import type { Kv } from '../store/kv'

const CONFIRMED = 'followerConfirmed'
const pendingStore = (key: string) => `followerPending:${key}`

export const kvFollowerStore = (kv: Kv): FollowerStore => ({
  loadConfirmed: (key) => kv.get<Confirmed>(CONFIRMED, key),
  saveConfirmed: (key, c) => kv.set(CONFIRMED, key, c),
  listPending: async (key) => (await kv.list<PendingTx>(pendingStore(key))).sort((a, b) => a.seq - b.seq),
  putPending: (key, tx) => kv.set(pendingStore(key), String(tx.seq), tx),
  deletePending: (key, seq) => kv.del(pendingStore(key), String(seq)),
})

/** Deletes a chain's stored copy and every pending record (chain delete). */
export async function removeFollowerRows(kv: Kv, id: string) {
  await kv.del(CONFIRMED, id)
  for (const t of await kv.list<PendingTx>(pendingStore(id))) await kv.del(pendingStore(id), String(t.seq))
}

/** Follower chains with unsent changes (records still `pending`), for the "will be lost" warning before a workspace is cleared. */
export async function unsentChanges(kv: Kv, chains: { id: string; name: string }[]) {
  const out: { name: string; count: number }[] = []
  for (const c of chains) {
    const count = (await kv.list<PendingTx>(pendingStore(c.id))).filter((t) => t.status === 'pending').length
    if (count) out.push({ name: c.name, count })
  }
  return out
}

/** "3 unsent changes on A, B will be lost" (undefined when there are none). */
export const unsentWarning = (u: { name: string; count: number }[]) =>
  u.length ? `${u.reduce((n, c) => n + c.count, 0)} unsent changes on ${u.map((c) => c.name).join(', ')} will be lost.` : undefined
