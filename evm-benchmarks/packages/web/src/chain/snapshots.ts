import type { Kv } from '../store/kv'
import { createContractsRegistry } from '../contracts/registry'
import { defaultSnapshotName, type ContractRecord } from './chainFile'
import type { ChainHandle } from './handle'

export interface Snapshot {
  id: string; chainId: string; name: string; height: number; createdAt: string
  dump: unknown; contracts: ContractRecord[]; bytes: number
}

const STORE = 'snapshots'

export function createSnapshotStore(kv: Kv) {
  const contracts = createContractsRegistry(kv)
  return {
    async list(chainId: string): Promise<Snapshot[]> {
      const all = await kv.list<Snapshot>(STORE)
      return all.filter(s => s.chainId === chainId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },
    async take(handle: ChainHandle, name?: string): Promise<Snapshot> {
      const dump = await handle.approach.snapshot!()
      const height = Number(BigInt((await handle.request('eth_blockNumber', [])) as string))
      const snap: Snapshot = {
        id: crypto.randomUUID(), chainId: handle.info.id, name: name || defaultSnapshotName(handle.info.name, height),
        height, createdAt: new Date().toISOString(), dump, contracts: await contracts.list(handle.info.id),
        bytes: JSON.stringify(dump, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).length,
      }
      await kv.set(STORE, snap.id, snap)
      return snap
    },
    get: (id: string) => kv.get<Snapshot>(STORE, id),
    remove: (id: string) => kv.del(STORE, id),
    async removeForChain(chainId: string) {
      for (const s of await this.list(chainId)) await kv.del(STORE, s.id)
    },
  }
}
