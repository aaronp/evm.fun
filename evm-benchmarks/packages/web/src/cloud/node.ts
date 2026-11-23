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
