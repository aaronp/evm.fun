import type { SerializedState } from 'webevm'
import type { Hex } from 'viem'
import type { Sql } from './sql'

export type SerializedBlock = SerializedState['blocks'][number]

/** `null` = delete the row. */
export interface StateDiff {
  accounts: Record<string, string | null>
  code: Record<string, string | null>
  storage: Record<string, Record<string, string | null>>
}

export interface StoredBlock {
  header: SerializedBlock
  txs: Hex[]
  receipts: unknown[]
}

export const HEADERS_KEPT = 256

/** webevm keeps a slot written to zero in its dump (as `0x`); the store drops it, as the trie does. */
export const nonZero = (slots: Record<string, string> = {}) => Object.fromEntries(Object.entries(slots).filter(([, v]) => !/^0x0*$/.test(v)))

const NO_CHAIN = 'no chain: call create first'

export class ChainStore {
  constructor(private sql: Sql) {
    for (const ddl of [
      'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)',
      'CREATE TABLE IF NOT EXISTS accounts (addr TEXT PRIMARY KEY, v TEXT)',
      'CREATE TABLE IF NOT EXISTS code (addr TEXT PRIMARY KEY, v TEXT)',
      'CREATE TABLE IF NOT EXISTS storage (addr TEXT, slot TEXT, v TEXT, PRIMARY KEY (addr, slot))',
      'CREATE TABLE IF NOT EXISTS blocks (number INTEGER PRIMARY KEY, hash TEXT, header TEXT, txs TEXT, receipts TEXT)',
    ]) sql.exec(ddl)
  }

  exists(): boolean {
    return this.sql.exec("SELECT 1 FROM meta WHERE k = 'chainId'").length > 0
  }

  create(dump: SerializedState): void {
    if (this.exists()) throw new Error('chain already exists')
    this.sql.tx(() => {
      this.sql.exec("INSERT INTO meta VALUES ('chainId', ?)", String(dump.chainId))
      this.applyDiff({
        accounts: dump.accounts,
        code: dump.code,
        storage: Object.fromEntries(Object.entries(dump.storage).map(([a, slots]) => [a, nonZero(slots)])),
      })
      for (const header of dump.blocks) {
        this.putBlock({
          header,
          txs: header.transactions.map((h) => dump.transactions[h]!.raw as Hex),
          receipts: header.transactions.map((h) => dump.receipts[h]),
        })
      }
    })
  }

  /** Diff rows first, block row last, one transaction: a duplicate block number rolls everything back. */
  commit(block: StoredBlock, diff: StateDiff): void {
    this.sql.tx(() => {
      this.applyDiff(diff)
      this.putBlock(block)
    })
  }

  head(): SerializedBlock {
    const [row] = this.sql.exec('SELECT header FROM blocks ORDER BY number DESC LIMIT 1')
    if (!row) throw new Error(NO_CHAIN)
    return JSON.parse(row.header as string)
  }

  blocks(from: number, to: number): StoredBlock[] {
    return this.sql
      .exec('SELECT header, txs, receipts FROM blocks WHERE number BETWEEN ? AND ? ORDER BY number', from, to)
      .map((r) => ({
        header: JSON.parse(r.header as string),
        txs: JSON.parse(r.txs as string),
        receipts: JSON.parse(r.receipts as string),
      }))
  }

  /** State-only dump (last HEADERS_KEPT headers as stored; empty receipts/transactions maps) for webevm `loadState`. */
  stateDump(): SerializedState {
    if (!this.exists()) throw new Error(NO_CHAIN)
    const rows = (q: string) => this.sql.exec(q)
    const storage: SerializedState['storage'] = {}
    for (const r of rows('SELECT addr, slot, v FROM storage')) (storage[r.addr as string] ??= {})[r.slot as string] = r.v as string
    const map = (q: string) => Object.fromEntries(rows(q).map((r) => [r.addr as string, r.v as string]))
    const headers = this.sql
      .exec('SELECT header FROM blocks ORDER BY number DESC LIMIT ?', HEADERS_KEPT)
      .map((r) => JSON.parse(r.header as string))
      .reverse()
    return {
      version: 1,
      chainId: Number(this.sql.exec("SELECT v FROM meta WHERE k = 'chainId'")[0]!.v),
      accounts: map('SELECT addr, v FROM accounts'),
      code: map('SELECT addr, v FROM code'),
      storage,
      blocks: headers,
      receipts: {},
      transactions: {},
    }
  }

  private putBlock(b: StoredBlock) {
    this.sql.exec(
      'INSERT INTO blocks VALUES (?, ?, ?, ?, ?)',
      b.header.number,
      b.header.hash,
      JSON.stringify(b.header),
      JSON.stringify(b.txs),
      JSON.stringify(b.receipts),
    )
  }

  private applyDiff(d: StateDiff) {
    for (const [table, rows] of [['accounts', d.accounts], ['code', d.code]] as const)
      for (const [addr, v] of Object.entries(rows))
        v === null
          ? this.sql.exec(`DELETE FROM ${table} WHERE addr = ?`, addr)
          : this.sql.exec(`INSERT OR REPLACE INTO ${table} VALUES (?, ?)`, addr, v)
    for (const [addr, slots] of Object.entries(d.storage))
      for (const [slot, v] of Object.entries(slots))
        v === null
          ? this.sql.exec('DELETE FROM storage WHERE addr = ? AND slot = ?', addr, slot)
          : this.sql.exec('INSERT OR REPLACE INTO storage VALUES (?, ?, ?)', addr, slot, v)
  }
}
