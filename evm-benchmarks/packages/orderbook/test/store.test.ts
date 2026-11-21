import 'fake-indexeddb/auto' // global IDBKeyRange for idbStore; stores get their own IDBFactory
import { describe, expect, test } from 'bun:test'
import { IDBFactory } from 'fake-indexeddb'
import { bookSchema, idbStore, memoryStore, priceKey, type Store } from '../src'

const factories: [string, () => Store][] = [
  ['memoryStore', () => memoryStore(bookSchema)],
  ['idbStore', () => idbStore('t' + Math.random(), bookSchema, new IDBFactory())],
]

const order = (id: string, venue: string, side: 'buy' | 'sell', price: bigint, seq: number, owner = '0xa') =>
  ({ id, scope: 's1', venue, base: '0xb', quote: '0xq', side, price, owner, seq, priceKey: priceKey(side, price) })
const book = (venue: string, side: string) => ({ from: ['s1', venue, '0xb', '0xq', side], to: ['s1', venue, '0xb', '0xq', side] })
const ids = (r: any[]) => r.map(o => o.id)

for (const [name, make] of factories) describe(name, () => {
  test('put/get/del', async () => {
    const s = make()
    expect(await s.get('orders', 'x')).toBeUndefined()
    await s.put('orders', 'x', order('x', 'v', 'sell', 5n, 1))
    expect((await s.get<any>('orders', 'x'))?.price).toBe(5n)
    await s.del('orders', 'x')
    expect(await s.get('orders', 'x')).toBeUndefined()
    expect(await s.scan('orders', 'owner', {})).toEqual([])
    await s.put('meta', 'seq', { n: 3 }) // table without indexes
    expect(await s.get('meta', 'seq')).toEqual({ n: 3 })
  })

  test('scan ascending, reverse, limit, prefix bounds', async () => {
    const s = make()
    for (const [i, seq] of [[1, 3], [2, 1], [3, 2]] as const) await s.put('orders', `o${i}`, order(`o${i}`, 'v', 'sell', 10n, seq))
    await s.put('orders', 'z', order('z', 'v', 'sell', 10n, 9, '0xb'))
    const a = { from: ['s1', 'v', '0xa'], to: ['s1', 'v', '0xa'] }
    expect(ids(await s.scan('orders', 'owner', a))).toEqual(['o2', 'o3', 'o1'])
    expect(ids(await s.scan('orders', 'owner', { ...a, reverse: true }))).toEqual(['o1', 'o3', 'o2'])
    expect(ids(await s.scan('orders', 'owner', { ...a, limit: 2 }))).toEqual(['o2', 'o3'])
    expect(ids(await s.scan('orders', 'owner', { from: ['s1', 'v', '0xa', 2], to: ['s1', 'v', '0xa', 3] }))).toEqual(['o3', 'o1'])
    expect(ids(await s.scan('orders', 'owner', { from: ['s1', 'v', '0xb'] }))).toEqual(['z'])
    expect(ids(await s.scan('orders', 'owner', { to: ['s1', 'v', '0xa', 1] }))).toEqual(['o2'])
    expect(ids(await s.scan('orders', 'owner', {}))).toEqual(['o2', 'o3', 'o1', 'z'])
  })

  test('best first for asks and bids, incl. 78-digit prices', async () => {
    const s = make()
    const big = 2n ** 256n - 1n
    const asks = [7n, 100n, big, 20n], bids = [7n, 100n, big - 1n, 20n]
    for (const [i, p] of asks.entries()) await s.put('orders', `a${i}`, order(`a${i}`, 'v', 'sell', p, i))
    for (const [i, p] of bids.entries()) await s.put('orders', `b${i}`, order(`b${i}`, 'v', 'buy', p, i))
    const a = await s.scan<any>('orders', 'book', book('v', 'sell'))
    const b = await s.scan<any>('orders', 'book', book('v', 'buy'))
    expect(a.map(o => o.price)).toEqual([7n, 20n, 100n, big])
    expect(b.map(o => o.price)).toEqual([big - 1n, 100n, 20n, 7n])
    expect(priceKey('sell', big)).toHaveLength(78)
  })

  test('two venues never cross a [scope, venue] prefix', async () => {
    const s = make()
    await s.put('orders', 'a', order('a', '0x1', 'sell', 5n, 1))
    await s.put('orders', 'b', order('b', '0x2', 'sell', 4n, 2))
    await s.put('orders', 'c', { ...order('c', '0x1', 'sell', 3n, 3), scope: 's2' })
    expect(ids(await s.scan('orders', 'book', { from: ['s1', '0x1'], to: ['s1', '0x1'] }))).toEqual(['a'])
  })

  test('overwriting a row moves it in its index', async () => {
    const s = make()
    await s.put('orders', 'a', order('a', 'v', 'sell', 5n, 1))
    await s.put('orders', 'b', order('b', 'v', 'sell', 6n, 2))
    await s.put('orders', 'a', order('a', 'v', 'sell', 9n, 1))
    expect(ids(await s.scan('orders', 'book', book('v', 'sell')))).toEqual(['b', 'a'])
    await s.put('attempts', 'h', { scope: 's1', venue: 'v', owner: '0xa', seq: 1 })
    expect(await s.scan('attempts', 'owner', { from: ['s1', 'v', '0xa'], to: ['s1', 'v', '0xa'] })).toHaveLength(1)
  })

  test('mutating returned rows cannot corrupt the indexes', async () => {
    const s = make()
    await s.put('orders', 'a', order('a', 'v', 'sell', 5n, 1))
    await s.put('orders', 'b', order('b', 'v', 'sell', 6n, 2))
    const got: any = await s.get('orders', 'a')
    got.priceKey = 'zzz'; got.price = 99n
    const [sc]: any[] = await s.scan('orders', 'book', book('v', 'sell'))
    sc.priceKey = 'zzz'; sc.seq = 77
    await s.put('orders', 'a', order('a', 'v', 'sell', 9n, 1))
    await s.del('orders', 'b')
    expect(ids(await s.scan('orders', 'book', book('v', 'sell')))).toEqual(['a'])
    expect(await s.scan('orders', 'owner', {})).toHaveLength(1)
    expect((await s.get<any>('orders', 'a'))?.price).toBe(9n)
  })

  test('reverse + limit take the top of the range', async () => {
    const s = make()
    for (let i = 1; i <= 5; i++) await s.put('orders', `o${i}`, order(`o${i}`, 'v', 'sell', 10n, i))
    const a = { from: ['s1', 'v', '0xa'], to: ['s1', 'v', '0xa'] }
    expect(ids(await s.scan('orders', 'owner', { ...a, reverse: true, limit: 2 }))).toEqual(['o5', 'o4'])
    expect(ids(await s.scan('orders', 'owner', { ...a, limit: 0 }))).toEqual([])
  })

  test('no __ix_ fields in returned rows', async () => {
    const s = make()
    await s.put('orders', 'a', order('a', 'v', 'sell', 5n, 1))
    const rows = [await s.get<any>('orders', 'a'), ...(await s.scan<any>('orders', 'book', {}))]
    for (const r of rows) expect(Object.keys(r).filter(k => k.startsWith('__ix_'))).toEqual([])
  })

  test('entries lists every row of a table (incl. meta) with its key, without __ix_ fields', async () => {
    const s = make()
    expect(await s.entries('orders')).toEqual([])
    await s.put('orders', 'b', order('b', 'v', 'buy', 5n, 2))
    await s.put('orders', 'a', order('a', 'v', 'sell', 7n, 1))
    await s.put('meta', 'seq', { n: 3 })
    await s.put('attempts', 'h', { scope: 's1', venue: 'v', owner: '0xa', seq: 1 })
    await s.del('orders', 'b')
    await s.put('orders', 'c', order('c', 'w', 'sell', 1n, 3))
    const rows = (await s.entries('orders')).sort((x, y) => x.key.localeCompare(y.key))
    expect(rows.map(r => r.key)).toEqual(['a', 'c'])
    expect((rows[0]!.value as any).price).toBe(7n)
    for (const r of rows) expect(Object.keys(r.value as object).filter(k => k.startsWith('__ix_'))).toEqual([])
    expect(await s.entries('meta')).toEqual([{ key: 'seq', value: { n: 3 } }])
    expect(await s.entries('attempts')).toHaveLength(1)
    ;(rows[0]!.value as any).price = 0n // returned rows are copies
    expect((await s.get<any>('orders', 'a'))?.price).toBe(7n)
  })

  test('priceKey rejects out-of-range prices', () => {
    expect(() => priceKey('sell', -1n)).toThrow()
    expect(() => priceKey('buy', 2n ** 256n)).toThrow()
  })
})
