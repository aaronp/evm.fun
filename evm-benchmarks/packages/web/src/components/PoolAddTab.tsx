import { useState } from 'react'
import { formatUnits } from 'viem'
import { quoteAdd } from '@evmb/pool'
import { amountText } from '../swap/ui'
import { approveFor, fillOther, minAt, newShareText } from '../pool/form'
import { lpText, poolPriceText } from '../pool/ui'
import { Button } from '../ui/button'
import { solid } from './TakePanel'
import { AmountBox, amountOf, details, label, row, SlippageRow, step, val, type Outcome, type TabProps } from './PoolSwapTab'

/** Add liquidity: both amounts; with liquidity, typing one fills the other at the pool ratio (an empty pool takes both
 * as given and shows the initial price they set). */
export function PoolAddTab({ s, base, quote, funds, busy, slip, setSlip, mine, onApprove, onAdd }: TabProps & {
  /** your LP shares now (undefined while read) */
  mine?: bigint
  /** amounts in the page's order */
  onAdd(baseIn: bigint, quoteIn: bigint, minShares: bigint): Outcome
}) {
  const [bt, setBt] = useState('')
  const [qt, setQt] = useState('')
  const [error, setError] = useState<string>()
  const empty = !s.totalShares
  const b = amountOf(bt, base.decimals), q = amountOf(qt, quote.decimals)
  const edit = (side: 'base' | 'quote', v: string) => {
    setError(undefined)
    const [set, other, t, o] = side === 'base' ? [setBt, setQt, base, quote] : [setQt, setBt, quote, base]
    set(v)
    if (empty) return
    const a = amountOf(v, t.decimals)
    other('ok' in a ? formatUnits(fillOther(s, side, a.ok), o.decimals) : '')
  }
  const ok = 'ok' in b && 'ok' in q
  const a = ok ? quoteAdd(s, b.ok, q.ok) : undefined
  const fb = funds(base), fq = funds(quote)
  const short = (have: bigint | undefined, need: bigint, t: typeof base) => (have !== undefined && have < need ? `Not enough ${t.symbol} — you have ${amountText(have, t.decimals)}.` : undefined)
  const why = 'error' in b ? b.error : 'error' in q ? q.error
    : !a!.shares ? (empty ? 'Too small for a first deposit — raise both amounts.' : 'Too small — this would mint 0 LP shares.')
    : short(fb.bal, a!.baseUsed, base) ?? short(fq.bal, a!.quoteUsed, quote)
  const ready = why === undefined ? a! : undefined
  const ab = ready ? approveFor(ready.baseUsed, fb.alw) : 0n, aq = ready ? approveFor(ready.quoteUsed, fq.alw) : 0n
  const minShares = ready ? minAt(ready.shares, slip) : 0n

  async function add() {
    if (!ready) { const e = why || 'Enter both amounts.'; setError(e); return e }
    const e = await onAdd((b as { ok: bigint }).ok, (q as { ok: bigint }).ok, minShares)
    if (!e) { setBt(''); setQt('') }
    return e
  }
  let n = 0
  const num = () => (ab || aq ? `${++n} · ` : '')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pl-add-b" className={label}>{base.symbol} to add</label>
        <AmountBox id="pl-add-b" value={bt} onChange={v => edit('base', v)} symbol={base.symbol} />
        <span className="text-xs text-muted">Balance {fb.bal === undefined ? '…' : amountText(fb.bal, base.decimals)} {base.symbol}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pl-add-q" className={label}>{quote.symbol} to add</label>
        <AmountBox id="pl-add-q" value={qt} onChange={v => edit('quote', v)} symbol={quote.symbol} />
        <span className="text-xs text-muted">Balance {fq.bal === undefined ? '…' : amountText(fq.bal, quote.decimals)} {quote.symbol}</span>
      </div>
      <div className={details}>
        {empty && <div className={row}><span className="text-muted">Initial price</span><span className={val}>{ok && b.ok && q.ok ? `${poolPriceText({ ...s, reserveBase: b.ok, reserveQuote: q.ok })} ${quote.symbol}/${base.symbol}` : '—'}</span></div>}
        <div className={row}><span className="text-muted">Shares you'd get</span><span className={val}>{ready ? `${lpText(ready.shares)} LP` : '—'}</span></div>
        <div className={row}><span className="text-muted">Your new share</span><span className={val}>{ready && mine !== undefined ? newShareText(s, mine, ready.shares) : '—'}</span></div>
        <SlippageRow slip={slip} setSlip={setSlip} />
        <div className={`${row} border-t border-line pt-2`}><span className="text-muted">Minimum shares</span><span className={val}>{ready ? `${lpText(minShares)} LP` : '—'}</span></div>
      </div>
      {empty && <p className="text-xs leading-normal text-muted">First deposit: the two amounts set the pool's price. 1,000 of the minted shares are locked forever.</p>}
      {(error ?? (bt && qt && why)) && <span role="alert" className="text-xs text-danger">{error ?? why}</span>}
      <div className="flex flex-col gap-2">
        {ab > 0n && <Button className={step} disabled={busy} onClick={() => onApprove(base, ab)}>{num()}Approve {formatUnits(ab, base.decimals)} {base.symbol}</Button>}
        {aq > 0n && <Button className={step} disabled={busy} onClick={() => onApprove(quote, aq)}>{num()}Approve {formatUnits(aq, quote.decimals)} {quote.symbol}</Button>}
        <button className={`${solid} min-h-12 bg-bid text-[15px]`} disabled={busy || ab > 0n || aq > 0n || !ready} onClick={add}>{num()}Add liquidity</button>
        <span className="text-xs leading-normal text-subtle">Reverts if you would get fewer shares than the minimum.</span>
      </div>
    </div>
  )
}
