import { priceText, type Trade } from '@evmb/orderbook'
import { sizeText } from '../orderbook/ui'
import { card } from './TakePanel'

const cols = 'grid grid-cols-3 px-[18px]'

/** Newest first; price coloured by the taker's side (buy green, sell red). */
export function RecentTrades({ trades, base, quoteDecimals }: { trades?: Trade[]; base: { symbol: string; decimals: number }; quoteDecimals: number }) {
  return (
    <section aria-labelledby="rt-h" className={`${card} flex-1 overflow-hidden`}>
      <div className="border-b border-line px-[18px] py-3.5"><h2 id="rt-h" className="text-sm font-semibold">Recent trades</h2></div>
      <div className={`${cols} py-2 text-[11px] text-subtle`}>
        <span>Price</span><span className="text-right">Size ({base.symbol})</span><span className="text-right">Block</span>
      </div>
      {trades?.map((t, i) => (
        <div key={`${t.tx}:${i}`} className={`${cols} py-[7px] font-mono text-[13px]`}>
          <span className={t.takerSide === 'buy' ? 'text-bid' : 'text-ask'}>{priceText(t.price, quoteDecimals)}</span>
          <span className="text-right">{sizeText(t.amount, base.decimals)}</span>
          <span className="text-right text-subtle">#{String(t.block)}</span>
        </div>
      ))}
      {trades?.length === 0 && <div className="px-[18px] py-3 text-[13px] text-subtle">No trades yet</div>}
    </section>
  )
}
