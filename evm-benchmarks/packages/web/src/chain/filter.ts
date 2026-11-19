import type { ChainInfo } from './handle'

export type ChainTab = 'all' | 'saved' | 'bench'

/** Name filter (trimmed, case-insensitive) plus tab: saved = persisted, bench = ephemeral. Order is kept. */
export function filterChains(chains: ChainInfo[], q: string, tab: ChainTab): ChainInfo[] {
  const s = q.trim().toLowerCase()
  return chains.filter(c => c.name.toLowerCase().includes(s) && (tab === 'all' || !!c.ephemeral === (tab === 'bench')))
}

/** Row height text: live height if the chain is running, else the last saved one, else a dash. */
export function rowHeight(info: ChainInfo, liveHeight?: number): string {
  const n = liveHeight ?? info.lastHeight
  return n === undefined ? '—' : `#${n}`
}
