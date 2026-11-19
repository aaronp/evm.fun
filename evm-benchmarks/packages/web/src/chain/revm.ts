import { createIndexedDBPersistence } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { wasmUrl } from 'revm-wasm/wasm-url' // Vite emits and rewrites this asset URL
import type { ApproachHost } from '@evmb/core'
import { createChainRegistry } from './registry'
import { kv } from '../store/kv'

// One IndexedDB database per chain, so removing a chain is deleteDatabase.
const dbName = (id: string) => `evmb-chain-${id}`

export const host = (chainId: string): ApproachHost => ({
  createEngine: () => createRevmEngine({ wasm: wasmUrl }),
  persistence: createIndexedDBPersistence({ db: dbName(chainId) }),
})

export const purge = (chainId: string) =>
  new Promise<void>(res => {
    try {
      const r = indexedDB.deleteDatabase(dbName(chainId))
      r.onsuccess = r.onerror = r.onblocked = () => res()
    } catch { res() }
  })

export const registry = createChainRegistry({ kv, host, purge })
