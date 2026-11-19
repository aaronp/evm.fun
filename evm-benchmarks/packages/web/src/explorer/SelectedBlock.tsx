import { Link } from 'react-router-dom'
import type { ChainHandle } from '../chain/handle'
import { block } from './data'
import { useLoad } from './useLoad'
import { Button } from '../ui/button'
import { CopyIcon } from '../ui/icons'
import { Panel } from '../ui/panel'

const link = 'text-accent hover:underline'
const short = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`

/** `n` undefined = no selection: shows the tip, headed "Latest block". `tip` comes from the block window. */
export function SelectedBlock({ chain, n, tip }: { chain: ChainHandle; n?: number; tip?: number }) {
  const num = n ?? tip
  const b = useLoad(async () => (num === undefined ? null : block(chain, num, 0, 10)), [chain, num])
  const child = useLoad(async () => (num === undefined ? null : block(chain, num + 1, 0, 0)), [chain, num])
  const title = n === undefined ? 'Latest block' : `Block #${n}`
  const body = (() => {
    if (num === undefined || b === null) return <p className="p-4 text-muted">{n === undefined ? 'No blocks.' : `Not found: block ${n}`}</p>
    if (b === undefined) return <p className="p-4 text-muted">Loading…</p>
    const h = b.header
    return (
      <dl className="space-y-3 p-4">
        {n === undefined && <div><dt className="text-text-2">Block</dt><dd className="font-mono">#{num}</dd></div>}
        <div>
          <dt className="text-text-2">Hash</dt>
          <dd className="flex items-start gap-2">
            <span className="min-w-0 break-all font-mono text-xs" title={h.hash}>{h.hash}</span>
            <Button variant="ghost" size="sm" title="Copy hash" onClick={() => navigator.clipboard?.writeText(h.hash)}><CopyIcon /><span className="sr-only">Copy hash</span></Button>
          </dd>
        </div>
        <div><dt className="text-text-2">Timestamp</dt><dd>{new Date(Number(BigInt(h.timestamp)) * 1000).toISOString()}</dd></div>
        <div><dt className="text-text-2">Transactions</dt><dd className="font-mono">{b.txTotal}</dd></div>
        <div><dt className="text-text-2">Parent</dt><dd>{num > 0 ? <Link className={`font-mono ${link}`} to={`/chains/block/${num - 1}`}>Block #{num - 1}</Link> : 'None — genesis block'}</dd></div>
        <div><dt className="text-text-2">Child</dt><dd>{child === undefined ? '…' : child ? <Link className={`font-mono ${link}`} to={`/chains/block/${num + 1}`}>Block #{num + 1}</Link> : 'None — this is the tip'}</dd></div>
        <div>
          <dt className="text-text-2">Transactions · first {Math.min(10, b.txTotal)} of {b.txTotal}</dt>
          <dd>
            <ul className="mt-1 space-y-1">
              {b.txs.map(t => <li key={t.hash}><Link className={`font-mono text-xs ${link}`} title={t.hash} to={`/chains/tx/${t.hash}`}>{short(t.hash)}</Link></li>)}
            </ul>
            {b.txTotal > 0 && <Link className={`mt-2 inline-block ${link}`} to={`/chains/block/${num}/txs`}>All {b.txTotal} transactions →</Link>}
          </dd>
        </div>
      </dl>
    )
  })()
  return <Panel title={title} as="aside" aria-label="Selected block">{body}</Panel>
}
