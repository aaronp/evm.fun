import { test, expect } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { createKv } from '../src/store/kv'
import { createAccounts } from '../src/store/accounts'

const boom = () => { throw new Error('blocked') }

test('kv round-trips in memory', async () => {
  const kv = createKv() // no indexedDB in bun
  await kv.set('s', 'a', { n: 1 })
  await kv.set('s', 'b', { n: 2 })
  expect(await kv.get('s', 'a')).toEqual({ n: 1 })
  expect(await kv.list('s')).toEqual([{ n: 1 }, { n: 2 }])
  await kv.del('s', 'a')
  expect(await kv.get('s', 'a')).toBeUndefined()
  expect(kv.persistent).toBe(false)
})

test('falls back to memory when storage throws', async () => {
  const g = globalThis as any
  Object.defineProperty(g, 'localStorage', { get: boom, configurable: true })
  Object.defineProperty(g, 'indexedDB', { get: boom, configurable: true })
  try {
    const accounts = createAccounts()
    const a = accounts.create('a')
    expect(accounts.list()).toEqual([a])
    expect(accounts.persistent).toBe(false)
    const kv = createKv()
    await kv.set('s', 'k', 1)
    expect(await kv.get('s', 'k')).toBe(1)
    expect(kv.persistent).toBe(false)
  } finally {
    delete g.localStorage
    delete g.indexedDB
  }
})

test('accounts.create derives address from key', () => {
  const accounts = createAccounts()
  const a = accounts.create('x')
  expect(privateKeyToAccount(a.privateKey).address).toBe(a.address)
  accounts.remove(a.address)
  expect(accounts.list()).toEqual([])
})

test('accounts.import adds a key by its address; malformed or duplicate keys are refused', () => {
  const accounts = createAccounts()
  const key = `0x${'22'.repeat(32)}`
  const a = accounts.import('root', ` ${key} `)
  expect(a).toEqual({ label: 'root', address: privateKeyToAccount(key as `0x${string}`).address, privateKey: key as `0x${string}` })
  expect(() => accounts.import('again', key)).toThrow(/already here/)
  expect(() => accounts.import('bad', '0x1234')).toThrow(/64 hex/)
  expect(accounts.list().length).toBe(1)
})

test('kv: async open failure flips persistent and notifies', async () => {
  const g = globalThis as any
  g.indexedDB = {
    open() {
      const r: any = {}
      setTimeout(() => r.onerror?.(), 0)
      return r
    },
  }
  try {
    const kv = createKv()
    let fired = 0
    kv.onPersistenceChange(() => fired++)
    await kv.ready
    expect(kv.persistent).toBe(false)
    expect(fired).toBe(1)
    await kv.set('s', 'k', 1)
    expect(await kv.get('s', 'k')).toBe(1)
  } finally {
    delete g.indexedDB
  }
})

test('accounts: later setItem failure flips persistent and notifies', () => {
  const g = globalThis as any
  let calls = 0
  g.localStorage = {
    getItem: () => null,
    setItem: () => { if (++calls === 2) throw new Error('quota') },
  }
  try {
    const accounts = createAccounts()
    let fired = 0
    accounts.onPersistenceChange(() => fired++)
    accounts.create('a')
    expect(accounts.persistent).toBe(true)
    accounts.create('b')
    expect(accounts.persistent).toBe(false)
    expect(fired).toBe(1)
    expect(accounts.list().length).toBe(2)
  } finally {
    delete g.localStorage
  }
})

test('kv: persistent is false until the open succeeds', async () => {
  const g = globalThis as any
  g.indexedDB = { open: () => ({}) } // never settles
  try {
    expect(createKv().persistent).toBe(false)
  } finally {
    delete g.indexedDB
  }
})

// A fake IndexedDB that opens and reads fine but whose put throws a quota error for the 'snapshots' store.
const quotaIdb = () => {
  const data = new Map<string, unknown>()
  const ok = (result: unknown) => { const r: any = { result }; setTimeout(() => r.onsuccess?.(), 0); return r }
  const os = {
    get: (k: string) => ok(data.get(k)),
    put: (v: unknown, k: string) => {
      if (k.startsWith('snapshots\0')) throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' })
      data.set(k, v)
      return ok(k)
    },
  }
  const db = { transaction: () => ({ objectStore: () => os }) }
  return { open: () => ok(db), data }
}

test('kv: a strict set that fails throws and leaves kv persistent', async () => {
  const g = globalThis as any
  const idb = quotaIdb()
  g.indexedDB = idb
  try {
    const kv = createKv()
    let fired = 0
    kv.onPersistenceChange(() => fired++)
    await kv.ready
    await expect(kv.set('snapshots', 'x', { big: 1 }, { strict: true })).rejects.toThrow('quota exceeded')
    expect(kv.persistent).toBe(true)
    expect(fired).toBe(0)
    await kv.set('chains', 'c', 1) // later writes still go to IndexedDB
    expect(idb.data.get('chains\0c')).toBe(1)
  } finally {
    delete g.indexedDB
  }
})

// A fake IndexedDB whose put succeeds but whose transaction then aborts (how a quota failure usually shows up).
const abortingIdb = () => {
  const ok = (result: unknown) => { const r: any = { result }; setTimeout(() => r.onsuccess?.(), 0); return r }
  const db = {
    transaction: () => {
      const tx: any = { error: null }
      tx.objectStore = () => ({
        get: () => ok(undefined),
        put: (_v: unknown, k: string) => {
          setTimeout(() => {
            if (k.startsWith('snapshots\0')) { tx.error = Object.assign(new Error('aborted: quota'), { name: 'QuotaExceededError' }); tx.onabort?.() }
            else tx.oncomplete?.()
          }, 5)
          return ok(k)
        },
      })
      return tx
    },
  }
  return { open: () => ok(db) }
}

test('kv: a strict set waits for the transaction and rejects when it aborts', async () => {
  const g = globalThis as any
  g.indexedDB = abortingIdb()
  try {
    const kv = createKv()
    await kv.ready
    await expect(kv.set('snapshots', 'x', 1, { strict: true })).rejects.toThrow('aborted: quota')
    expect(kv.persistent).toBe(true)
    await kv.set('chains', 'c', 1, { strict: true }) // resolves on complete
    await kv.set('snapshots', 'y', 1) // non-strict: unchanged, resolves on the request's success
    expect(kv.persistent).toBe(true)
  } finally {
    delete g.indexedDB
  }
})
