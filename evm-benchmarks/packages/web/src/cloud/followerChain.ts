// A follower chain's Approach: a local copy of a cloud chain (packages/node Follower). Sends run locally at once and stay
// pending until a sync confirms them; polled.
import type { Address, LocalAccount } from 'viem'
import type { ChainInfo } from '../chain/handle'
import type { Approach, Hex, Receipt } from '@evmb/core'
import { NodeClient, NodeError, type BlockSummary } from '@evmb/node/src/client'
import type { FollowerStore, PendingTx } from '@evmb/node/src/followerStore'
import { Follower, FollowerMismatch, FollowerRemoved } from '@evmb/node/src/follower'
import type { NodeConfig } from '@evmb/node/src/node'
import { getSyncInterval, onSyncIntervalChange } from './node'

export type Follows = NonNullable<ChainInfo['follows']>
export type FollowerStatus =
  | { kind: 'following'; block: number; behind: number }
  | { kind: 'offline'; lastSynced?: number; detail: string }
  | { kind: 'removed' | 'mismatch' | 'needs-key' | 'unreachable' | 'clock' | 'gone'; detail: string }

const MAX_BACKOFF_MS = 60_000
/** No point retrying: only Delete / Re-join / Import key help. */
const final = (s: FollowerStatus) => s.kind === 'removed' || s.kind === 'mismatch' || s.kind === 'needs-key' || s.kind === 'gone'
/** Why a follower can't mine, snapshot or restore. */
export const followsCloud = (nodeUrl: string) => `Follows ${nodeUrl}: its blocks come from there`
export const readerOnly = (name: string) => `This device can only read ${name}.`
const NOT_WRITER = 'is not a writer on this chain' // the Follower's refusal after a submit 403
export const otherTab = 'Open in another tab: changes are made there.'
export const notSaving = "This browser isn't saving data: pending changes are lost if you close the tab."

/** "just now", "5 min ago", "3 h ago", "2 days ago" since `at` (unix s). */
export function ago(at: number, now = Date.now() / 1000) {
  const s = now - at
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} days ago`
}

/** One writing tab per chain: holds the Web Lock until `fn`'s promise settles; false when another tab holds it (no Locks API: granted). */
const webLock = (name: string, fn: () => Promise<void>): Promise<boolean> => {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks
  if (!locks) { void fn(); return Promise.resolve(true) }
  return new Promise((res) => void locks.request(name, { ifAvailable: true }, (l) => { res(!!l); return l ? fn() : undefined })
    .catch((e) => { console.warn(`Can't take the writing-tab lock (${name}); following read-only`, e); res(false) }))
}
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

/**
 * `open` (or the first `syncNow`) boots the Follower once and starts polling at the sync-interval setting: paused while
 * the tab is hidden, backing off ×2 up to 60 s on errors. `dispose` stops it. Never throws for cloud errors: they become
 * the status (`onStatus`); reads throw that status's detail until the follower is open.
 */
