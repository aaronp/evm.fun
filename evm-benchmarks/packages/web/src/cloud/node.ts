// The chain worker evm.fun talks to (packages/node), and a client signing as a playground account.
import { privateKeyToAccount } from 'viem/accounts'
import { NodeClient } from '@evmb/node/src/client'
import type { Account } from '../store/accounts'

const KEY = 'evmb.nodeUrl' // per-browser setting, not workspace data
/** Set at build time (the Pages build gets it from the repo variable NODE_URL); the local worker otherwise. */
export const DEFAULT_NODE_URL: string = import.meta.env?.VITE_NODE_URL || 'http://localhost:8799'

export function nodeUrl(): string {
  try { return localStorage.getItem(KEY) || DEFAULT_NODE_URL } catch { return DEFAULT_NODE_URL }
}
/** '' goes back to the default. */
export function setNodeUrl(url: string) {
  try { url.trim() ? localStorage.setItem(KEY, url.trim()) : localStorage.removeItem(KEY) } catch {}
}

/** A client for the current worker, signing as `a` (unsigned requests only without one). */
export const clientFor = (a?: Account) => new NodeClient(nodeUrl(), a && privateKeyToAccount(a.privateKey))

export type SyncInterval = 'live' | 'manual'
const SYNC_KEY = 'evmb.syncInterval' // per-browser, like the node URL
let syncMem: SyncInterval | undefined // when storage is blocked
const syncSubs = new Set<() => void>()
/** "Keep followers": 'live' (a socket per follower) or 'manual' (sync only on Sync now). Default live; an old stored 5/15/60 reads as live. */
export function getSyncInterval(): SyncInterval {
  try { return localStorage.getItem(SYNC_KEY) === 'manual' ? 'manual' : 'live' } catch { return syncMem ?? 'live' }
}
export function setSyncInterval(v: SyncInterval) {
  syncMem = v
  try { localStorage.setItem(SYNC_KEY, String(v)) } catch {}
  syncSubs.forEach((cb) => cb())
}
/** Running followers open or close their sockets; returns the unsubscribe. */
export const onSyncIntervalChange = (cb: () => void) => (syncSubs.add(cb), () => void syncSubs.delete(cb))
