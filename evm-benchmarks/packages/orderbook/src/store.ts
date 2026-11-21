export type IndexKey = (string | number)[]
export type Schema = Record<string, { indexes: Record<string, (v: any) => IndexKey> }>
export type Range = { from?: IndexKey; to?: IndexKey; reverse?: boolean; limit?: number }

export interface Store {
  get<T>(table: string, key: string): Promise<T | undefined>
  put(table: string, key: string, value: unknown): Promise<void>
  del(table: string, key: string): Promise<void>
  scan<T>(table: string, index: string, range: Range): Promise<T[]>
  /** Every row of `table` with its key (for whole-store export). */
  entries(table: string): Promise<{ key: string; value: unknown }[]>
}

const MAX = 2n ** 256n - 1n
/** Zero-padded so string order = numeric order; bids are inverted so both sides scan best first ascending. */
export const priceKey = (side: 'buy' | 'sell', price: bigint): string => {
  if (price < 0n || price > MAX) throw new Error(`Price out of range: ${price}`)
  return (side === 'sell' ? price : MAX - price).toString().padStart(78, '0')
}

export const bookSchema: Schema = {
  orders: {
    indexes: {
      // a closed row (off-chain: filled, cancelled or expired on-chain) leaves the book's scan range
      book: v => [v.scope, v.venue, v.base, v.quote, v.closed ? 'closed' : v.side, v.priceKey, v.seq],
      owner: v => [v.scope, v.venue, v.owner, v.seq],
    },
  },
  attempts: { indexes: { owner: v => [v.scope, v.venue, v.owner, v.seq] } },
  meta: { indexes: {} },
}

// Element order matches IndexedDB: numbers before strings; a shorter prefix sorts first.
const cmpEl = (a: string | number, b: string | number) =>
  typeof a === typeof b ? (a < b ? -1 : a > b ? 1 : 0) : typeof a === 'number' ? -1 : 1
function cmp(a: IndexKey, b: IndexKey): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = cmpEl(a[i]!, b[i]!); if (c) return c }
  return a.length - b.length
}
const cmpPrefix = (k: IndexKey, p: IndexKey) => cmp(k.slice(0, p.length), p)

type Entry = { ik: IndexKey; key: string }
const cmpEntry = (a: Entry, b: Entry) => cmp(a.ik, b.ik) || cmpEl(a.key, b.key)
/** First position whose entry is not < pred (binary search). */
const lower = (arr: Entry[], less: (e: Entry) => boolean) => {
  let lo = 0, hi = arr.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (less(arr[m]!)) lo = m + 1; else hi = m }
  return lo
}

export function memoryStore(schema: Schema): Store {
  const rows = new Map<string, Map<string, any>>()
  const idx = new Map<string, Entry[]>() // `${table}\0${index}`
  const table = (t: string) => { if (!schema[t]) throw new Error(`No table ${t}`); return rows.get(t) ?? rows.set(t, new Map()).get(t)! }
  const entries = (t: string, i: string) => {
    if (!schema[t]?.indexes[i]) throw new Error(`No index ${t}.${i}`)
    return idx.get(`${t}\0${i}`) ?? idx.set(`${t}\0${i}`, []).get(`${t}\0${i}`)!
  }
  const unindex = (t: string, key: string) => {
    const old = table(t).get(key)
    if (old === undefined) return
    for (const [i, fn] of Object.entries(schema[t]!.indexes)) {
      const arr = entries(t, i), e = { ik: fn(old), key }
      arr.splice(lower(arr, x => cmpEntry(x, e) < 0), 1)
    }
  }
  return {
    async get(t, key) { const v = table(t).get(key); return v === undefined ? v : structuredClone(v) },
    async put(t, key, value) {
      unindex(t, key)
      table(t).set(key, structuredClone(value)) // clone: callers can't mutate stored rows behind the indexes
      for (const [i, fn] of Object.entries(schema[t]!.indexes)) {
        const arr = entries(t, i), e = { ik: fn(value), key }
        arr.splice(lower(arr, x => cmpEntry(x, e) < 0), 0, e)
      }
    },
    async del(t, key) { unindex(t, key); table(t).delete(key) },
    async scan(t, i, { from, to, reverse, limit }) {
      const arr = entries(t, i), m = table(t)
      const start = from ? lower(arr, e => cmpPrefix(e.ik, from) < 0) : 0
      const end = to ? lower(arr, e => cmpPrefix(e.ik, to) <= 0) : arr.length
      const out: any[] = []
      for (let n = Math.max(start, end) - start, k = 0; k < n && (limit === undefined || out.length < limit); k++)
        out.push(structuredClone(m.get(arr[reverse ? end - 1 - k : start + k]!.key)))
      return out
    },
    async entries(t) { return [...table(t)].map(([key, v]) => ({ key, value: structuredClone(v) })) },
  }
}

const ixField = (i: string) => `__ix_${i}`
const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
const done = (tx: IDBTransaction) => new Promise<void>((ok, no) => { tx.oncomplete = () => ok(); tx.onerror = tx.onabort = () => no(tx.error) })
const strip = (v: any) => {
  if (v && typeof v === 'object') for (const k of Object.keys(v)) if (k.startsWith('__ix_')) delete v[k]
  return v
}

export function idbStore(name: string, schema: Schema, idb: IDBFactory = indexedDB): Store {
  const db = new Promise<IDBDatabase>((ok, no) => {
    const r = idb.open(name, 1)
    r.onupgradeneeded = () => {
      for (const [t, { indexes }] of Object.entries(schema)) {
        const os = r.result.createObjectStore(t)
        for (const i of Object.keys(indexes)) os.createIndex(i, ixField(i))
      }
    }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => no(r.error)
  })
  const os = async (t: string, mode: IDBTransactionMode) => { const tx = (await db).transaction(t, mode); return { tx, os: tx.objectStore(t) } }
  return {
    async get(t, key) { return strip(await req((await os(t, 'readonly')).os.get(key))) },
    async put(t, key, value) {
      const v: any = { ...(value as object) }
      for (const [i, fn] of Object.entries(schema[t]!.indexes)) v[ixField(i)] = fn(value)
      const { tx, os: s } = await os(t, 'readwrite')
      s.put(v, key)
      await done(tx)
    },
    async del(t, key) { const { tx, os: s } = await os(t, 'readwrite'); s.delete(key); await done(tx) },
    async scan(t, i, { from, to, reverse, limit }) {
      // Arrays sort above strings and numbers in IndexedDB, so [...to, []] bounds every key with prefix `to`.
      const range = from || to
        ? IDBKeyRange.bound(from ?? [], to ? [...to, []] : [[]]) : undefined
      const { os: s } = await os(t, 'readonly')
      const cur = s.index(i).openCursor(range, reverse ? 'prev' : 'next')
      const out: any[] = []
      return new Promise((ok, no) => {
        cur.onerror = () => no(cur.error)
        cur.onsuccess = () => {
          const c = cur.result
          if (!c || (limit !== undefined && out.length >= limit)) return ok(out)
          out.push(strip(c.value)); c.continue()
        }
      })
    },
    async entries(t) {
      const { os: s } = await os(t, 'readonly')
      const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())])
      return keys.map((key, i) => ({ key: key as string, value: strip(values[i]) }))
    },
  }
}
