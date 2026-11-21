import type { Kv } from '../store/kv'
import type { Asset } from '@evmb/assets'
import { createContractsRegistry } from '../contracts/registry'
import { createWebAssets } from '../assets/registry'
import { defaultSnapshotName, type ContractRecord } from './chainFile'
import type { ChainHandle } from './handle'
import { sizeKb } from './snapshotUi'

export interface Snapshot {
  id: string; chainId: string; name: string; height: number; createdAt: string
  dump: unknown; contracts: ContractRecord[]; assets: Asset[]; bytes: number
}

const STORE = 'snapshots'

export function createSnapshotStore(kv: Kv) {
  const contracts = createContractsRegistry(kv)
  const assets = createWebAssets(kv)
  return {
    async list(chainId: string): Promise<Snapshot[]> {
      const all = await kv.list<Snapshot>(STORE)
      return all.filter(s => s.chainId === chainId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },
    async take(handle: ChainHandle, name?: string): Promise<Snapshot> {
      const dump = await handle.approach.snapshot!()
      const height = Number(BigInt((await handle.request('eth_blockNumber', [])) as string))
      const recs = await contracts.list(handle.info.id)
      const held = (await assets.list(handle.info.id)).filter(a => a.kind === 'erc20')
      const snap: Snapshot = {
        id: crypto.randomUUID(), chainId: handle.info.id, name: name || defaultSnapshotName(handle.info.name, height),
        height, createdAt: new Date().toISOString(), dump, contracts: recs, assets: held,
        bytes: new TextEncoder().encode(JSON.stringify({ dump, contracts: recs, assets: held }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).length,
      }
      // strict: a snapshot too big for the quota must not switch the whole app to memory
      try {
        await kv.set(STORE, snap.id, snap, { strict: true })
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e)
        throw new Error((e as Error)?.name === 'QuotaExceededError'
          ? `Snapshot too large to save (${sizeKb(snap.bytes)}): browser storage is full`
          : `Snapshot could not be saved: ${why}`)
      }
      return snap
    },
    get: (id: string) => kv.get<Snapshot>(STORE, id),
    /** Store `snap` as is, keeping its id (opening a workspace). */
    put: (snap: Snapshot) => kv.set(STORE, snap.id, snap, { strict: true }),
    remove: (id: string) => kv.del(STORE, id),
    async removeForChain(chainId: string) {
      for (const s of await this.list(chainId)) await kv.del(STORE, s.id)
    },
    /** Delete snapshots whose chain is not in `knownIds` (an unsaved benchmark chain is gone after a reload). */
    async pruneOrphans(knownIds: Set<string>) {
      for (const s of await kv.list<Snapshot>(STORE)) if (!knownIds.has(s.chainId)) await kv.del(STORE, s.id)
    },
  }
}
