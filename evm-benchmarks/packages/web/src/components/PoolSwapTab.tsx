import { useEffect, useState, type ReactNode } from 'react'
import { formatUnits } from 'viem'
import type { Asset } from '@evmb/assets'
import { quoteSwap, type PoolState } from '@evmb/pool'
import { parseAmount } from '../assets/ui'
import { amountText } from '../swap/ui'
import { approveFor, SLIPPAGES, swapAfter } from '../pool/form'
import { poolPriceText } from '../pool/ui'
import { Button } from '../ui/button'
import { solid, type Funds } from './TakePanel'

export type Outcome = Promise<string | undefined>
export type TabProps = {
  s: PoolState; base: Asset; quote: Asset; funds: Funds; busy: boolean; slip: number; setSlip(bps: number): void
  /** each handler resolves to the page's error message when it failed */
  onApprove(a: Asset, amount: bigint): Outcome
}

export const label = 'text-xs font-medium text-muted'
export const details = 'flex flex-col gap-2 rounded-xl border border-line bg-panel p-3 text-[13px]'
export const row = 'flex items-center justify-between gap-2'
export const val = 'font-mono font-medium text-text'
export const step = 'min-h-11 rounded-[10px] text-sm font-semibold'

/** An amount box: the input (or a read-only value) with the token symbol at the right. */
export function AmountBox({ id, value, onChange, symbol, children }: { id?: string; value?: string; onChange?(v: string): void; symbol: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-2 rounded-xl border border-line bg-panel px-3.5">
      {children ?? <input id={id} inputMode="decimal" autoComplete="off" placeholder="0" value={value} onChange={e => onChange!(e.target.value)}
        className="min-w-0 flex-1 bg-transparent font-mono text-lg font-semibold text-text outline-none placeholder:text-subtle" />}
      <span className="font-mono text-sm font-semibold text-text">{symbol}</span>
    </div>
  )
}

/** "Slippage tolerance" with the 0.1% / 0.5% / 1% chips. */
export function SlippageRow({ slip, setSlip }: { slip: number; setSlip(bps: number): void }) {
  return (
    <div className={row}>
      <span className="text-muted">Slippage tolerance</span>
      <div role="group" aria-label="Slippage tolerance" className="flex gap-1.5">
        {SLIPPAGES.map(([bps, text]) => (
          <button key={bps} aria-pressed={slip === bps} onClick={() => setSlip(bps)}
            className={`min-h-8 rounded-[7px] border px-2.5 font-mono text-xs focus-visible:outline-2 focus-visible:outline-accent ${slip === bps ? 'border-accent bg-selected text-text' : 'border-line text-muted hover:text-text'}`}>{text}</button>
        ))}
      </div>
    </div>
  )
}

/** Parsed `text`, or the reason it can't be used ('' while empty). */
export function amountOf(text: string, decimals: number): { ok: bigint } | { error: string } {
  if (!text.trim()) return { error: '' }
  const a = parseAmount(text, decimals)
  return 'ok' in a && a.ok === 0n ? { error: 'Enter an amount above 0.' } : a
}

