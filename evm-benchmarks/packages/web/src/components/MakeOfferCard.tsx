import { useEffect, useState } from 'react'
import type { Asset } from '@evmb/assets'
import type { Side, book } from '@evmb/swap'
import { amountText, crosses, exactText, formQuote } from '../swap/ui'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { card, solid, type Funds } from './TakePanel'
import { Shortfall } from './Shortfall'
import { orThrow, useWizardAction, useWizardField, useWizardMark, type Outcome } from '../walkthrough/wizard'

const label = 'text-xs font-medium text-muted'
const input = 'min-h-11 rounded-[10px] px-3 font-mono font-medium'

/** "Make an offer": side, amount and price; approve the exact escrow when short, then create. */
export function MakeOfferCard({ base, quote, book: b, funds, busy, onApprove, onCreate }: {
  base: Asset; quote: Asset; book?: ReturnType<typeof book>; funds: Funds; busy: boolean
  /** resolves to the error message when it failed */
  onApprove(a: Asset, amount: bigint): Outcome | Promise<Outcome>
  /** `made` once the offer exists; `error` when it failed (or its id couldn't be read) */
  onCreate(give: { asset: Asset; amount: bigint }, get: { asset: Asset; amount: bigint }): Promise<{ made: boolean; error?: string }>
}) {
  const [side, setSide] = useState<Side>('ask')
  const [amount, setAmount] = useState('')
  const [price, setPrice] = useState('')
  const [error, setError] = useState<string>()
  useEffect(() => setError(undefined), [base, quote])
  useWizardField('offer.side', side, v => setSide(v as Side))
  useWizardField('offer.amount', amount, setAmount)
  useWizardField('offer.price', price, setPrice)
  const mark = useWizardMark()

  const q = formQuote(side, amount, price, base, quote)
  const ready = 'give' in q ? q : undefined
  const { bal, alw } = ready ? funds(ready.give.asset) : {}
  const needsApprove = !!ready && bal !== undefined && alw !== undefined && bal >= ready.give.amount && alw < ready.give.amount
  const note = ready && b ? crosses(side, price, b) : undefined
  const leg = (l?: { asset: Asset; amount: bigint }) => (l ? `${exactText(l.amount, l.asset.decimals)} ${l.asset.symbol}` : '—')
  const sell = side === 'ask'
  const short = !!ready && bal !== undefined && bal < ready.give.amount

  /** returns the error message when it failed */
  async function create() {
    const fail = (e: string) => (setError(e), e)
    if (!ready) return fail((q as { error: string }).error)
    if (short)
      return fail(`Not enough ${ready.give.asset.symbol} — you have ${amountText(bal, ready.give.asset.decimals)}.`)
    const { made, error } = await onCreate(ready.give, ready.get)
    if (made) { setAmount(''); setPrice(''); setError(undefined) }
    return error
  }
  useWizardAction('offer.approve', needsApprove && !busy ? () => orThrow(onApprove(ready!.give.asset, ready!.give.amount)) : undefined)
  useWizardAction('offer.create', !needsApprove && !busy ? () => orThrow(create()) : undefined)
  const pick = (s: Side) => { setSide(s); setError(undefined) }
  const sideBtn = (s: Side, text: string) => (
    <button aria-pressed={side === s} onClick={() => pick(s)}
      className={`min-h-[38px] rounded-[7px] text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-accent ${side === s ? `${s === 'ask' ? 'bg-ask' : 'bg-bid'} text-on-accent` : 'text-muted hover:text-text'}`}>{text}</button>
  )

  return (
    <section {...mark('offer.card')} aria-labelledby="mk-h" className={`${card} flex flex-[1_1_300px] flex-col gap-3.5 p-[18px]`}>
      <h2 id="mk-h" className="text-sm font-semibold">Make an offer</h2>
      <div role="group" aria-label="Side" {...mark('offer.side')} className="grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-panel p-1">
        {sideBtn('ask', `Sell ${base.symbol}`)}{sideBtn('bid', `Buy ${base.symbol}`)}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1.5"><label htmlFor="fa" className={label}>Amount ({base.symbol})</label>
          <Input id="fa" {...mark('offer.amount')} className={input} value={amount} placeholder="1000.00" onChange={e => { setAmount(e.target.value); setError(undefined) }} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="fp" className={label}>Price ({quote.symbol} per {base.symbol})</label>
          <Input id="fp" {...mark('offer.price')} className={input} value={price} placeholder="1.2700" onChange={e => { setPrice(e.target.value); setError(undefined) }} /></div>
      </div>
      <div className="flex flex-col gap-2 rounded-[10px] bg-panel p-3 text-[13px]">
        <div className="flex justify-between"><span className="text-muted">You escrow now</span><span className="font-mono font-medium">{leg(ready?.give)}</span></div>
        <div className="flex justify-between"><span className="text-muted">You get when taken</span><span className="font-mono">{leg(ready?.get)}</span></div>
      </div>
      {note && <div className="rounded-[10px] border border-warn/40 bg-warn-soft px-3 py-2.5 text-xs leading-normal text-warn-text">{note}</div>}
      {error && (short
        ? <Shortfall asset={ready!.give.asset} need={ready!.give.amount} have={bal!}><span role="alert" className="text-xs text-danger">{error}</span></Shortfall>
        : <span role="alert" className="text-xs text-danger">{error}</span>)}
      <div className="mt-auto flex flex-col gap-2">
        {needsApprove && <Button {...mark('offer.approve')} className="min-h-11 rounded-[10px] text-sm font-semibold" disabled={busy} onClick={() => onApprove(ready!.give.asset, ready!.give.amount)}>1 · Approve {leg(ready?.give)}</Button>}
        <button {...mark('offer.create')} className={`${solid} min-h-12 text-[15px] ${sell ? 'bg-ask' : 'bg-bid'}`} disabled={needsApprove || busy} onClick={create}>
          {needsApprove ? '2 · ' : ''}Create offer &amp; escrow
        </button>
      </div>
    </section>
  )
}
