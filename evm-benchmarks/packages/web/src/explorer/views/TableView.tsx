import { useEffect, useState } from 'react'
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
export function TableView({ chain, q, headers, total }: { chain: ChainHandle; q: string; headers: Header[]; total: number }) {
  const nav = useNavigate()
  const [page, setPage] = useState(0)
  const filtering = q.trim() !== ''
  useEffect(() => setPage(0), [q, chain])
  const all = useLoad(() => (filtering ? Promise.resolve(null) : latestBlocks(chain, page, PAGE)), [chain, page, filtering, total])
  const matches = filtering ? headers.filter(b => blockMatches(b, q)) : []
  const rows = filtering ? matches.slice(page * PAGE, (page + 1) * PAGE) : all
  const more = filtering ? (page + 1) * PAGE < matches.length : rows?.length === PAGE
  return (
    <Panel title="Latest blocks" badge={filtering ? <span className="text-xs text-muted">Filtering the latest 500 blocks</span> : undefined}>
      {rows === undefined ? <p className={muted}>Loading…</p> : !rows || rows.length === 0 ? <p className={muted}>{filtering ? 'No matching blocks.' : 'No blocks.'}</p> : (
        <Table>
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Block</th><th className={th}>Hash</th><th className={th}>Time</th><th className={`${th} text-right`}>Txs</th></tr></thead>
            <tbody>
              {rows.map(b => (
                <tr key={b.number} className="cursor-pointer border-t border-line hover:bg-surface-hover" onClick={() => nav(`/chains/block/${b.number}`)}>
                  <td className={td}><Link className="font-mono text-accent hover:underline" to={`/chains/block/${b.number}`} onClick={e => e.stopPropagation()}>{b.number}</Link></td>
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
