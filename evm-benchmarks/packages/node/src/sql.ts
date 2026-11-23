export type SqlValue = string | number | null

/** The slice of SQL both Durable Object SQLite (`ctx.storage.sql`) and bun:sqlite can be adapted to. */
export interface Sql {
  exec(query: string, ...bindings: SqlValue[]): Record<string, SqlValue>[]
  /** Run `fn` in one transaction: commits if it returns, rolls back if it throws. */
  tx<T>(fn: () => T): T
}
