import type { Hex } from 'viem'
import type { ChainHandle } from '../chain/handle'
import { latestBlocks } from './data'

export interface Header { number: number; hash: Hex; parentHash: Hex; timestamp: number /* s */; txCount: number }

/** Newest `limit` headers (newest first) and the total block count. Never throws. */
export async function blockWindow(h: ChainHandle, limit = 500): Promise<{ headers: Header[]; total: number }> {
  const headers = await latestBlocks(h, 0, limit)
  return { headers, total: headers.length ? headers[0]!.number + 1 : 0 }
}

/** '' matches all; digits match the block number exactly; hex (0x optional) matches a hash prefix. */
export function blockMatches(b: Header, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  if (/^\d+$/.test(s)) return b.number === Number(s)
  const p = s.startsWith('0x') ? s.slice(2) : s
  return /^[0-9a-f]+$/.test(p) && b.hash.toLowerCase().slice(2).startsWith(p)
}

export const windowContains = (headers: Header[], n: number) => headers.some(h => h.number === n)
