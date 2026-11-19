import { createRevmEngine } from 'webevm/revm'
import { wasmUrl } from 'revm-wasm/wasm-url' // Vite emits and rewrites this asset URL
import type { ApproachHost } from '@evmb/core'
import plain from '@evmb/approach-01-webevm-baseline'
import { createChainRegistry } from './registry'
import { createChainPersistence, deleteChainDb, type ClosablePersistence } from './idb'
import { kv } from '../store/kv'
import { createSnapshotStore } from './snapshots'

// One IndexedDB database per chain, so removing a chain is deleteDatabase.
const dbName = (id: string) => `evmb-chain-${id}`
const idb = () => (globalThis as any).indexedDB as IDBFactory | undefined
const adapters = new Map<string, ClosablePersistence>()

const createEngine = () => createRevmEngine({ wasm: wasmUrl })

/** Engine label (e.g. `webevm@0.9.1+revm`), read from approach 01's meta so it is never hard-coded here. */
export const ENGINE = plain({}, { createEngine }).meta.engine!

export const host = (chainId: string): ApproachHost => ({
  createEngine,
  persistence: adapters.get(chainId) ?? (adapters.set(chainId, createChainPersistence(idb(), dbName(chainId), kv.ready, () => kv.persistent)), adapters.get(chainId)),
})

export async function purge(chainId: string) {
  const a = adapters.get(chainId)
  adapters.delete(chainId)
  await deleteChainDb(idb(), dbName(chainId), a)
}

export const registry = createChainRegistry({ kv, host, purge })

export const snapshots = createSnapshotStore(kv)
