import type { Asset } from '@evmb/assets'
import { priceText, type BookRow } from '@evmb/swap'
import { allowText, amountText } from '../swap/ui'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { orThrow, useWizardAction, useWizardMark, type Outcome } from '../walkthrough/wizard'

export const card = 'rounded-2xl border border-line-strong bg-surface'
export const statusTone = { open: 'accent', filled: 'success', cancelled: 'neutral', none: 'neutral' } as const
/** Filled buttons in the ask/bid colours (mockup .btn); add the bg-* class. */
export const solid = 'inline-flex items-center justify-center rounded-[10px] font-semibold text-on-accent hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45'
export type Funds = (a: Asset) => { bal?: bigint; alw?: bigint }

/** ✓ / ✕, or a neutral … while the wallet is still being read */
const mark = (ok?: boolean) => (
  <span aria-hidden="true" className={`flex size-[18px] flex-none items-center justify-center rounded-full text-[11px] font-bold ${ok === undefined ? 'bg-selected text-muted' : ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>{ok === undefined ? '…' : ok ? '✓' : '✕'}</span>
)
const line = 'flex justify-between text-[13px]'
const big = 'font-mono text-base font-semibold'

/** "Take offer #n" for the selected book row: checks, approve, take; the maker's own offer offers Cancel instead. */
export function TakePanel({ row, base, quote, maker, own, funds, busy, onApprove, onTake, onCancel }: {
  row?: BookRow; base: Asset; quote: Asset; maker: string; own: boolean; funds: Funds; busy: boolean
  /** onApprove/onTake resolve to the error message when they failed */
  onApprove(a: Asset, amount: bigint): Outcome | Promise<Outcome>; onTake(): Outcome | Promise<Outcome>; onCancel(): void
}) {
  const wz = useWizardMark()
  const [pay, give] = row?.side === 'ask' ? [quote, base] : [base, quote]
  const payAmt = row?.getAmt ?? 0n, open = row?.status === 'open'
  const { bal, alw } = funds(pay)
  const balShort = bal !== undefined && bal < payAmt
  const alwShort = alw !== undefined && alw < payAmt
  const needsApprove = alwShort && !balShort
  const takeable = open && !own && !busy
  useWizardAction('take.approve', takeable && needsApprove ? () => orThrow(onApprove(pay, payAmt)) : undefined)
  useWizardAction('take.submit', takeable ? () => orThrow(onTake()) : undefined)
  if (!row) return (
    <section {...wz('take.card')} aria-labelledby="tk-h" className={`${card} flex flex-[1_1_300px] flex-col gap-3.5 p-[18px]`}>
      <h2 id="tk-h" className="text-sm font-semibold">Take offer</h2>
      <p className="text-[13px] text-muted">Click an offer to take it.</p>
    </section>
  )
  const payText = `${amountText(payAmt, pay.decimals)} ${pay.symbol}`
  return (
    <section {...wz('take.card')} aria-labelledby="tk-h" className={`${card} flex flex-[1_1_300px] flex-col gap-3.5 p-[18px]`}>
      <div className="flex items-center justify-between">
        <h2 id="tk-h" className="text-sm font-semibold">Take offer <span className="font-mono text-subtle">#{String(row.id)}</span></h2>
        <Badge variant={statusTone[row.status]}>{row.status}</Badge>
      </div>
      <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-panel p-3.5">
        <div className={line}><span className="text-muted">{own ? 'Taker pays you' : 'You pay'}</span><span className={big}>{payText}</span></div>
        <div className={line}><span className="text-muted">{own ? 'Taker receives' : 'You receive'}</span><span className={`${big} text-success-text`}>{amountText(row.giveAmt, give.decimals)} {give.symbol}</span></div>
        <div className={`${line} border-t border-line pt-2.5`}><span className="text-muted">Price</span><span className="font-mono">{priceText(row.price)} {quote.symbol}/{base.symbol}</span></div>
        <div className={line}><span className="text-muted">Maker</span><span>{maker} · escrowed ✓</span></div>
      </div>
      {open && own && <>
        <p className="text-[13px] leading-normal text-text-2">This is your offer. Cancelling returns the escrowed {give.symbol} to your wallet.</p>
        <Button variant="danger-outline" className="min-h-11 rounded-[10px] text-sm font-semibold" disabled={busy} onClick={onCancel}>Cancel offer #{String(row.id)}</Button>
      </>}
      {open && !own && <>
        <ul className="flex flex-col gap-2 text-[13px]">
          <li className="flex gap-2">{mark(bal === undefined ? undefined : !balShort)}<span>{bal === undefined ? `Balance … ${pay.symbol}` : balShort ? `Not enough ${pay.symbol} — you have ${amountText(bal, pay.decimals)}` : `Balance ${amountText(bal, pay.decimals)} ${pay.symbol} covers it`}</span></li>
          <li className="flex gap-2">{mark(alw === undefined ? undefined : !alwShort)}<span>{alw === undefined ? `Swap may spend … ${pay.symbol}` : alwShort ? `Swap may spend ${allowText(alw, pay.decimals)} ${pay.symbol} — needs ${amountText(payAmt, pay.decimals)}` : 'Swap is allowed to spend it'}</span></li>
        </ul>
        <div className="mt-auto flex flex-col gap-2">
          {needsApprove && <Button {...wz('take.approve')} className="min-h-11 rounded-[10px] text-sm font-semibold" disabled={busy} onClick={() => onApprove(pay, payAmt)}>1 · Approve {payText}</Button>}
          {/* always sendable: a short allowance or balance lands a reverted tx whose report explains it */}
          <button {...wz('take.submit')} className={`${solid} min-h-12 bg-bid text-[15px]`} disabled={busy} onClick={onTake}>
            {needsApprove ? '2 · ' : ''}Take #{String(row.id)} · pay {payText}
          </button>
          <span className="text-xs leading-normal text-subtle">One transaction: your {pay.symbol} goes to {maker} and the escrowed {give.symbol} comes to you — or neither happens.</span>
        </div>
      </>}
      {!open && <p className="text-[13px] text-muted">This offer is no longer open.</p>}
    </section>
  )
}
