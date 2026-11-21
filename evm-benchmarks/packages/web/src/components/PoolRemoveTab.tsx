import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { quoteRemove } from '@evmb/pool'
import { amountText } from '../swap/ui'
import { minAt, percentOf } from '../pool/form'
import { lpText } from '../pool/ui'
import { AmountBox, amountOf, details, label, row, SlippageRow, val, type Outcome, type TabProps } from './PoolSwapTab'
import { solid } from './TakePanel'
import { orThrow, useWizardAction, useWizardField, useWizardMark } from '../walkthrough/wizard'

/** Remove: a percentage of your shares (or an amount), what you get back, minimums at the slippage tolerance. */
export function PoolRemoveTab({ s, base, quote, busy, slip, setSlip, mine, onRemove }: Omit<TabProps, 'funds' | 'onApprove'> & {
  mine?: bigint
  /** minimums in the page's order */
  onRemove(shares: bigint, minBase: bigint, minQuote: bigint): Outcome
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const [pct, setPct] = useState('') // the chip picked ('' after typing): the walkthrough's remove.percent
  useWizardField('remove.percent', pct, setPct)
  const mark = useWizardMark()
  useEffect(() => { const p = Number(pct); if (Number.isInteger(p) && p > 0 && p <= 100 && mine) { setText(formatUnits(percentOf(mine, p), 18)); setError(undefined) } }, [pct, mine])
  const a = amountOf(text, 18)
  const shares = 'ok' in a ? a.ok : 0n
  const why = mine === undefined ? 'Reading your shares…' : !mine ? 'You have no shares in this pool.'
    : 'error' in a ? a.error || 'Enter the shares to remove.'
    : shares > mine ? `You have only ${lpText(mine)} LP.` : undefined
  const out = why === undefined ? quoteRemove(s, shares) : undefined
  const mins = out && { base: minAt(out.base, slip), quote: minAt(out.quote, slip) }
  const edit = (v: string) => { setText(v); setError(undefined) }

  async function remove() {
    if (!mins) { setError(why); return why }
    const e = await onRemove(shares, mins.base, mins.quote)
    if (!e) setText('')
    return e
  }
  useWizardAction('pool.remove', !busy && mins ? () => orThrow(remove()) : undefined)
  const both = (b?: bigint, q?: bigint) => (b === undefined || q === undefined ? '—'
    : <span className="flex flex-col items-end"><span>{amountText(b, base.decimals)} {base.symbol}</span><span>{amountText(q, quote.decimals)} {quote.symbol}</span></span>)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pl-rm" className={label}>Shares to remove</label>
        <AmountBox id="pl-rm" value={text} onChange={v => { setPct(''); edit(v) }} symbol="LP" />
        <span className="text-xs text-muted">You have {mine === undefined ? '…' : lpText(mine)} LP</span>
      </div>
      <div role="group" aria-label="Share of your position" className="grid grid-cols-4 gap-1.5">
        {[25, 50, 75, 100].map(p => (
          <button key={p} disabled={!mine} aria-pressed={pct === String(p)} onClick={() => { setPct(String(p)); edit(formatUnits(percentOf(mine!, p), 18)) }}
            className="min-h-9 rounded-[7px] border border-line font-mono text-xs text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-45">{p === 100 ? 'Max' : `${p}%`}</button>
        ))}
      </div>
      <div className={details}>
        <div className={row}><span className="text-muted">You receive</span><span className="font-mono font-medium text-success-text">{both(out?.base, out?.quote)}</span></div>
        <SlippageRow slip={slip} setSlip={setSlip} />
        <div className={`${row} border-t border-line pt-2`}><span className="text-muted">Minimum received</span><span className={val}>{both(mins?.base, mins?.quote)}</span></div>
      </div>
      {(error ?? (text && why)) && <span role="alert" className="text-xs text-danger">{error ?? why}</span>}
      <div className="flex flex-col gap-2">
        <span title={why} className="flex flex-col">
          <button {...mark('pool.remove')} className={`${solid} min-h-12 bg-ask text-[15px]`} disabled={busy || !mins} onClick={remove}>Remove liquidity</button>
        </span>
        {why && !text && <span className="text-xs text-muted">{why}</span>}
        <span className="text-xs leading-normal text-subtle">Reverts if either amount would come out below its minimum.</span>
      </div>
    </div>
  )
}