/** Swap tab (the mockup): pay one side, receive the other at the pool's quote; feeds the curve's "after this swap". */
export function PoolSwapTab({ s, base, quote, funds, busy, slip, setSlip, onApprove, onSwap, onAfter }: TabProps & {
  onSwap(tokenIn: Asset, amountIn: bigint, minOut: bigint): Outcome
  onAfter(r?: Pick<PoolState, 'reserveBase' | 'reserveQuote'>): void
}) {
  const [payBase, setPayBase] = useState(true)
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const [pay, get] = payBase ? [base, quote] : [quote, base]
  const a = amountOf(text, pay.decimals)
  const amt = 'ok' in a ? a.ok : 0n
  const q = amt ? quoteSwap(s, pay.address as `0x${string}`, amt, slip) : undefined
  const { bal, alw } = funds(pay)
  const why = 'error' in a ? a.error
    : !q?.out ? `You would receive 0 ${get.symbol} — raise the amount.`
    : bal !== undefined && bal < amt ? `Not enough ${pay.symbol} — you have ${amountText(bal, pay.decimals)}.` : undefined
  const approve = why === undefined ? approveFor(amt, alw) : 0n
  const unread = why === undefined && alw === undefined // no click may skip an Approve we can't see yet
  const after = q?.out ? swapAfter(s, payBase, amt, q.out) : undefined
  useEffect(() => { onAfter(after) }, [after?.reserveBase, after?.reserveQuote]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onAfter(undefined), []) // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (v: string) => { setText(v); setError(undefined) }
  async function swap() {
    if (why !== undefined) { const e = why || 'Enter an amount.'; setError(e); return e }
    if (unread || approve > 0n) { const e = unread ? 'Still reading the allowance — try again.' : `Approve ${pay.symbol} first.`; setError(e); return e }
    const e = await onSwap(pay, amt, q!.minOut)
    if (!e) setText('')
    return e
  }
  // your price in quote per base whichever side you pay: the exact rational of the two amounts
  const yourPrice = q?.out ? poolPriceText({ ...s, ...(payBase ? { reserveBase: amt, reserveQuote: q.out } : { reserveBase: q.out, reserveQuote: amt }) }) : '—'
  const payText = `${amountText(amt, pay.decimals)} ${pay.symbol}`
  const dash = (v?: string) => v ?? '—'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pl-pay" className={label}>You pay</label>
        <AmountBox id="pl-pay" value={text} onChange={edit} symbol={pay.symbol} />
        <span className="text-xs text-muted">Balance {bal === undefined ? '…' : amountText(bal, pay.decimals)} {pay.symbol}</span>
      </div>
      <button aria-label="Flip: pay the other token" title="Flip" onClick={() => { setPayBase(p => !p); setError(undefined) }}
        className="mx-auto flex size-9 items-center justify-center rounded-full border border-line-strong text-text-2 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent">↓↑</button>
      <div className="flex flex-col gap-1.5">
        <span className={label}>You receive (estimate)</span>
        <AmountBox symbol={get.symbol}><output className="flex-1 font-mono text-lg font-semibold text-success-text">{q?.out ? amountText(q.out, get.decimals) : '—'}</output></AmountBox>
      </div>
      <div className={details}>
        <div className={row}><span className="text-muted">Your price</span><span className={val}>{yourPrice} {quote.symbol}/{base.symbol}</span></div>
        <div className={row}><span className="text-muted">Price impact</span><span className={val}>{q?.out ? `${(q.impactBps / 100).toFixed(2)}%` : '—'}</span></div>
        <div className={row}><span className="text-muted">Fee (0.30%)</span><span className={val}>{q ? `${amountText(q.fee, pay.decimals)} ${pay.symbol}` : '—'}</span></div>
        <SlippageRow slip={slip} setSlip={setSlip} />
        <div className={`${row} border-t border-line pt-2`}><span className="text-muted">Minimum received</span><span className={val}>{dash(q?.out ? `${amountText(q.minOut, get.decimals)} ${get.symbol}` : undefined)}</span></div>
      </div>
      {(error ?? (text && why)) && <span role="alert" className="text-xs text-danger">{error ?? why}</span>}
      <div className="flex flex-col gap-2">
        {approve > 0n && <Button className={step} disabled={busy} onClick={() => onApprove(pay, approve)}>1 · Approve {formatUnits(approve, pay.decimals)} {pay.symbol}</Button>}
        <button className={`${solid} min-h-12 bg-bid text-[15px]`} disabled={busy || unread || approve > 0n || why !== undefined} onClick={swap}>
          {approve > 0n ? '2 · ' : ''}Swap {amt ? payText : pay.symbol}
        </button>
        {unread && <span className="text-xs text-muted">Pool may spend … {pay.symbol}</span>}
        <span className="text-xs leading-normal text-subtle">Reverts if you would get less than the minimum — e.g. if someone else trades first and moves the price.</span>
      </div>
    </div>
  )
}
