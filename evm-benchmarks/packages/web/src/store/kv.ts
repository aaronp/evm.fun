// IndexedDB-backed key-value store with an in-memory fallback.
// One object store; keys are `${store}\0${key}` so list() is a key-range scan.
const DB = 'evmb-playground'
const OS = 'kv'
const SEP = '\0'

export type Kv = {
  get<T>(store: string, key: string): Promise<T | undefined>
  set(store: string, key: string, value: unknown): Promise<void>
  del(store: string, key: string): Promise<void>
  list<T>(store: string): Promise<T[]>
  persistent: boolean
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })

export function createKv(): Kv {
  const mem = new Map<string, unknown>()
  let db: Promise<IDBDatabase> | undefined
  const kv: Kv = { persistent: false } as Kv

  try {
    const idb = (globalThis as any).indexedDB as IDBFactory | undefined
    if (idb) {
      const open = idb.open(DB, 1)
      open.onupgradeneeded = () => open.result.createObjectStore(OS)
      db = req(open)
      db.catch(() => { kv.persistent = false })
      kv.persistent = true
    }
  } catch {
    db = undefined
  }

  // Run against IndexedDB; on any failure drop to memory for good.
  async function run<T>(idbOp: (os: IDBObjectStore) => Promise<T>, memOp: () => T, write = false): Promise<T> {
    if (kv.persistent && db) {
      try {
        const d = await db
        return await idbOp(d.transaction(OS, write ? 'readwrite' : 'readonly').objectStore(OS))
      } catch {
        kv.persistent = false
      }
    }
    return memOp()
  }
  const k = (s: string, key: string) => s + SEP + key

  kv.get = <T>(s: string, key: string) =>
    run(os => req(os.get(k(s, key))) as Promise<T | undefined>, () => mem.get(k(s, key)) as T | undefined)
  kv.set = (s, key, value) =>
    run(async os => void (await req(os.put(value, k(s, key)))), () => void mem.set(k(s, key), value), true)
  kv.del = (s, key) =>
    run(async os => void (await req(os.delete(k(s, key)))), () => void mem.delete(k(s, key)), true)
  kv.list = <T>(s: string) =>
    run(
      os => req(os.getAll(IDBKeyRange.bound(s + SEP, s + SEP + '￿'))) as Promise<T[]>,
      () => [...mem].filter(([key]) => key.startsWith(s + SEP)).map(([, v]) => v as T),
    )
  return kv
}

export const kv = createKv()
