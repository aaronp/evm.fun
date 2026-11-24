import { describe, expect, test } from 'bun:test'
import type { SerializedState } from 'webevm'
import { ChainStore, type StateDiff, type StoredBlock } from '../src'
import { bunSql } from './bunSql'

const A = '0x' + 'a1'.repeat(20)
const B = '0x' + 'b2'.repeat(20)
const C = '0x' + 'c3'.repeat(20)
const S1 = '0x' + '01'.repeat(32)
const S2 = '0x' + '02'.repeat(32)

const header = (number: number, transactions: string[] = []) => ({
  number, hash: `0xh${number}`, parentHash: `0xh${number - 1}`, timestamp: 1000 + number,
  gasUsed: '0x0', gasLimit: '0x1', baseFeePerGas: '0x0', stateRoot: '0xroot', transactions, logsCount: 0,
})

function fixture(n = 300): SerializedState {
  const blocks = Array.from({ length: n }, (_, i) => header(i + 1))
  if (n >= 5) blocks[4] = header(5, ['0xt1', '0xt2'])
  if (n >= 300) blocks[n - 1] = header(n, ['0xt1'])
  return {
    version: 1, chainId: 31337,
    accounts: { [A]: '0xaa', [B]: '0xbb' },
    code: { [A]: '0xc0de' },
    storage: { [A]: { [S1]: '0x01', [S2]: '0x02' } },
    blocks,
    receipts: { '0xt1': { r: 1 } as never, '0xt2': { r: 2 } as never },
    transactions: { '0xt1': { raw: '0xraw1' } as never, '0xt2': { raw: '0xraw2' } as never },
  }
}

const empty = (): StateDiff => ({ accounts: {}, code: {}, storage: {} })
const block = (number: number): StoredBlock => ({ header: header(number), txs: [], receipts: [] })

describe('ChainStore', () => {
  test('create then stateDump returns the same accounts, code, storage, chainId and the last 256 headers, with empty receipts and transactions', () => {
    const d = fixture()
    const s = new ChainStore(bunSql())
    s.create(d)
    const out = s.stateDump()
    expect(out.accounts).toEqual(d.accounts)
    expect(out.code).toEqual(d.code)
    expect(out.storage).toEqual(d.storage)
    expect(out.chainId).toBe(31337)
    expect(out.blocks.length).toBe(256)
    expect(out.blocks[0]!.number).toBe(45)
    expect(out.blocks.at(-1)).toEqual(d.blocks.at(-1)!)
    expect(out.receipts).toEqual({})
    expect(out.transactions).toEqual({})
  })

  test('create stores every block of the dump with its raw txs and receipts', () => {
    const s = new ChainStore(bunSql())
    s.create(fixture())
    const all = s.blocks(1, 300)
    expect(all.length).toBe(300)
    expect(all[4]!.txs).toEqual(['0xraw1', '0xraw2'])
    expect(all[4]!.receipts).toEqual([{ r: 1 }, { r: 2 }])
    expect(all[5]!.txs).toEqual([])
  })

  test('commit applies upserts and deletes', () => {
    const s = new ChainStore(bunSql())
    s.create(fixture(3))
    const b = block(4)
    s.commit(b, {
      accounts: { [A]: '0xa2', [B]: null },
      code: { [C]: '0xc4' },
      storage: { [A]: { [S1]: '0x09', [S2]: null } },
    })
    const out = s.stateDump()
    expect(out.accounts).toEqual({ [A]: '0xa2' })
    expect(out.code).toEqual({ [A]: '0xc0de', [C]: '0xc4' })
    expect(out.storage).toEqual({ [A]: { [S1]: '0x09' } })
    expect(s.head()).toEqual(b.header)
  })

  test('commit is atomic', () => {
    const s = new ChainStore(bunSql())
    s.create(fixture(3))
    const before = s.stateDump()
    expect(() => s.commit(block(3), { ...empty(), accounts: { [C]: '0xcc' } })).toThrow()
    expect(s.stateDump()).toEqual(before)
    expect(s.head().number).toBe(3)
  })

  test('commit deletes a code row', () => {
    const s = new ChainStore(bunSql())
    s.create(fixture(3))
    s.commit(block(4), { ...empty(), code: { [A]: null } })
    expect(s.stateDump().code).toEqual({})
  })

  test('create drops zero-valued slots', () => {
    const s = new ChainStore(bunSql())
    s.create({ ...fixture(3), storage: { [A]: { [S1]: '0x', [S2]: '0x02' }, [B]: { [S1]: '0x00' } } })
    expect(s.stateDump().storage).toEqual({ [A]: { [S2]: '0x02' } })
  })

  test('create rolls back fully if it fails partway', () => {
    const s = new ChainStore(bunSql())
    const bad = fixture(3)
    bad.accounts[C] = '0xcc'
    bad.blocks.push(header(3)) // duplicate block number: the last insert fails
    expect(() => s.create(bad)).toThrow()
    expect(s.exists()).toBe(false)
    s.create(fixture(3))
    expect(s.stateDump().accounts).toEqual(fixture(3).accounts)
    expect(s.blocks(1, 3).length).toBe(3)
  })

  test('stateDump and head on a store with no chain say so', () => {
    const s = new ChainStore(bunSql())
    expect(() => s.stateDump()).toThrow('no chain: call create first')
    expect(() => s.head()).toThrow('no chain: call create first')
  })

  test('blockOf finds txs from create and from later blocks', () => {
    const sql = bunSql()
    const s = new ChainStore(sql)
    s.create(fixture(10))
    s.commit({ header: header(11, ['0xT3']), txs: ['0xraw3'], receipts: [{ r: 3 }] }, empty())
    expect([s.blockOf('0xt1'), s.blockOf('0xt2'), s.blockOf('0xt3'), s.blockOf('0xt4')]).toEqual([5, 5, 11, undefined])
    // a chain stored before the index existed is indexed when its store is opened
    sql.exec('DELETE FROM txs')
    expect(new ChainStore(sql).blockOf('0xt3')).toBe(11)
  })

  test('exists is false before create, true after; create twice throws', () => {
    const s = new ChainStore(bunSql())
    expect(s.exists()).toBe(false)
    s.create(fixture(3))
    expect(s.exists()).toBe(true)
    expect(() => s.create(fixture(3))).toThrow()
  })
})
