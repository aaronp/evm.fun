import { Link } from 'react-router-dom'
import type { Asset } from '@evmb/assets'
import { priceText, type ActivityItem, type BookRow } from '@evmb/swap'
import { amountText, takenBy } from '../swap/ui'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { card, statusTone } from './TakePanel'

const head = 'border-b border-line px-[18px] py-3.5'
const pill = { taken: 'success', reverted: 'danger', cancelled: 'neutral', offered: 'accent', approved: 'warn' } as const

/** "{account}'s offers" in this pair, newest first, with Cancel on the open ones. */
export function MyOffers({ who, rows, base, name, busy, onCancel }: {
  who: string; rows?: BookRow[]; base: Asset; name(a: string): string; busy: boolean; onCancel(r: BookRow): void
}) {
  return (
    <section aria-labelledby="my-h" className={`${card} flex-[1_1_420px] overflow-hidden`}>
      <div className={head}><h2 id="my-h" className="text-sm font-semibold">{who}’s offers</h2></div>
      {rows?.map(r => {
        const taker = takenBy(r, name)
        return (
          <div key={String(r.id)} className="grid grid-cols-[56px_minmax(0,1fr)_96px_80px] items-center gap-2.5 border-t border-line px-[18px] py-2.5 text-[13px]">
            <span className="font-mono text-subtle">#{String(r.id)}</span>
            <span>{r.side === 'ask' ? 'Sell' : 'Buy'} {amountText(r.base, base.decimals)} {base.symbol} @ {priceText(r.price)}{taker ? ` · taken by ${taker}` : ''}</span>
            <Badge variant={statusTone[r.status]} className="justify-center">{r.status}</Badge>
            {r.status === 'open' && <Button variant="outline" size="chip" className="rounded-[7px]" disabled={busy} onClick={() => onCancel(r)}>Cancel</Button>}
          </div>
        )
      })}
      {rows?.length === 0 && <div className="px-[18px] py-4 text-[13px] text-subtle">No offers yet.</div>}
    </section>
  )
}

/** Swap activity in this pair, newest first; "Report" on takes (success or revert). */
export function Activity({ items, pairQuery = '', text }: { items?: ActivityItem[]; /** `&base=…&quote=…` for Report links */ pairQuery?: string; text(i: ActivityItem): string }) {
  return (
    <section aria-labelledby="ac-h" className={`${card} flex-[1_1_420px] overflow-hidden`}>
      <div className={head}><h2 id="ac-h" className="text-sm font-semibold">Activity</h2></div>
      {items?.map(i => (
        <div key={`${i.tx}:${i.kind}:${i.id ?? i.token}`} className="flex items-center gap-3 border-t border-line px-[18px] py-2.5 text-[13px]">
          <Badge variant={pill[i.kind]} className="w-[76px] flex-none justify-center text-[11px]!">{i.kind}</Badge>
          <span className="min-w-0 flex-1">{text(i)}</span>
          {(i.kind === 'taken' || i.kind === 'reverted') && <Link to={`/swap/report?tx=${i.tx}${pairQuery}`} className="font-medium text-accent hover:text-accent-hover">Report</Link>}
        </div>
      ))}
    </section>
  )
}
