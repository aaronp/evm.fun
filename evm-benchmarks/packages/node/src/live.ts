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

export type LiveState = 'connecting' | 'live' | 'down' | 'removed'

/**
 * The follower's side of the socket: sync on open, on a head newer than ours, after a failed connect and after a 4003 close;
 * reconnect with doubling backoff (a fresh signed URL each time: nonces are single-use); ping so a half-open socket is noticed.
 * Returns stop.
 */
export function liveSync(
  f: { sync(): Promise<unknown>; head: { number: number } },
  url: () => Promise<string>,
  o: { WebSocket?: typeof WebSocket; pingMs?: number; pongMs?: number; minBackoffMs?: number; maxBackoffMs?: number; onState?: (s: LiveState) => void } = {},
): () => void {
  const { pingMs = 30_000, pongMs = 10_000, minBackoffMs = 1_000, maxBackoffMs = 60_000 } = o
  let stopped = false, backoff = minBackoffMs, cur: { close(): void } | undefined, retry: ReturnType<typeof setTimeout> | undefined
  const state = (s: LiveState) => { if (!stopped) o.onState?.(s) }
  let seen = 0 // the newest head announced; a sync that joined an older running pass can miss it
  const sync = async () => {
    for (;;) {
      const before = f.head.number
      try { await f.sync() } catch (e: any) { // other errors: the Follower records them
        if (e?.name === 'FollowerRemoved' || e?.name === 'FollowerGone') stop()
        return
      }
      if (stopped || seen <= f.head.number || f.head.number === before) return // caught up, stopped, or no progress (wait for the next head/reconnect)
    }
  }
  const stop = () => { stopped = true; clearTimeout(retry); cur?.close() }
  const again = () => {
    if (stopped) return
    state('down')
    retry = setTimeout(connect, backoff)
    backoff = Math.min(backoff * 2, maxBackoffMs)
  }
  async function connect() {
    if (stopped) return
    state('connecting')
    let ws: WebSocket
    try { ws = new (o.WebSocket ?? WebSocket)(await url()) } catch { void sync(); return again() }
    if (stopped) return ws.close()
    let opened = false, over = false, ping: ReturnType<typeof setInterval> | undefined, pong: ReturnType<typeof setTimeout> | undefined
    const end = (code?: number) => { // once per socket, whichever of close/error/missed pong comes first
      if (over) return
      over = true; clearInterval(ping); clearTimeout(pong)
      try { ws.close() } catch {}
      if (stopped) return
      if (code === CLOSE_REMOVED) { void sync(); return state('removed') }
      if (!opened) void sync()
      again()
    }
    cur = { close: () => end() }
    ws.addEventListener('open', () => {
      opened = true; backoff = minBackoffMs
      state('live'); void sync()
      ping = setInterval(() => {
        try { ws.send(PING) } catch { return end() }
        pong ??= setTimeout(() => end(), pongMs) // no pong in time: half-open, give up on it
      }, pingMs)
    })
    ws.addEventListener('message', (e) => {
      if (e.data === PONG) { clearTimeout(pong); pong = undefined; return }
      const h = parseHead(e.data)
      if (h) seen = Math.max(seen, h.number)
      if (h && h.number > f.head.number) void sync()
    })
    ws.addEventListener('close', (e) => end(e.code))
    ws.addEventListener('error', () => end())
  }
  void connect()
  return stop
}
