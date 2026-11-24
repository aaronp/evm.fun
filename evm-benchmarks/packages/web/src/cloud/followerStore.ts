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