export function followerApproach(o: {
  follows: Follows
  /** the chain's name in this browser, for the "removed" message */
  name?(): string
  /** the follow account's key in this browser and its label (sent as the device name); looked up on every sync until found */
  key(): { account: LocalAccount; label: string } | undefined
  /** a pending tx sender's key in this browser, to re-sign it after a nonce refusal */
  signer?(from: Address): LocalAccount | undefined
  /** called just before the first open, so a failed compile is retried on the next sync */
  wasm(): Promise<NodeConfig['wasm']>
  /** the accounts store changed (e.g. Import key): a needs-key follower tries again; returns the unsubscribe */
  onKeysChange?(cb: () => void): () => void
  /** this chain's id in this browser: the store key and lock name */
  id?: string
  /** where the copy and pending txs are kept; without it nothing is stored and there is no lock */
  store?: FollowerStore
  lock?(name: string, fn: () => Promise<void>): boolean | Promise<boolean>
  /** false when the browser can't keep data (kv fell back to memory) */
  persistent?(): boolean
  onStatus(s: FollowerStatus): void; onHead(h: BlockSummary): void
  /** the pending list, the device's role or the writing tab changed */
  onChange?(): void
}): Approach & { status(): FollowerStatus; syncNow(): Promise<void>; canWrite(): string | undefined; notice(): string | undefined; pendingTxs(): PendingTx[]; dismiss(hash: Hex): Promise<void> } {
  const { nodeUrl, chainId, account: address } = o.follows
  const lockName = `evmb-follower:${o.id ?? chainId}`
  let holding = false
  let release: (() => void) | undefined
  const refuse = async (): Promise<never> => { throw new Error(followsCloud(nodeUrl)) }
  let role: 'admin' | 'writer' | 'reader' | undefined // from GET /nodes; unknown (offline) → writes allowed, the cloud decides
  let roleDue = true // fetch the role on the next good sync: on open, and after a submit 403
  const receipts = new Map<Hex, Receipt>() // submitted here, not yet taken by awaitSettled
  /** try to become this chain's writing tab (once held, kept until dispose) */
  const acquire = async () => {
    if (holding || !o.store) return
    const held = new Promise<void>((r) => (release = r))
    holding = await (o.lock ?? webLock)(lockName, () => held)
    if (!holding) release = undefined
  }
  let status: FollowerStatus = { kind: 'unreachable', detail: `Connecting to ${nodeUrl}` }
  let f: Follower | undefined
  let running: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let backoff: number | undefined // ms, after an error
  let fStore = false // the open follower has the store
  let stopped = false
  let unsubs: (() => void)[] | undefined
  let client: NodeClient | undefined

  /** this device's role on the chain; a failure leaves it as it was (tried again next sync) */
  const fetchRole = async () => {
    try {
      const { members } = await client!.nodes(chainId)
      const next = members.find((m) => m.address.toLowerCase() === address.toLowerCase())?.role ?? 'reader' // not a member: reads only (readOpen)
      roleDue = false
      if (next !== role) { role = next; o.onChange?.() }
    } catch { /* offline: keep the last known role */ }
  }
  /** why this tab can't write now (undefined: it can) */
  const cantWrite = () => (o.store && f && !fStore ? otherTab : role === 'reader' ? readerOnly(o.name?.() ?? `chain ${chainId}`) : undefined)

  const set = (s: FollowerStatus) => {
    if (JSON.stringify(s) === JSON.stringify(status)) return
    status = s
    o.onStatus(s)
  }
  const classify = (e: unknown): FollowerStatus => {
    const detail = e instanceof Error ? e.message : String(e)
    if (e instanceof FollowerRemoved) return { kind: 'removed', detail: `Removed from ${o.name?.() ?? `chain ${chainId}`}: your copy is no longer updated` }
    if (e instanceof FollowerMismatch) return { kind: 'mismatch', detail: `Your copy differs from the cloud: ${detail}` }
    if (e instanceof NodeError && e.status === 401) return { kind: 'clock', detail: `Check this device's clock (${e.error})` }
    if (e instanceof NodeError && e.status === 404) return { kind: 'gone', detail: 'This chain no longer exists' }
    // fetch failures are TypeErrors in browsers (Bun: other errors); a 5xx or 429 also just means "retrying"
    // (a network-class error: a fetch TypeError, a runtime's coded socket error, or a 5xx/429; engine or store bugs stay "unreachable")
    const network = e instanceof TypeError || (e instanceof NodeError ? e.status >= 500 || e.status === 429 : typeof (e as { code?: unknown })?.code === 'string')
    if (f && network) {
      const at = f.lastSynced
      return { kind: 'offline', lastSynced: at, detail: `Offline${at ? ` — last synced ${ago(at / 1000)}` : ''}.${fStore ? " Changes are kept and sent when you're back." : ''}` }
    }
    return { kind: 'unreachable', detail: e instanceof NodeError ? `${nodeUrl}: ${e.error}` : `Can't reach ${nodeUrl}` }
  }

  const arm = () => {
    clearTimeout(timer)
    timer = undefined
    const every = getSyncInterval()
    if (stopped || final(status) || every === 'manual' || hidden()) return
    timer = setTimeout(() => { timer = undefined; void syncNow() }, backoff ?? every * 1000)
  }
  /** hidden: drop the pending timer; visible: arm again (sync() re-arms itself when it lands) */
  const onVisibility = () => { if (hidden()) { clearTimeout(timer); timer = undefined } else if (!running) arm() }
  const onKeys = () => { if (status.kind === 'needs-key') void syncNow() }

  function syncNow(): Promise<void> {
    return (running ??= sync().finally(() => { running = undefined; arm() }))
  }
  async function sync() {
    try {
      if (stopped || (final(status) && status.kind !== 'needs-key')) return
      if (!stopped) await acquire()
      // took over from another tab: open a copy with the store, keeping the read-only one (the working view) until it is up
      const takeover = !!f && !!o.store && holding && !fStore
      const first = !f || takeover
      if (!f || takeover) {
        const key = o.key()
        if (!key) return set({ kind: 'needs-key', detail: `Needs ${address}'s key` })
        const onPending = (txs: PendingTx[]) => {
          if (txs.some((t) => t.status === 'refused' && t.reason?.endsWith(NOT_WRITER))) roleDue = true
          o.onChange?.()
        }
        client = new NodeClient(nodeUrl, key.account, { name: key.label })
        const next = await Follower.open(client, chainId, await o.wasm(), { signer: o.signer, onPending, ...(o.store && holding && { store: o.store, key: o.id }) })
        if (stopped) return void (await next.dispose())
        const old = f
        f = next
        fStore = !!(o.store && holding)
        await old?.dispose()
      }
      const before = f.head.hash
      await f.sync()
      if (roleDue) await fetchRole()
      backoff = undefined
      set({ kind: 'following', block: f.head.number, behind: Math.max(0, f.cloudHead.number - f.head.number) })
      if (first || f.head.hash !== before) o.onHead(f.head)
    } catch (e) {
      if (stopped) return
      set(classify(e))
      const every = getSyncInterval()
      backoff = Math.min((backoff ?? (every === 'manual' ? 5 : every) * 1000) * 2, MAX_BACKOFF_MS)
    }
  }

  const local = () => {
    if (!f) throw new Error(status.kind === 'following' ? 'not synced yet' : status.detail)
    return f
  }

  return {
    meta: {
      id: 'follower', title: `follows ${chainId} on ${nodeUrl}`, runsIn: ['browser', 'bun'], engine: 'webevm@0.9.1+revm',
      tradeoffs: { evm: true, stateRoot: 'per-block', log: 'memory', sigVerify: 'inline', execution: 'serial', notes: 'local copy of a cloud chain; sends stay pending until the cloud mines them' },
    },
    status: () => status,
    canWrite: cantWrite,
    notice: () => cantWrite() ?? (o.store && o.persistent && !o.persistent() ? notSaving : undefined),
    syncNow,
    async open() {
      if (!unsubs) {
        globalThis.document?.addEventListener('visibilitychange', onVisibility)
        unsubs = [onSyncIntervalChange(arm), o.onKeysChange?.(onKeys) ?? (() => {}), () => globalThis.document?.removeEventListener('visibilitychange', onVisibility)]
      }
      await syncNow()
    },
    async request(method, params = []) {
      return local().read((n) => n.request({ method, params }))
    },
    async call({ to, data }) {
      return (await this.request!('eth_call', [{ to, data }, 'latest'])) as `0x${string}`
    },
    async getBalance(addr) {
      return BigInt((await this.request!('eth_getBalance', [addr, 'latest'])) as string)
    },
    /** Runs each tx on the local copy now (stored pending before it returns); never waits on the network. */
    async submit(raws) {
      const no = cantWrite()
      if (no) throw new Error(no)
      const follower = local()
      for (const raw of raws) {
        const r = await follower.send(raw)
        receipts.set(r.transactionHash, { hash: r.transactionHash, status: r.status === '0x1' ? 'success' : 'reverted', settledAt: performance.now(), contractAddress: r.contractAddress ?? undefined })
      }
      if (getSyncInterval() !== 'manual') void syncNow() // send it soon; never awaited
    },
    /** The local receipts of txs submitted here (they settle with the cloud later: see pendingTxs). */
    async awaitSettled(hashes) {
      return hashes.map((h) => {
        const r = receipts.get(h)
        if (!r) throw new Error(`tx ${h} was not sent from this tab`)
        receipts.delete(h)
        return r
      })
    },
    setup: refuse, mine: refuse, snapshot: refuse, restore: refuse,
    pending: () => f?.pending().filter((t) => t.status === 'pending').length ?? 0,
    pendingTxs: () => f?.pending() ?? [],
    dismiss: (hash) => local().dismiss(hash),
    async dispose() {
      stopped = true
      clearTimeout(timer)
      unsubs?.forEach((u) => u())
      await running
      try { await f?.dispose() } finally { release?.() }
    },
  }
}

