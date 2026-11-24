import type { Address, ApproachHost } from '@evmb/core'
import plain from '@evmb/approach-01-webevm-baseline'
import sequencer from '@evmb/approach-02-seq-memory'
import { rebase, type Asset } from '@evmb/assets'
import type { Kv } from '../store/kv'
import { kvFollowerStore, removeFollowerRows, storedTxs } from '../cloud/followerStore'
import { createContractsRegistry } from '../contracts/registry'
import type { ChainSource, ContractRecord } from './chainFile'
import { createWebAssets } from '../assets/registry'
import { createSnapshotStore, type Snapshot } from './snapshots'
import { makeHandle, type ChainHandle, type ChainInfo, type ChainType, type Deployed } from './handle'
import type { LocalAccount } from 'viem'
import type { NodeConfig } from '@evmb/node/src/node'
import { followerApproach } from '../cloud/followerChain'

export type { ChainHandle, ChainInfo, ChainType, Deployed }

const STORE = 'chains'
const factories = { plain, sequencer }
/** Running chains each hold an engine; warn at LIVE_WARN, refuse more at LIVE_MAX. Nothing is ever auto-closed. */
export const LIVE_WARN = 4
export const LIVE_MAX = 8
const PREFUND = 10n ** 21n
/** Playground chains keep recent state so swap failure reports can replay at the parent block; benchmark chains don't pay for it. */
const STATE_HISTORY = { blocks: 256 }

