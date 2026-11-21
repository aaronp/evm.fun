import { Link } from 'react-router-dom'
import { Badge } from '../ui/badge'
import { card } from './TakePanel'

const tone = { add: 'success', remove: 'danger', swap: 'accent' } as const

/** "Pool activity": add / remove / swap rows, newest first, and the pool in the Explorer. */
export function PoolActivity({ rows, explorer }: { rows?: { key: string; kind: 'add' | 'remove' | 'swap'; text: string; lp?: string }[]; explorer?: string }) {
  return (
    <section aria-labelledby="pa-h" className={`${card} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-line px-[18px] py-3.5">
        <h2 id="pa-h" className="text-sm font-semibold">Pool activity</h2>
        {explorer && <Link to={explorer} className="text-[13px] font-medium text-accent hover:text-accent-hover">Explorer →</Link>}
      </div>
      {rows?.map(r => (
        <div key={r.key} className="flex items-center gap-3 border-t border-line px-[18px] py-2.5 font-mono text-xs first:border-t-0">
          <Badge variant={tone[r.kind]} className="w-14 flex-none justify-center font-sans text-[11px]!">{r.kind}</Badge>
          <span className="min-w-0 flex-1 break-words">{r.text}</span>
          {r.lp && <span className="flex-none text-muted">{r.lp}</span>}
        </div>
      ))}
      {rows?.length === 0 && <div className="px-[18px] py-4 text-[13px] text-subtle">No activity yet.</div>}
    </section>
  )
}