/** What the app bar counts: txs still pending, and conflicted ones not dismissed. */
export const pendingSummary = (txs: PendingTx[]) => ({ pending: txs.filter((t) => t.status === 'pending').length, conflicted: txs.filter((t) => t.status === 'conflicted').length })

/** A live follower handle's pending and undismissed settled txs ([] for other chains). */
export const followerTxs = (h?: { approach: unknown }): PendingTx[] =>
  (h?.approach as { pendingTxs?(): PendingTx[] } | undefined)?.pendingTxs?.() ?? []

/** A live follower handle's status (undefined for other chains, or a follower not opened yet). */
export const followerStatus = (h?: { approach: unknown }): FollowerStatus | undefined =>
  (h?.approach as { status?(): FollowerStatus } | undefined)?.status?.()

/** The short badge for a follower status. */
export function statusBadge(s: FollowerStatus): { text: string; tone: 'success' | 'warn' | 'danger' } {
  if (s.kind === 'following') return { text: s.behind ? `${s.behind} behind` : 'in sync', tone: s.behind ? 'warn' : 'success' }
  const text = { removed: 'removed', mismatch: 'differs', 'needs-key': 'needs key', offline: 'offline', unreachable: 'unreachable', clock: 'check clock', gone: 'gone' }[s.kind]
  return { text, tone: s.kind === 'unreachable' || s.kind === 'offline' || s.kind === 'clock' || s.kind === 'needs-key' ? 'warn' : 'danger' }
}
