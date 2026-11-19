import type { RunResult } from '@evmb/core'

/** Chip labels for a result: trade-offs as `key value`, then opts as `k=v`, engine, notes. */
export function tradeoffChips(r: RunResult): string[] {
  const { notes, ...t } = r.approach.tradeoffs
  return [
    ...Object.entries(t).map(([k, v]) => `${k} ${v}`),
    ...Object.entries(r.params.opts ?? {}).map(([k, v]) => `${k}=${v}`),
    ...(r.env.engine ? [r.env.engine] : []),
    ...(notes ? [notes] : []),
  ]
}
