import type { Address } from 'viem'
import type { KeyPersistence, StoredKey } from './types'

const k = (a: Address) => a.toLowerCase()

export class MemoryKeyPersistence implements KeyPersistence {
  private keys = new Map<string, StoredKey>()
  private meta = new Map<string, Uint8Array>()
  async store(e: StoredKey) { this.keys.set(k(e.address), e) }
  async list() { return [...this.keys.values()] }
  async getMeta(key: string) { return this.meta.get(key) }
  async ensureMeta(key: string, make: () => Uint8Array) {
    if (!this.meta.has(key)) this.meta.set(key, make())
    return this.meta.get(key)!
  }
}

/** IndexedDB database "evmb-keys": object stores "keys" (StoredKey by lowercased address) and "meta". */
export class IndexedDbKeyPersistence implements KeyPersistence {
  private db: Promise<IDBDatabase> | undefined

  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('evmb-keys', 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('keys')
        req.result.createObjectStore('meta')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }))
  }

  private async run<T>(store: 'keys' | 'meta', mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const tx = (await this.open()).transaction(store, mode)
    const req = op(tx.objectStore(store))
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result as T)
      tx.onerror = tx.onabort = () => reject(tx.error ?? req.error)
    })
  }

  async store(e: StoredKey) { await this.run('keys', 'readwrite', (s) => s.put(e, k(e.address))) }
  list() { return this.run<StoredKey[]>('keys', 'readonly', (s) => s.getAll()) }
  getMeta(key: string) { return this.run<Uint8Array | undefined>('meta', 'readonly', (s) => s.get(key)) }
  /** `add` fails with ConstraintError if another tab wrote first; then the stored value wins. */
  async ensureMeta(key: string, make: () => Uint8Array) {
    const v = make()
    try {
      await this.run('meta', 'readwrite', (s) => s.add(v, key))
      return v
    } catch (e) {
      if ((e as DOMException | null)?.name !== 'ConstraintError') throw e
      return (await this.getMeta(key))!
    }
  }
}
