import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Asset } from '@evmb/assets'
import { priceText, type Order } from '@evmb/orderbook'
import { idText, sizeText, statusText } from '../orderbook/ui'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { card } from './TakePanel'
import { orThrow, useWizardAction, useWizardField, useWizardMark } from '../walkthrough/wizard'

const FILTERS = [['all', 'All'], ['open', 'Open'], ['failed', 'Failed']] as const
type Filter = (typeof FILTERS)[number][0]
// the Open filter and Cancel; an unfunded off-chain order is still live and signed: a later allowance would re-fund it
const OPEN: Order['status'][] = ['open', 'partial', 'unfunded']
const TONE = { open: 'accent', partial: 'accent', filled: 'success', cancelled: 'neutral', failed: 'danger', unfunded: 'warn' } as const
const th = 'px-2 py-2.5 font-medium'
const td = 'px-2 py-3'

/** The acting account's orders in this market, newest first: Cancel on live ones (open, partial, unfunded), Report → on the rest. */
export function MyOrders({ orders, base, quote, venue, busy, onCancel }: {
  orders?: Order[]; base: Asset; quote: Asset; venue: 'onchain' | 'offchain'; busy: boolean
  /** resolves to the error message when it failed */
  onCancel(id: string): Promise<string | undefined>
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [target, setTarget] = useState('') // the order Cancel acts on: a walkthrough's cancelOrder fills it
  useWizardField('cancel.order', target, setTarget)
  const mark = useWizardMark()
  const live = orders?.find(o => o.id === target && OPEN.includes(o.status))
  useWizardAction('order.cancel', live && !busy ? () => orThrow(onCancel(live.id)) : undefined)
  const shown = orders && [...orders].reverse().filter(o => filter === 'all' || (filter === 'open' ? OPEN.includes(o.status) : o.status === 'failed'))
  const report = (id: string) => `/trade/report?id=${encodeURIComponent(id)}&venue=${venue}&base=${base.address}&quote=${quote.address}`
  return (
    <section {...mark('orders.card')} aria-labelledby="mo-h" className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-5 py-3.5">
        <h2 id="mo-h" className="text-sm font-semibold">My orders</h2>
        <div role="group" aria-label="Filter" className="flex gap-1 rounded-[10px] border border-line bg-panel p-1">
          {FILTERS.map(([v, t]) => (
            <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)}
              className={`min-h-[30px] rounded-[7px] px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent ${filter === v ? 'bg-selected text-text' : 'text-muted hover:text-text'}`}>{t}</button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className={`${th} pl-5`}>Order</th>
              <th scope="col" className={th}>Side</th>
              <th scope="col" className={`${th} text-right`}>Price</th>
              <th scope="col" className={`${th} text-right`}>Filled / size</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={`${th} pr-5`}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {shown?.map(o => (
              <tr key={o.id} className="border-t border-line hover:bg-surface-hover">
                <td className={`${td} pl-5 font-mono`} title={o.id}>{idText(o.id)}</td>
                <td className={`${td} font-semibold ${o.side === 'buy' ? 'text-bid' : 'text-ask'}`}>{o.side === 'buy' ? 'Buy' : 'Sell'} {base.symbol}</td>
                <td className={`${td} text-right font-mono`}>{priceText(o.price, quote.decimals)}</td>
                <td className={`${td} text-right font-mono`}>{sizeText(o.filled, base.decimals)} / {sizeText(o.amount, base.decimals)}</td>
                <td className={td}><Badge variant={TONE[o.status]}>{statusText(o)}</Badge></td>
                <td className={`${td} pr-5 text-right`}>
                  {OPEN.includes(o.status)
                    ? <Button {...(o === live ? mark('order.cancel') : {})} variant="outline" size="chip" className="rounded-[7px]" disabled={busy} onClick={() => { setTarget(o.id); onCancel(o.id) }}>Cancel</Button>
                    : <Link to={report(o.id)} className="font-medium text-accent hover:text-accent-hover">Report →</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown?.length === 0 && <div className="border-t border-line px-5 py-4 text-[13px] text-subtle">No {filter === 'all' ? '' : `${filter} `}orders yet</div>}
    </section>
  )
}
