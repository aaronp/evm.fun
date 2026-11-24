import { Database } from 'bun:sqlite'
import type { Sql, SqlValue } from '../src/sql'

export function bunSql(db: Database = new Database(':memory:')): Sql {
  return {
    exec: (query, ...bindings: SqlValue[]) => db.query(query).all(...bindings) as Record<string, SqlValue>[],
    tx: (fn) => db.transaction(fn)(),
  }
}
