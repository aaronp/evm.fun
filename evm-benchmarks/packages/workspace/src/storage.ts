import type { Address } from 'viem'
import type { SerializedState } from 'webevm'

export type ChainRecord = {
  id: string; name: string; desc: string; createdAt: number
  /** unfinished: the create request may have redeemed a code but the chain wasn't confirmed; retryDeploy resends it */
  status: 'local' | 'unfinished' | 'deployed'; dump?: SerializedState; deployedAt?: number; error?: string
  /** the key that sent its deploy (its grant is that key's); none on records from before it was kept */
  by?: Address
}
export type WorkspaceStorage = { load(): Promise<ChainRecord[]>; save(c: ChainRecord): Promise<void> }

export class MemoryWorkspaceStorage implements WorkspaceStorage {
  private chains = new Map<string, ChainRecord>()
  async load() { return [...this.chains.values()].map((c) => structuredClone(c)) }
  async save(c: ChainRecord) { this.chains.set(c.id, structuredClone(c)) }
}

/** IndexedDB database "evmb-workspace": object store "chains" (ChainRecord by id). */
export class IndexedDbWorkspaceStorage implements WorkspaceStorage {
  private db: Promise<IDBDatabase> | undefined

  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('evmb-workspace', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('chains', { keyPath: 'id' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }))
  }

  private async run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const tx = (await this.open()).transaction('chains', mode)
    const req = op(tx.objectStore('chains'))
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result as T)
      tx.onerror = tx.onabort = () => reject(tx.error ?? req.error)
    })
  }

  load() { return this.run<ChainRecord[]>('readonly', (s) => s.getAll()) }
  async save(c: ChainRecord) { await this.run('readwrite', (s) => s.put(c)) }
}
