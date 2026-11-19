import type { Address, ApproachHost } from '@evmb/core'
import plain from '@evmb/approach-01-webevm-baseline'
import sequencer from '@evmb/approach-02-seq-memory'
import { rebase, type Asset } from '@evmb/assets'
import type { Kv } from '../store/kv'
import { createContractsRegistry } from '../contracts/registry'
import type { ChainSource, ContractRecord } from './chainFile'
import { createWebAssets } from '../assets/registry'
import { createSnapshotStore, type Snapshot } from './snapshots'
import { makeHandle, type ChainHandle, type ChainInfo, type ChainType } from './handle'

export type { ChainHandle, ChainInfo, ChainType }

const STORE = 'chains'
const factories = { plain, sequencer }
/** Running chains each hold an engine; warn at LIVE_WARN, refuse more at LIVE_MAX. Nothing is ever auto-closed. */
export const LIVE_WARN = 4
export const LIVE_MAX = 8
const PREFUND = 10n ** 21n

export function createChainRegistry(deps: {
  kv: Kv
  host: (chainId: string) => ApproachHost
  /** delete the chain's persisted state */
  purge?: (chainId: string) => Promise<void>
}) {
  const live = new Map<string, ChainHandle>()
  const opening = new Map<string, Promise<ChainHandle>>() // concurrent open(id) shares one node
  const build = (info: ChainInfo) => makeHandle(info, factories[info.type]({}, deps.host(info.id)))
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
     * never from a `source` inside the file.
     */
    async createFrom(dump: unknown, o: { name: string; type: ChainType; contracts: ContractRecord[]; assets?: Asset[]; source: ChainSource }): Promise<ChainHandle> {
      assertRoom()
      const info: ChainInfo = { id: crypto.randomUUID(), name: o.name, type: o.type, createdAt: new Date().toISOString(), source: o.source }
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
    open(id: string): Promise<ChainHandle> {
      const cached = live.get(id)
      if (cached) return Promise.resolve(cached)
      let p = opening.get(id)
      if (!p) {
        try { assertRoom() } catch (e) { return Promise.reject(e) }
        p = (async () => {
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
        })().finally(() => opening.delete(id))
        opening.set(id, p)
      }
      return p
    },
    async remove(id: string) {
      await live.get(id)?.dispose()
      live.delete(id)
      await deps.kv.del(STORE, id)
      await contracts.replace(id, [])
      await assets.removeChain(id)
      await snapshots.removeForChain(id)
      await deps.purge?.(id)
    },
    /** Delete snapshots of chains that are neither stored nor live. */
    async pruneSnapshots() {
      await snapshots.pruneOrphans(new Set((await self.list()).map(c => c.id)))
    },
    addEphemeral(handle: ChainHandle) {
      assertRoom()
      handle.info.ephemeral = true
      live.set(handle.info.id, handle)
    },
  }
  return self
}