export function createChainRegistry(deps: {
  kv: Kv
  host: (chainId: string) => ApproachHost
  /** delete the chain's persisted state */
  purge?: (chainId: string) => Promise<void>
  /** what follower chains need: the compiled revm wasm, and the key (and label) of an account in this browser: the follow account's (signs requests to the cloud; its label is the device name) or a pending tx sender's (re-signs it after a nonce refusal) */
  follower?: {
    wasm(): Promise<NodeConfig['wasm']>
    /** the writing-tab lock (default: Web Locks) */
    lock?(name: string, fn: () => Promise<void>): boolean | Promise<boolean>
    account(address: Address): { account: LocalAccount; label: string } | undefined
    /** the accounts store changed: a follower waiting for its key looks again */
    onAccountsChange?(cb: () => void): () => void
  }
}) {
  const live = new Map<string, ChainHandle>()
  const opening = new Map<string, Promise<ChainHandle>>() // concurrent open(id) shares one node
  // withChain's short-lived node (at most one, outside `live`): open(id) waits for it so one chain never has two nodes
  const transient = new Map<string, Promise<void>>()
  let transientQueue: Promise<void> = Promise.resolve()
  const watchers = new Set<(id: string) => void>()
  const emit = (id: string) => watchers.forEach(cb => cb(id))
  const followerStore = kvFollowerStore(deps.kv)
  const build = (info: ChainInfo) => {
    if (info.type !== 'follower') return makeHandle(info, factories[info.type]({}, { ...deps.host(info.id), stateHistory: STATE_HISTORY }))
    if (!deps.follower || !info.follows) throw new Error(`chain ${info.id} can't follow a cloud chain here`)
    const { account, wasm, onAccountsChange, lock } = deps.follower, follows = info.follows
    return makeHandle(info, followerApproach({
      follows, name: () => info.name, id: info.id, store: followerStore, lock, persistent: () => deps.kv.persistent, key: () => account(follows.account), wasm, onKeysChange: onAccountsChange,
      signer: (from) => account(from)?.account,
      onStatus: () => emit(info.id), onHead: () => emit(info.id), onChange: () => emit(info.id),
    }))
  }
  /** Open a follower handle (it never throws for cloud errors: they become its status) and make it live. */
  const startFollower = async (info: ChainInfo) => {
    const h = build(info)
    await h.approach.open!()
    return track(h)
  }
  const assertRoom = () => {
    if (live.size >= LIVE_MAX) throw new Error(`${LIVE_MAX} chains are already running in this tab — delete one or reload the page`)
  }
  const snapshots = createSnapshotStore(deps.kv)
  const contracts = createContractsRegistry(deps.kv)
  const assets = createWebAssets(deps.kv)
  const track = (h: ChainHandle) => (live.set(h.info.id, h), h)

  const self = {
    async list(): Promise<ChainInfo[]> {
      const stored = await deps.kv.list<ChainInfo>(STORE)
      const ephemeral = [...live.values()].map(h => h.info).filter(i => i.ephemeral)
      return [...stored.sort((a, b) => a.createdAt.localeCompare(b.createdAt)), ...ephemeral]
    },
    /** Live handle only; never opens a chain. */
    peek: (id: string): ChainHandle | undefined => live.get(id),
    liveCount: () => live.size,
    assertRoom,
    /** Persist a live chain's current height so lists can show it without opening the chain. */
    async recordHeight(id: string) {
      const h = live.get(id)
      if (!h || h.info.ephemeral) return
      const n = Number(BigInt((await h.request('eth_blockNumber', [])) as string))
      if (!live.has(id)) return // deleted while the request was in flight: don't resurrect it in kv
      if (h.info.lastHeight !== n) { h.info.lastHeight = n; await deps.kv.set(STORE, id, h.info) }
    },
    async create(name: string, type: ChainType, prefund: Address[]): Promise<ChainHandle> {
      assertRoom()
      const info: ChainInfo = { id: crypto.randomUUID(), name, type, createdAt: new Date().toISOString() }
      const h = build(info)
      await h.approach.setup({ prefund: Object.fromEntries(prefund.map(a => [a, PREFUND])) })
      await deps.kv.set(STORE, info.id, info)
      return track(h)
    },
    /**
     * Open `dump` as a new saved chain. Atomic: on any failure no kv row, contracts, persisted db or live handle remains.
     * `source` is trusted as given, so an import caller must build it from the real file name and height,
     * never from a `source` inside the file. (Opening a workspace keeps the file's provenance, rebuilt field by field: workspace/load.ts.)
     */
    async createFrom(dump: unknown, o: { name: string; type: ChainType; contracts: ContractRecord[]; assets?: Asset[]; source?: ChainSource; /** keep this id (opening a workspace); refused if it exists */ id?: string; /** keep the list order (opening a workspace) */ createdAt?: string; deployed?: Deployed }): Promise<ChainHandle> {
      assertRoom()
      // an existing id must be refused up front: the failure cleanup below would delete that chain's data
      if (o.id !== undefined && (live.has(o.id) || opening.has(o.id) || transient.has(o.id) || await deps.kv.get(STORE, o.id))) throw new Error(`A chain with id ${o.id} already exists`)
      const info: ChainInfo = { id: o.id ?? crypto.randomUUID(), name: o.name, type: o.type, createdAt: o.createdAt ?? new Date().toISOString(), ...(o.source && { source: o.source }), ...(o.deployed && { deployed: o.deployed }) }
      const h = build(info)
      try {
        await h.approach.setup({ prefund: {}, dump })
        info.lastHeight = Number(BigInt((await h.request('eth_blockNumber', [])) as string))
        await contracts.replace(info.id, o.contracts)
        await assets.replace(info.id, (o.assets ?? []).map(a => rebase(a, info.id)))
        await deps.kv.set(STORE, info.id, info)
      } catch (e) {
        await h.dispose().catch(() => {})
        await deps.kv.del(STORE, info.id).catch(() => {})
        await contracts.replace(info.id, []).catch(() => {})
        await assets.removeChain(info.id).catch(() => {})
        await deps.purge?.(info.id).catch(() => {})
        throw e
      }
      return track(h)
    },
    /** Rewind chain `id` to `snap`. Refused while txs are pending (nothing saved or lost). */
    async restoreTo(id: string, snap: Snapshot, o: { saveFirst: boolean }): Promise<{ saved?: Snapshot }> {
      const h = await self.open(id)
      if (snap.chainId !== id) throw new Error('snapshot belongs to another chain')
      const n = h.approach.pending?.() ?? 0
      if (n > 0) throw new Error(`Wait for ${n} pending transactions to settle`)
      const saved = o.saveFirst ? await snapshots.take(h) : undefined
      await h.approach.restore!(snap.dump)
      await contracts.replace(id, snap.contracts)
      await assets.replace(id, snap.assets ?? [])
      await self.recordHeight(id)
      return { saved }
    },
    /** Replace chain `id`'s state with `dump` (a deployed chain coming back), keeping its contract and asset records. Refused while txs are pending. */
    async replaceState(id: string, dump: unknown) {
      const h = await self.open(id)
      const n = h.approach.pending?.() ?? 0
      if (n > 0) throw new Error(`Wait for ${n} pending transactions to settle`)
      await h.approach.restore!(dump)
      await self.recordHeight(id)
      return h
    },
    /** Record where saved chain `id` is deployed. */
    async setDeployed(id: string, deployed: Deployed) {
      const info = live.get(id)?.info ?? await deps.kv.get<ChainInfo>(STORE, id)
      if (!info || info.ephemeral) throw new Error(`unknown chain ${id}`)
      info.deployed = deployed
      await deps.kv.set(STORE, id, info)
    },
    open(id: string): Promise<ChainHandle> {
      const cached = live.get(id)
      if (cached) return Promise.resolve(cached)
      let p = opening.get(id)
      if (!p) {
        try { assertRoom() } catch (e) { return Promise.reject(e) }
        p = (async () => {
          await transient.get(id)
          const info = await deps.kv.get<ChainInfo>(STORE, id)
          if (!info) throw new Error(`unknown chain ${id}`)
          const h = build(info)
          try {
            await h.approach.open!()
          } catch (e) {
            await h.dispose().catch(() => {})
            throw e
          }
          return track(h)
        })().finally(() => { if (opening.get(id) === p) opening.delete(id) }) // a conversion may have taken the slot
        opening.set(id, p)
      }
      return p
    },
    /**
     * Run `fn` on chain `id` for the workspace save/load path. A live or opening chain is used as is and stays live.
     * Otherwise a transient node is built outside the cap (one at a time, so never more than LIVE_MAX + 1 engines)
     * and disposed as soon as `fn` settles; an open(id) meanwhile waits for it. Normal opens keep the cap.
     * `fn` must not open or withChain the same chain (it would wait on itself), nor withChain another (queue deadlock).
     */
    async withChain<T>(id: string, fn: (h: ChainHandle) => Promise<T>): Promise<T> {
      const shared = live.get(id) ?? opening.get(id)
      if (shared) return fn(await shared)
      const prev = transientQueue
      let release!: () => void
      transientQueue = new Promise(r => (release = r))
      await prev
      try {
        // checked and claimed with no await in between, so an open(id) is either seen here or waits for the claim
        const again = live.get(id) ?? opening.get(id)
        if (again) return await fn(await again)
        let done!: () => void
        transient.set(id, new Promise(r => (done = r)))
        try {
          const info = await deps.kv.get<ChainInfo>(STORE, id)
          if (!info) throw new Error(`unknown chain ${id}`)
          const h = build(info)
          try {
            await h.approach.open!()
            return await fn(h)
          } finally {
            await h.dispose().catch(() => {})
          }
        } finally {
          transient.delete(id)
          done()
        }
      } finally {
        release()
      }
    },
    /** Dispose a live chain's engine, keeping everything saved; it can be opened again. No-op if not live. */
    async close(id: string) {
      const h = live.get(id)
      if (!h) return
      live.delete(id)
      await h.dispose()
    },
    async remove(id: string) {
      await live.get(id)?.dispose()
      live.delete(id)
      await deps.kv.del(STORE, id)
      await contracts.replace(id, [])
      await assets.removeChain(id)
      await snapshots.removeForChain(id)
      await removeFollowerRows(deps.kv, id)
      await deps.purge?.(id)
    },
    /** Delete snapshots of chains that are neither stored nor live. */
    async pruneSnapshots() {
      await snapshots.pruneOrphans(new Set((await self.list()).map(c => c.id)))
    },
    /** Store a follower as a pointer plus its records, without opening it (workspace Open): no worker request until it is opened. */
    async putFollower(o: { id: string; name: string; createdAt: string; follows: NonNullable<ChainInfo['follows']>; contracts: ContractRecord[]; assets?: Asset[] }) {
      if (live.has(o.id) || opening.has(o.id) || transient.has(o.id) || await deps.kv.get(STORE, o.id)) throw new Error(`A chain with id ${o.id} already exists`)
      try {
        await contracts.replace(o.id, o.contracts)
        await assets.replace(o.id, (o.assets ?? []).map(a => rebase(a, o.id)))
        await deps.kv.set(STORE, o.id, { id: o.id, name: o.name, type: 'follower', createdAt: o.createdAt, follows: o.follows } satisfies ChainInfo)
      } catch (e) {
        await contracts.replace(o.id, []).catch(() => {})
        await assets.removeChain(o.id).catch(() => {})
        throw e
      }
    },
    /** Make saved chain `id` a follower of `follows`: same id, name, contract and asset records; its engine and stored state go. */
    // registered in `opening` until the follower is live, so an open(id) meanwhile gets this follower, not a plain engine
    convertToFollower(id: string, follows: NonNullable<ChainInfo['follows']>): Promise<ChainHandle> {
      const prior = opening.get(id)
      const p: Promise<ChainHandle> = (async () => {
        await prior?.catch(() => {})
        await transient.get(id)
        const old = live.get(id)?.info ?? await deps.kv.get<ChainInfo>(STORE, id)
        if (!old || old.ephemeral) throw new Error(`unknown chain ${id}`)
        if (!live.has(id)) assertRoom()
        // refused before anything local goes: without the key the follower could never sync
        if (!deps.follower?.account(follows.account)) throw new Error(`Needs ${follows.account}'s key`)
        await self.close(id)
        await deps.purge?.(id)
        const info: ChainInfo = { ...old, type: 'follower', follows }
        await deps.kv.set(STORE, id, info)
        return startFollower(info)
      })().finally(() => { if (opening.get(id) === p) opening.delete(id) })
      opening.set(id, p)
      return p
    },
    /**
     * Open the follower chains (not yet live) that have stored pending txs, so they sync and send them. Stops one short of
     * LIVE_MAX, leaving room to switch chain; the ones left out are counted from the store (app bar: "open <chain> to send").
     */
    async openWaiting() {
      const idle = (await self.list()).filter(c => c.follows && !live.has(c.id) && !opening.has(c.id))
      for (const c of await storedTxs(deps.kv, idle)) {
        if (!c.txs.some(t => t.status === 'pending')) continue
        if (live.size + opening.size >= LIVE_MAX - 1) break
        await self.open(c.id).catch(() => {})
      }
    },
    /** `cb(id)` when a follower's head, status, pending list or ability to write changes; returns the unsubscribe. */
    watch(cb: (id: string) => void) {
      watchers.add(cb)
      return () => void watchers.delete(cb)
    },
    addEphemeral(handle: ChainHandle) {
      assertRoom()
      handle.info.ephemeral = true
      live.set(handle.info.id, handle)
    },
  }
  return self
}
