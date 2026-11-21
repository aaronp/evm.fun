import { bookSchema, idbStore, memoryStore, type Store } from '@evmb/orderbook'

/** IndexedDB when it opens, else memory (no IndexedDB, blocked storage, SSR, tests). */
function open(): Store & { persistent: boolean } {
  let persistent = false
  const mem = memoryStore(bookSchema)
  if (typeof indexedDB === 'undefined' || typeof IDBKeyRange === 'undefined') return Object.assign(mem, { persistent: false })
  let use: Promise<Store>
  try {
    const idb = idbStore('evmb-orderbook', bookSchema)
    use = idb.get('meta', 'open').then(() => (persistent = true, idb), () => mem)
  } catch { use = Promise.resolve(mem) }
  return {
    /** false until IndexedDB opened, and for good if it fell back to memory (New/Open refuse then) */
    get persistent() { return persistent },
    get: async (t, k) => (await use).get(t, k),
    put: async (t, k, v) => (await use).put(t, k, v),
    del: async (t, k) => (await use).del(t, k),
    scan: async (t, i, r) => (await use).scan(t, i, r),
    entries: async t => (await use).entries(t),
  }
}

/** The app's one order-book store; rows are keyed by scope (the playground chain id) and venue address. */
export const bookStore = open()
