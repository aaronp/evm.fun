import { useState } from 'react'
import { formatUnits } from 'viem'
import { quoteAdd } from '@evmb/pool'
import { amountText, same } from '../swap/ui'
import { orThrow, useWizardAction, useWizardAmountAsset, useWizardField, useWizardMark, withFix } from '../walkthrough/wizard'
import { approveFor, fillOther, minAt, newShareText } from '../pool/form'
import { lpText, poolPriceText } from '../pool/ui'
import { Button } from '../ui/button'
import { solid } from './TakePanel'
import { useRequestFix } from './Shortfall'
import { AmountBox, amountOf, details, label, Problem, row, SlippageRow, step, val, type Outcome, type TabProps } from './PoolSwapTab'

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
  useWizardField('add.base', bt, setBt)
  useWizardField('add.quote', qt, setQt)
  const mark = useWizardMark(), stepToken = useWizardAmountAsset()
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
  const short = (have: bigint | undefined, need: bigint, t: typeof base) => (have !== undefined && have < need ? { asset: t, need, have, text: `Not enough ${t.symbol} — you have ${amountText(have, t.decimals)}.` } : undefined)
  const lack = a ? short(fb.bal, a.baseUsed, base) ?? short(fq.bal, a.quoteUsed, quote) : undefined
  const fix = useRequestFix(lack?.asset, lack?.need ?? 0n, lack?.have ?? 0n)
  const why = 'error' in b ? b.error : 'error' in q ? q.error
    : !a!.shares ? (empty ? 'Too small for a first deposit — raise both amounts.' : 'Too small — this would mint 0 LP shares.')
    : lack?.text
  const ready = why === undefined ? a! : undefined
  const ab = ready ? approveFor(ready.baseUsed, fb.alw) : 0n, aq = ready ? approveFor(ready.quoteUsed, fq.alw) : 0n
  const minShares = ready ? minAt(ready.shares, slip) : 0n
  const unread = !!ready && (fb.alw === undefined || fq.alw === undefined) // no click may skip an Approve we can't see yet

  async function add() {
    if (!ready) { const e = why || 'Enter both amounts.'; setError(e); return e }
    if (unread || ab || aq) { const e = unread ? 'Still reading the allowances — try again.' : 'Approve both tokens first.'; setError(e); return e }
    const e = await onAdd((b as { ok: bigint }).ok, (q as { ok: bigint }).ok, minShares)
    if (!e) { setBt(''); setQt('') }
    return e
  }
  // what Next's approve presses: the token the walkthrough's approve step names, else the first one still needed
  const approving = stepToken ? (same(stepToken, base.address) ? ab && base : same(stepToken, quote.address) ? aq && quote : undefined) : (ab ? base : aq ? quote : undefined)
  useWizardAction('pool.approve', !busy && approving ? () => orThrow(onApprove(approving, approving === base ? ab : aq)) : undefined)
  useWizardAction('pool.add', !busy && !unread && !ab && !aq ? () => orThrow(add().then(e => withFix(e, e === lack?.text ? fix : undefined))) : undefined)
  const approveMark = (t: typeof base) => (approving === t ? mark('pool.approve') : {})
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
      <Problem text={error ?? (bt && qt ? why : undefined)} lack={lack?.text} fix={fix} />
      <div className="flex flex-col gap-2">
        {ab > 0n && <Button {...approveMark(base)} className={step} disabled={busy} onClick={() => onApprove(base, ab)}>{num()}Approve {formatUnits(ab, base.decimals)} {base.symbol}</Button>}
        {aq > 0n && <Button {...approveMark(quote)} className={step} disabled={busy} onClick={() => onApprove(quote, aq)}>{num()}Approve {formatUnits(aq, quote.decimals)} {quote.symbol}</Button>}
        <button {...mark('pool.add')} className={`${solid} min-h-12 bg-bid text-[15px]`} disabled={busy || unread || ab > 0n || aq > 0n || !ready} onClick={add}>{num()}Add liquidity</button>
        {unread && <span className="text-xs text-muted">Pool may spend … {base.symbol} · … {quote.symbol}</span>}
        <span className="text-xs leading-normal text-subtle">Reverts if you would get fewer shares than the minimum.</span>
      </div>
    </div>
  )
}
