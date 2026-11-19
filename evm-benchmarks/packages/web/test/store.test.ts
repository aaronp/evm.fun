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
