import { useState } from 'react'
import type { Asset } from '@evmb/assets'
import type { PoolState } from '@evmb/pool'
import { DEFAULT_SLIPPAGE } from '../pool/form'
import { PoolAddTab } from './PoolAddTab'
import { PoolRemoveTab } from './PoolRemoveTab'
import { PoolSwapTab, type Outcome } from './PoolSwapTab'
import { card, type Funds } from './TakePanel'

type Tab = 'swap' | 'add' | 'remove'
const NAMES: Record<Tab, string> = { swap: 'Swap', add: 'Add liquidity', remove: 'Remove' }

/** The Swap / Add liquidity / Remove card. An empty pool offers only Add liquidity. One slippage tolerance serves all three. */
export function PoolTabs({ s, base, quote, funds, busy, mine, onApprove, onSwap, onAdd, onRemove, onAfter }: {
  s: PoolState; base: Asset; quote: Asset; funds: Funds; busy: boolean; mine?: bigint
  /** each resolves to the page's error message when it failed */
  onApprove(a: Asset, amount: bigint): Outcome
  onSwap(tokenIn: Asset, amountIn: bigint, minOut: bigint): Outcome
  onAdd(baseIn: bigint, quoteIn: bigint, minShares: bigint): Outcome
  onRemove(shares: bigint, minBase: bigint, minQuote: bigint): Outcome
  onAfter(r?: Pick<PoolState, 'reserveBase' | 'reserveQuote'>): void
}) {
  const [picked, setTab] = useState<Tab>('swap')
  const [slip, setSlip] = useState(DEFAULT_SLIPPAGE)
  const tabs: Tab[] = s.totalShares ? ['swap', 'add', 'remove'] : ['add']
  const tab = tabs.includes(picked) ? picked : tabs[0]!
  const common = { s, base, quote, funds, busy, slip, setSlip, onApprove }
  return (
    <section aria-label="Swap, add or remove liquidity" className={`${card} flex flex-col gap-4 p-[18px]`}>
      <div role="tablist" aria-label="Pool action" className={`grid gap-1 rounded-[10px] border border-line bg-panel p-1 ${tabs.length > 1 ? 'grid-cols-3' : 'grid-cols-1'}`}>
        {tabs.map(t => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`min-h-[38px] rounded-[7px] text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-accent ${tab === t ? 'bg-selected text-text' : 'text-muted hover:text-text'}`}>{NAMES[t]}</button>
        ))}
      </div>
      {tab === 'swap' && <PoolSwapTab {...common} onSwap={onSwap} onAfter={onAfter} />}
      {tab === 'add' && <PoolAddTab {...common} mine={mine} onAdd={onAdd} />}
      {tab === 'remove' && <PoolRemoveTab {...common} mine={mine} onRemove={onRemove} />}
    </section>
  )
}
