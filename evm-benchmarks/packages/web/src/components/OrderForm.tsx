import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import type { Asset } from '@evmb/assets'
import { amountText, parsePrice, priceText, type Level, type OrderInput, type Side } from '@evmb/orderbook'
import { formatAmount, parseAmount } from '../assets/ui'
import { allowanceNote, approveFor, percentAmount, plan, priceAway, slippageOf, submitText } from '../orderbook/form'
import { card, solid } from './TakePanel'
import { venueName, type VenueKind } from '../orderbook/locate'

export type Funds = { bal?: bigint; alw?: bigint }
type Outcome = string | undefined

const label = 'text-xs font-medium text-muted'
const box = 'flex min-h-11 items-center rounded-[10px] border border-input-line bg-panel px-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent'
const field = 'min-h-10 min-w-0 flex-1 border-0 bg-transparent font-mono text-[15px] font-medium text-text outline-none'
const suffix = 'text-xs text-subtle'
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The order form: side, Limit/Market, price (or slippage), amount with 25/50/75/Max of what's available, the cost,
 * the allowance warning with "Approve more", and the submit button. */
export function OrderForm({ base, quote, book, venue, funds, picked, busy, onApprove, onPlace }: {
  base: Asset; quote: Asset; book?: { bids: Level[]; asks: Level[] }
  /** on-chain (OrderBook: market orders carry a slippage-bounded worst price) or off-chain (Settlement: fills settle at
   * the makers' prices, no slippage); also names the contract the give asset is approved to */
  venue: VenueKind
  funds: { base: Funds; quote: Funds }
  /** a clicked book level: loads its price */
  picked?: { price: bigint }
  busy: boolean
  /** resolves to the error message when it failed */
  onApprove(a: Asset, amount: bigint): Promise<Outcome>
  /** `placed` once a tx landed (or the order was signed); `error` when it failed or reverted */
  onPlace(o: Omit<OrderInput, 'market'>): Promise<{ placed: boolean; error?: string }>
}) {
  const [side, setSide] = useState<Side>('buy')
  const [type, setType] = useState<'limit' | 'market'>('limit')
  const [priceIn, setPriceIn] = useState('')
  const [amountIn, setAmountIn] = useState('')
  const [slipIn, setSlipIn] = useState('1')
  const [error, setError] = useState<string>()
  useEffect(() => setError(undefined), [base, quote])
  useEffect(() => { if (picked) { setPriceIn(priceText(picked.price, quote.decimals)); setType('limit'); setError(undefined) } }, [picked]) // eslint-disable-line react-hooks/exhaustive-deps

  const buy = side === 'buy'
  const parsed = parseAmount(amountIn.replace(/,/g, ''), base.decimals)
  const amount = 'ok' in parsed && parsed.ok > 0n ? parsed.ok : undefined
  let price: bigint | undefined, priceErr: string | undefined
  if (type === 'limit' && priceIn.trim()) try { price = parsePrice(priceIn, quote.decimals) } catch (e) { priceErr = msg(e) }
  const onchain = venue === 'onchain', spender = venueName(venue)
  const slip = onchain ? slippageOf(slipIn) : 0 // off-chain settles at the makers' prices: slippage doesn't apply
  const bps = typeof slip === 'number' ? slip : undefined
  const levels = (buy ? book?.asks : book?.bids) ?? []
  const shape = { side, type, price, slippageBps: bps ?? 100 }
  const p = amount && (type === 'market' ? bps !== undefined : price !== undefined) ? plan({ ...shape, amount }, levels, base.decimals, venue) : undefined
  const give = buy ? quote : base, f = buy ? funds.quote : funds.base
  const toApprove = p?.need !== undefined && f.alw !== undefined ? approveFor(p.need, f.alw) : undefined
  const thin = p?.thin ? `Book too thin: only ${amountText(p.filled, base)} of ${amountText(amount!, base)} can fill` : undefined
  const total = !p || p.bound === undefined ? '—'
    : type === 'limit' ? amountText(p.bound, quote)
    : `≈ ${formatAmount(p.estimate, quote.decimals, 2)}, ${buy ? 'at most' : 'at least'} ${amountText(p.bound, quote)}`

  /** returns the error message when it failed */
  async function submit(): Promise<Outcome> {
    const fail = (e: string) => (setError(e), e)
    if (!amount) return fail('error' in parsed ? parsed.error : 'Amount must be above zero')
    if (type === 'limit' && price === undefined) return fail(priceErr ?? 'Enter a limit price')
    if (typeof slip !== 'number') return fail(slip.error)
    if (thin) return fail(thin)
    setError(undefined)
    const { placed, error } = await onPlace({ side, type, amount, ...(type === 'limit' ? { price } : onchain ? { slippageBps: slip } : {}) })
    if (placed) setAmountIn('')
    else if (error) setError(error)
    return error
  }
  /** returns the error message when it failed */
  async function approve(): Promise<Outcome> {
    if (toApprove === undefined) return
    const e = await onApprove(give, toApprove)
    setError(e)
    return e
  }
  function percent(pct: number) {
    if (f.bal === undefined) return
    if (buy && type === 'limit' && price === undefined) return setError(priceErr ?? 'Enter a limit price')
    const v = percentAmount(pct, shape, f.bal, levels, base.decimals, venue)
    setAmountIn(v ? formatUnits(v, base.decimals) : ''); setError(undefined)
  }
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); setError(undefined) }
  const sideBtn = (s: Side) => (
    <button type="button" aria-pressed={side === s} onClick={() => { setSide(s); setError(undefined) }}
      className={`min-h-10 rounded-[7px] text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent ${side === s ? `${s === 'buy' ? 'bg-bid' : 'bg-ask'} text-on-accent` : 'text-muted hover:text-text'}`}>
      {s === 'buy' ? 'Buy' : 'Sell'} {base.symbol}
    </button>
  )
  const typeBtn = (t: 'limit' | 'market', text: string) => (
    <button type="button" aria-pressed={type === t} onClick={() => { setType(t); setError(undefined) }}
      className={`min-h-8 border-b-2 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-accent ${type === t ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}`}>{text}</button>
  )
  const row = (k: string, v: string, strong = false) => (
    <div className="flex justify-between gap-3"><span className="text-muted">{k}</span><span className={`text-right font-mono ${strong ? 'font-medium' : ''}`}>{v}</span></div>
  )

  return (
    <section aria-labelledby="of-h" className={`${card} flex max-w-[340px] flex-[1_1_300px] flex-col gap-3.5 p-[18px]`}>
      <h2 id="of-h" className="sr-only">Place order</h2>
      <div role="group" aria-label="Side" className="grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-panel p-1">{sideBtn('buy')}{sideBtn('sell')}</div>
      <div role="group" aria-label="Order type" className="flex gap-4">{typeBtn('limit', 'Limit')}{typeBtn('market', 'Market')}</div>
      {type === 'limit' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="op" className={label}>Limit price</label>
          <div className={box}><input id="op" className={field} inputMode="decimal" value={priceIn} placeholder={priceText(levels[0]?.price ?? 0n, quote.decimals)} onChange={edit(setPriceIn)} /><span className={suffix}>{quote.symbol}</span></div>
        </div>
      ) : onchain && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="os" className={label}>Slippage</label>
          <div className={box}><input id="os" className={field} inputMode="decimal" value={slipIn} onChange={edit(setSlipIn)} /><span className={suffix}>%</span></div>
          {p?.price !== undefined && <span className="text-xs text-subtle">Fills no worse than {priceAway(p.price, side, quote.decimals)} {quote.symbol}</span>}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="oa" className={label}>Amount</label>
        <div className={box}><input id="oa" className={field} inputMode="decimal" value={amountIn} placeholder="0" onChange={edit(setAmountIn)} /><span className={suffix}>{base.symbol}</span></div>
        <div className="grid grid-cols-4 gap-1.5">
          {([[25, '25%'], [50, '50%'], [75, '75%'], [100, 'Max']] as const).map(([n, t]) => (
            <button key={n} type="button" disabled={f.bal === undefined} onClick={() => percent(n)}
              className="min-h-8 rounded-[7px] border border-line text-xs font-medium text-muted hover:bg-selected focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-45">{t}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-[10px] bg-panel p-3 text-[13px]">
        {row(buy ? 'You pay' : 'You receive', total, true)}
        {row('Available', f.bal === undefined ? '—' : amountText(f.bal, give))}
      </div>
      {toApprove !== undefined && (
        <div className="flex gap-2.5 rounded-[10px] border border-warn/40 bg-warn-soft p-3 text-[13px] leading-[1.45] text-warn-text">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 flex-none text-warn"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
          <span>
            {allowanceNote(spender, f.alw!, p!.need!, give)}{' '}
            <button type="button" disabled={busy} onClick={approve} className="font-semibold underline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-45">Approve more</button> or lower the amount.
          </span>
        </div>
      )}
      {(error ?? thin) && <span role="alert" className="text-xs text-danger">{error ?? thin}</span>}
      <button type="button" disabled={busy} onClick={submit} className={`${solid} mt-auto min-h-12 text-[15px] ${buy ? 'bg-bid' : 'bg-ask'}`}>{submitText(side, amount, base)}</button>
    </section>
  )
}
