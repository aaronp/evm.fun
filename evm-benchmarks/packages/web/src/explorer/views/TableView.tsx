import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ChainHandle } from '../../chain/handle'
import { latestBlocks } from '../data'
import { useLoad } from '../useLoad'
import { blockMatches, type Header } from '../window'
import { Panel } from '../../ui/panel'
import { Pager } from '../../ui/pager'
import { Table, td, th } from '../../ui/table'

const PAGE = 20
const short = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`
const muted = 'p-4 text-sm text-muted'

/** No filter: pages through all blocks. With a filter: matches within the latest-500 window. */
export function TableView({ chain, q, headers, total, loading, selected }: { chain: ChainHandle; q: string; headers: Header[]; total: number; loading: boolean; selected?: number }) {
  const nav = useNavigate()
  const [at, setAt] = useState({ q, chain, page: 0 })
  const page = at.q === q && at.chain === chain ? at.page : 0 // a new filter or chain starts at page 0 without a stale render
  const setPage = (p: number) => setAt({ q, chain, page: p })
  const filtering = q.trim() !== ''
  const all = useLoad(() => (filtering ? Promise.resolve(null) : latestBlocks(chain, page, PAGE)), [chain, page, filtering, total])
  const matches = filtering ? headers.filter(b => blockMatches(b, q)) : []
  const rows = filtering ? (loading && headers.length === 0 ? undefined : matches.slice(page * PAGE, (page + 1) * PAGE)) : all
  const more = filtering ? (page + 1) * PAGE < matches.length : rows?.length === PAGE
  return (
    <Panel title="Latest blocks" badge={filtering ? <span className="text-xs text-muted">Filtering the latest 500 blocks</span> : undefined}>
      {rows === undefined ? <p className={muted}>Loading…</p> : !rows || rows.length === 0 ? <p className={muted}>{filtering ? 'No matching blocks.' : 'No blocks.'}</p> : (
        <Table>
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Block</th><th className={th}>Hash</th><th className={th}>Time</th><th className={`${th} text-right`}>Txs</th></tr></thead>
            <tbody>
              {rows.map(b => (
                <tr key={b.number} aria-current={b.number === selected ? 'true' : undefined} className={`cursor-pointer border-t border-line hover:bg-surface-hover ${b.number === selected ? 'border-l-4 border-l-accent bg-selected' : ''}`} onClick={() => nav(`/chains/block/${b.number}`)}>
                  <td className={td}><Link className="font-mono text-accent hover:underline" to={`/chains/block/${b.number}`} onClick={e => e.stopPropagation()}>{b.number}</Link>{b.number === selected && <span className="sr-only"> (selected)</span>}</td>
                  <td className={`${td} font-mono text-xs`} title={b.hash}>{short(b.hash)}</td>
                  <td className={`${td} whitespace-nowrap text-text-2`}>{new Date(b.timestamp * 1000).toISOString()}</td>
                  <td className={`${td} text-right font-mono`}>{b.txCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Table>
      )}
      <Pager page={page} set={setPage} more={more} />
    </Panel>
  )
}
