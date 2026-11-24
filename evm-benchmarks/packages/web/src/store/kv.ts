// IndexedDB-backed key-value store with an in-memory fallback.
// One object store; keys are `${store}\0${key}` so list() is a key-range scan.
const DB = 'evmb-playground'
const OS = 'kv'
const SEP = '\0'

export type Kv = {
  get<T>(store: string, key: string): Promise<T | undefined>
  /** `strict`: on an IndexedDB failure throw and stay persistent, instead of dropping to memory (for large optional writes). */
  set(store: string, key: string, value: unknown, opts?: { strict?: boolean }): Promise<void>
  del(store: string, key: string): Promise<void>
  list<T>(store: string): Promise<T[]>
  /** Delete everything (kv holds only workspace data; per-browser settings live in localStorage). */
  clear(): Promise<void>
  persistent: boolean
  /** Resolves once the IndexedDB open has settled (either way). */
  ready: Promise<void>
  onPersistenceChange(cb: () => void): () => void
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })

export function createKv(): Kv {
  const mem = new Map<string, unknown>()
  let db: Promise<IDBDatabase> | undefined
  const subs = new Set<() => void>()
  let opened = false
  let usable = false // db opened and no operation has failed since
  let ready: Promise<void> = Promise.resolve()
  const fail = () => {
    if (!usable) return
    usable = false
    subs.forEach(cb => cb())
  }
  const kv = {
    get persistent() { return usable && opened },
    get ready() { return ready },
    onPersistenceChange: (cb: () => void) => (subs.add(cb), () => void subs.delete(cb)),
  } as Kv

  try {
    const idb = (globalThis as any).indexedDB as IDBFactory | undefined
    if (idb) {
      const open = idb.open(DB, 1)
      open.onupgradeneeded = () => open.result.createObjectStore(OS)
      db = req(open)
      usable = true // so run() waits for the open; cleared below if it fails
      ready = db.then(() => void (opened = true), () => fail())
    }
  } catch {
    db = undefined
    usable = false
  }

  // Run against IndexedDB; on any failure drop to memory for good (strict: rethrow instead).
  async function run<T>(idbOp: (os: IDBObjectStore) => Promise<T>, memOp: () => T, write = false, strict = false): Promise<T> {
    if (usable && db) {
      try {
        const d = await db
        const tx = d.transaction(OS, write ? 'readwrite' : 'readonly')
        // strict: done only once the transaction commits (a quota failure often surfaces as an abort)
        const committed = strict && new Promise<void>((res, rej) => {
          tx.oncomplete = () => res()
          tx.onabort = tx.onerror = () => rej(tx.error ?? new Error('IndexedDB transaction aborted'))
        })
        if (committed) committed.catch(() => {}) // a failed request rejects first; don't leave this unhandled
        const r = await idbOp(tx.objectStore(OS))
        if (committed) await committed
        return r
      } catch (e) {
        if (strict) throw e
        fail()
      }
    }
    return memOp()
  }
  const k = (s: string, key: string) => s + SEP + key

  kv.get = <T>(s: string, key: string) =>
    run(os => req(os.get(k(s, key))) as Promise<T | undefined>, () => structuredClone(mem.get(k(s, key))) as T | undefined)
  kv.set = (s, key, value, opts) =>
    run(async os => void (await req(os.put(value, k(s, key)))), () => void mem.set(k(s, key), structuredClone(value)), true, opts?.strict)
  kv.del = (s, key) =>
    run(async os => void (await req(os.delete(k(s, key)))), () => void mem.delete(k(s, key)), true)
  kv.list = <T>(s: string) =>
    run(
      os => req(os.getAll(IDBKeyRange.bound(s + SEP, s + SEP + '￿'))) as Promise<T[]>,
      () => [...mem].filter(([key]) => key.startsWith(s + SEP)).map(([, v]) => structuredClone(v) as T),
    )
  kv.clear = () => run(async os => { mem.clear(); await req(os.clear()) }, () => mem.clear(), true)
  return kv
}

export const kv = createKv()
