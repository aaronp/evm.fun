import { priceText, type Level } from '@evmb/orderbook'
import { depthPaths } from '../orderbook/ui'
import { card } from './TakePanel'

/** Cumulative depth: bid and ask step areas around the mid (the dashed centre line). */
export function DepthChart({ bids, asks, quoteDecimals }: { bids: Level[]; asks: Level[]; quoteDecimals: number }) {
  const d = depthPaths(bids, asks)
  return (
    <figure className={`${card} m-0 flex flex-col gap-2 px-[18px] py-4`}>
      <figcaption className="flex items-center justify-between">
        <span className="text-sm font-semibold">Depth</span>
        <span className="flex gap-3.5 text-xs text-text-2">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-bid" />bids</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-ask" />asks</span>
        </span>
      </figcaption>
      <svg role="img" aria-label="Cumulative depth of bids and asks around the mid price" viewBox="0 0 560 220" className="block h-auto w-full">
        <line x1="10" y1="200" x2="550" y2="200" className="stroke-line-strong" />
        <line x1="280" y1="20" x2="280" y2="200" strokeDasharray="3 4" className="stroke-input-line" />
        {d?.bidFill && <path d={d.bidFill} className="fill-bid" fillOpacity={0.14} />}
        {d?.bid && <path d={d.bid} fill="none" strokeWidth={2} className="stroke-bid" />}
        {d?.askFill && <path d={d.askFill} className="fill-ask" fillOpacity={0.14} />}
        {d?.ask && <path d={d.ask} fill="none" strokeWidth={2} className="stroke-ask" />}
        <g className="fill-subtle font-mono" fontSize="11">
          {d && <text x="10" y="216">{priceText(d.lo, quoteDecimals)}</text>}
          <text x="280" y="216" textAnchor="middle">mid</text>
          {d && <text x="550" y="216" textAnchor="end">{priceText(d.hi, quoteDecimals)}</text>}
        </g>
      </svg>
    </figure>
  )
}
