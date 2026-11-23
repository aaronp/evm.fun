import type { Sql, SqlValue } from './sql'

/** `Sql` over Durable Object SQLite. Typed structurally, so this file needs no `cloudflare:workers` types. */
export interface DoStorage {
  sql: { exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, SqlValue>[] } }
  transactionSync<T>(fn: () => T): T
}

export function doSql(storage: DoStorage): Sql {
  return { exec: (query, ...bindings) => storage.sql.exec(query, ...bindings).toArray(), tx: (fn) => storage.transactionSync(fn) }
}
