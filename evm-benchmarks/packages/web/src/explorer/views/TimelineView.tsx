import { useNavigate } from 'react-router-dom'
import { markRadius, ticks as tickValues, timelineLayout } from '../timeline'
import { blockMatches, windowContains, type Header } from '../window'
import { Panel } from '../../ui/panel'
import { ViewToggle } from '../ViewToggle'

const W = 720, H = 120, Y = 50, AXIS = 100

const iso = (s: number) => new Date(s * 1000).toISOString().replace('.000Z', 'Z')

/** The window's blocks placed by timestamp on one row; mark size = tx count. */
export function TimelineView({ q, headers, total, selected, loading }: { q: string; headers: Header[]; total: number; selected?: number; loading: boolean }) {
  const nav = useNavigate()
  const go = (n: number) => nav(`/chains/block/${n}`)
  let body
  if (!headers.length) body = <p className="p-4 text-sm text-muted">{loading ? 'Loading…' : 'No blocks.'}</p>
  else {
    const { mode, x: X } = timelineLayout(headers, W)
    const ts = headers.map(h => h.timestamp)
    const lo = Math.min(...ts), hi = Math.max(...ts)
    const nums = headers.map(h => h.number)
    const idx = mode === 'index'
    // ticks: [label, x]; index mode labels block numbers, time mode labels times
    const ticks: [string, number][] = idx
      ? tickValues(Math.min(...nums), Math.max(...nums)).map(n => [String(n), X({ number: n } as Header)])
      : tickValues(lo, hi).map(t => [iso(t), X({ timestamp: t } as Header)])
    const maxTx = Math.max(...headers.map(h => h.txCount))
    const filtering = q.trim() !== ''
    const old = selected !== undefined && !windowContains(headers, selected)
    body = (
      <div className="space-y-2 p-4">
        <p className="text-xs text-muted">
          Latest {headers.length} of {total} blocks{old && ` · Block #${selected} is older than the latest 500 shown`}{idx && ' · Blocks share timestamps — spaced by block number'}
        </p>
        <div className="overflow-x-auto">
          <svg role="img" viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]"
            aria-label={`Timeline of the latest ${headers.length} of ${total} blocks, ${iso(lo)} to ${iso(hi)}; mark size shows transaction count`}>
            <line x1={0} x2={W} y1={AXIS} y2={AXIS} className="stroke-line-strong" strokeWidth={1} />
            {ticks.map(([label, tx]) => (
              <g key={label}>
                <line x1={tx} x2={tx} y1={AXIS} y2={AXIS + 4} className="stroke-line-strong" strokeWidth={1} />
                <text x={tx} y={AXIS + 16} textAnchor={tx < 60 ? 'start' : tx > W - 60 ? 'end' : 'middle'} className="fill-muted text-[10px]">{label}</text>
              </g>
            ))}
            {[...headers.filter(b => b.number !== selected), ...headers.filter(b => b.number === selected)].map(b => {
              const hit = blockMatches(b, q)
              const r = markRadius(b.txCount, maxTx)
              return (
                <g key={b.number} className="cursor-pointer" onClick={() => go(b.number)}>
                  <title>{`#${b.number} · ${b.txCount} txs · ${iso(b.timestamp)}`}</title>
                  <circle cx={X(b)} cy={Y} r={r} opacity={hit ? 1 : 0.25} className={`fill-accent ${filtering && hit ? 'stroke-text' : 'stroke-surface'}`} strokeWidth={filtering && hit ? 2 : 1} />
                  {b.number === selected && <circle cx={X(b)} cy={Y} r={r + 4} fill="none" className="stroke-text" strokeWidth={2} />}
                </g>
              )
            })}
          </svg>
        </div>
      </div>
    )
  }
  return <Panel title="Timeline" actions={<ViewToggle />}>{body}</Panel>
}
