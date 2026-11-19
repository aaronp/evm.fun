import { createMemoryPersistence, type PersistenceAdapter } from 'webevm'

const STORE = 'state'
const KEY = 'node-state'

export type ClosablePersistence = PersistenceAdapter & { close(): void }

/**
 * webevm-shaped adapter (one record per database) that keeps its connection so it can be
 * closed before deleteDatabase. Falls back to memory when IndexedDB is missing, the
 * kv store already failed (`ready` then `usable()` false), or the open fails.
 */
export function createChainPersistence(
  idb: IDBFactory | undefined,
  name: string,
  ready: Promise<void> = Promise.resolve(),
  usable: () => boolean = () => true,
): ClosablePersistence {
  const mem = createMemoryPersistence()
  let db: Promise<IDBDatabase> | undefined
  let useMem = !idb

  const open = () =>
    (db ??= new Promise<IDBDatabase>((res, rej) => {
      const r = idb!.open(name, 1)
      r.onupgradeneeded = () => r.result.createObjectStore(STORE)
      r.onsuccess = () => {
        r.result.onversionchange = () => r.result.close() // let deleteDatabase through
        res(r.result)
      }
      r.onerror = () => rej(r.error)
    }))

  async function pick(): Promise<IDBDatabase | undefined> {
    await ready
    if (!useMem && !usable()) useMem = true
    if (useMem) return
    try { return await open() } catch { useMem = true }
  }
  const tx = <T>(d: IDBDatabase, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T>((res, rej) => {
      const t = d.transaction(STORE, mode)
      const r = f(t.objectStore(STORE))
      t.oncomplete = () => res(r.result)
      t.onerror = () => rej(t.error)
      t.onabort = () => rej(t.error)
    })

  return {
    async load() {
      const d = await pick()
      return d ? ((await tx(d, 'readonly', s => s.get(KEY))) ?? null) : mem.load()
    },
    async save(state) {
      const d = await pick()
      if (d) await tx(d, 'readwrite', s => s.put(state, KEY))
      else await mem.save(state)
    },
    close() {
      db?.then(d => d.close(), () => {})
      db = undefined
    },
  }
}

/** Close the adapter, then delete the database. A blocked delete stays pending until it succeeds. */
export function deleteChainDb(idb: IDBFactory | undefined, name: string, adapter?: { close(): void }) {
  adapter?.close()
  return new Promise<void>((res, rej) => {
    if (!idb) return res()
    const r = idb.deleteDatabase(name)
    r.onsuccess = () => res()
    r.onerror = () => rej(r.error)
    // onblocked: another connection is open; the delete completes once it closes
  })
}
