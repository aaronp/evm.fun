// A follower chain's Approach: reads from a local copy of a cloud chain (packages/node Follower), sends refused, polled.
import type { LocalAccount } from 'viem'
import type { ChainInfo } from '../chain/handle'
import type { Approach } from '@evmb/core'
import { NodeClient, NodeError, type BlockSummary } from '@evmb/node/src/client'
import { Follower, FollowerMismatch, FollowerRemoved } from '@evmb/node/src/follower'
import type { NodeConfig } from '@evmb/node/src/node'
import { getSyncInterval, onSyncIntervalChange } from './node'

export type Follows = NonNullable<ChainInfo['follows']>
export type FollowerStatus =
  | { kind: 'following'; block: number; behind: number }
  | { kind: 'removed' | 'mismatch' | 'needs-key' | 'unreachable' | 'clock' | 'gone'; detail: string }

const MAX_BACKOFF_MS = 60_000
/** No point retrying: only Delete / Re-join / Import key help. */
const final = (s: FollowerStatus) => s.kind === 'removed' || s.kind === 'mismatch' || s.kind === 'needs-key' || s.kind === 'gone'
export const readOnly = (nodeUrl: string) => `Read-only until B: this chain lives on ${nodeUrl}`
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

/**
 * `open` (or the first `syncNow`) boots the Follower once and starts polling at the sync-interval setting: paused while
 * the tab is hidden, backing off ×2 up to 60 s on errors. `dispose` stops it. Never throws for cloud errors: they become
 * the status (`onStatus`); reads throw that status's detail until the follower is open.
 */
export function followerApproach(o: {
  follows: Follows
  /** the follow account's key in this browser and its label (sent as the device name); looked up on every sync until found */
  key(): { account: LocalAccount; label: string } | undefined
  /** called just before the first open, so a failed compile is retried on the next sync */
  wasm(): Promise<NodeConfig['wasm']>
  /** the accounts store changed (e.g. Import key): a needs-key follower tries again; returns the unsubscribe */
  onKeysChange?(cb: () => void): () => void
  onStatus(s: FollowerStatus): void; onHead(h: BlockSummary): void
}): Approach & { status(): FollowerStatus; syncNow(): Promise<void> } {
  const { nodeUrl, chainId, account: address } = o.follows
  const why = readOnly(nodeUrl)
  const refuse = async (): Promise<never> => { throw new Error(why) }
  let status: FollowerStatus = { kind: 'unreachable', detail: `Connecting to ${nodeUrl}` }
  let f: Follower | undefined
  let running: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let backoff: number | undefined // ms, after an error
  let stopped = false
  let unsubs: (() => void)[] | undefined

  const set = (s: FollowerStatus) => {
    if (JSON.stringify(s) === JSON.stringify(status)) return
    status = s
    o.onStatus(s)
  }
  const classify = (e: unknown): FollowerStatus => {
    const detail = e instanceof Error ? e.message : String(e)
    if (e instanceof FollowerRemoved) return { kind: 'removed', detail: `Removed from chain ${chainId}: your copy is no longer updated` }
    if (e instanceof FollowerMismatch) return { kind: 'mismatch', detail: `Your copy differs from the cloud: ${detail}` }
    if (e instanceof NodeError && e.status === 401) return { kind: 'clock', detail: `Check this device's clock (${e.error})` }
    if (e instanceof NodeError && e.status === 404) return { kind: 'gone', detail: 'This chain no longer exists' }
    // fetch failures are TypeErrors in browsers (Bun: other errors); a 5xx or 429 also just means "retrying"
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
      const first = !f
      if (!f) {
        const key = o.key()
        if (!key) return set({ kind: 'needs-key', detail: `Needs ${address}'s key` })
        const next = await Follower.open(new NodeClient(nodeUrl, key.account, { name: key.label }), chainId, await o.wasm())
        if (stopped) return void (await next.dispose())
        f = next
      }
      const before = f.head.hash
      await f.sync()
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
      tradeoffs: { evm: true, stateRoot: 'per-block', log: 'memory', sigVerify: 'inline', execution: 'serial', notes: 'read-only copy of a cloud chain' },
    },
    status: () => status,
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
    setup: refuse, submit: refuse, awaitSettled: refuse, mine: refuse, snapshot: refuse, restore: refuse,
    pending: () => 0,
    async dispose() {
      stopped = true
      clearTimeout(timer)
      unsubs?.forEach((u) => u())
      await running
      await f?.dispose()
    },
  }
}
