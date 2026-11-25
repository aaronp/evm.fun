// Live followers, worker side: the wire format and the broadcast of a new head to a chain's open sockets.
// (No bun:/node: imports: the worker bundles this.)
import type { Hex } from 'viem'
import type { BlockSummary } from './client'

/** Close code for a socket whose key can no longer read the chain. */
export const CLOSE_REMOVED = 4003
/** Heartbeat texts; the Durable Object answers `ping` with `pong` without waking. */
export const PING = 'ping'
export const PONG = 'pong'

export const headMessage = (h: BlockSummary) => JSON.stringify({ type: 'head', number: h.number, hash: h.hash })

/** The head a message announces, or null for anything else (including `pong`). */
export function parseHead(data: unknown): { number: number; hash: Hex } | null {
  if (typeof data !== 'string') return null
  try {
    const m = JSON.parse(data)
    if (m?.type === 'head' && Number.isSafeInteger(m.number) && m.number >= 0 && typeof m.hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(m.hash)) return { number: m.number, hash: m.hash }
  } catch {}
  return null
}

export interface LiveSocket { send(data: string): void; close(code: number, reason: string): void }

export class LiveHub {
  constructor(private sockets: () => { ws: LiveSocket; tag: string }[], private canRead: (tag: string) => Promise<boolean>) {}

  /** Tell every socket the new head; sockets whose key lost read access are closed first and never see it. */
  async broadcast(h: BlockSummary): Promise<void> {
    const all = this.sockets()
    const reads = new Map<string, boolean | null>()
    // once per distinct tag; a failed check leaves the socket alone (neither closed nor sent)
    await Promise.all([...new Set(all.map((s) => s.tag))].map(async (t) => { reads.set(t, await this.canRead(t).catch(() => null)) }))
    const msg = headMessage(h)
    for (const { ws, tag } of all) {
      const ok = reads.get(tag)
      try {
        if (ok) ws.send(msg)
        else if (ok === false) ws.close(CLOSE_REMOVED, 'removed from chain')
      } catch {} // a socket already gone
    }
  }
}
