import { priceText, tickOf, type Level } from '@evmb/orderbook'
import { formatAmount } from '../assets/ui'
import { sizeText } from '../orderbook/ui'
import { card } from './TakePanel'

type Tok = { symbol: string; decimals: number }
const cols = 'grid grid-cols-3'

/** The book: asks (red) above, highest first, the last price and spread, then bids (green); a level click loads its price. */
export function OrderBookPanel({ bids, asks, base, quote, last, spread, onPick }: {
  bids: Level[]; asks: Level[]; base: Tok; quote: Tok; last?: bigint; spread?: bigint | 'crossed'; onPick(price: bigint): void
}) {
  const maxCum = [bids.at(-1)?.total ?? 0n, asks.at(-1)?.total ?? 0n].reduce((m, t) => (t > m ? t : m))
  const row = (side: 'ask' | 'bid') => (l: Level) => (
    <button key={String(l.price)} type="button" onClick={() => onPick(l.price)}
      className={`${cols} relative min-h-[30px] items-center px-4 text-left font-mono text-[13px] text-text hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent`}>
      <span aria-hidden="true" className={`absolute top-0.5 right-0 bottom-0.5 ${side === 'ask' ? 'bg-ask/10' : 'bg-bid/10'}`}
        style={{ width: `${maxCum ? Number((l.total * 1000n) / maxCum) / 10 : 0}%` }} />
      <span className={`relative ${side === 'ask' ? 'text-ask' : 'text-bid'}`}>{priceText(l.price, quote.decimals)}</span>
      <span className="relative text-right">{sizeText(l.size, base.decimals)}</span>
      <span className="relative text-right text-muted">{sizeText(l.total, base.decimals)}</span>
    </button>
  )
  return (
    <section aria-labelledby="ob-h" className={`${card} flex max-w-[360px] flex-[1_1_300px] flex-col overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
        <h2 id="ob-h" className="text-sm font-semibold">Order book</h2>
        <span className="font-mono text-[11px] text-subtle">tick {formatAmount(tickOf(quote.decimals), quote.decimals, 4)}</span>
      </div>
      <div className={`${cols} px-4 py-2 text-[11px] text-subtle`}>
        <span>Price ({quote.symbol})</span><span className="text-right">Size ({base.symbol})</span><span className="text-right">Total</span>
      </div>
      {[...asks].reverse().map(row('ask'))}
      <div className="my-1 flex items-center justify-between border-y border-line bg-panel px-4 py-2.5">
        <span className="font-mono text-base font-semibold text-bid">{last === undefined ? '—' : priceText(last, quote.decimals)}</span>
        <span className="text-xs text-subtle">{spread === 'crossed' ? 'crossed' : `spread ${spread === undefined ? '—' : priceText(spread, quote.decimals)}`}</span>
      </div>
      {bids.map(row('bid'))}
      <span className="mt-auto px-4 py-2.5 text-xs text-subtle">Click a level to load its price</span>
    </section>
  )
}
