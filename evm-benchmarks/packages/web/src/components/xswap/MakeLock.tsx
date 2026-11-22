import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import type { Asset } from '@evmb/assets'
import { priceText } from '@evmb/swap'
import { parseAmount } from '../../assets/ui'
import { actionText, defaults, parseBlocks } from '../../htlc/ui'
import { amountText } from '../../swap/ui'
import { Button } from '../../ui/button'
import { Input, Select } from '../../ui/input'
import { card, solid } from '../TakePanel'
import { Shortfall, useRequestFix } from '../Shortfall'
import { orThrow, useWizardAction, useWizardField, useWizardMark } from '../../walkthrough/wizard'

const label = 'text-xs font-medium text-muted'
const input = 'min-h-11 rounded-[10px] px-3 font-mono font-medium'
type Terms = { amount: bigint; want: bigint; taker: Address; timeoutBlock: bigint }

/** The maker's form: lock {amount} of base on A for {want} of quote on B, payable to a named taker; approve first when short. */
export function MakeLock({ base, quote, chainA, chainB, headA, takers, funds, busy, onApprove, onLock }: {
  base: Asset; quote: Asset; chainA: string; chainB: string; headA?: bigint
  /** the other accounts */
  takers: { label: string; address: string }[]
  /** the acting account's base balance and HashLock allowance on A */
  funds: { bal?: bigint; alw?: bigint }; busy: boolean
  onApprove(amount: bigint): Promise<string | undefined>
  /** resolves to the error message when it failed */
  onLock(t: Terms): Promise<string | undefined>
}) {
  const [amount, setAmount] = useState('')
  const [want, setWant] = useState('')
  const [taker, setTaker] = useState('')
  const [blocks, setBlocks] = useState(String(defaults.a))
  const [error, setError] = useState<string>()
  useEffect(() => setError(undefined), [base, quote])
  const to = takers.find(t => t.address === taker) ?? takers[0]
  useWizardField('xswap.amount', amount, setAmount)
  useWizardField('xswap.want', want, setWant)
  useWizardField('xswap.taker', to?.address ?? '', setTaker)
  useWizardField('xswap.timeout', blocks, setBlocks)
  const mark = useWizardMark()

  const a = amount.trim() ? parseAmount(amount.replace(/,/g, ''), base.decimals) : undefined
  const w = want.trim() ? parseAmount(want.replace(/,/g, ''), quote.decimals) : undefined
  const n = parseBlocks(blocks)
  const amt = a && 'ok' in a && a.ok > 0n ? a.ok : undefined, wnt = w && 'ok' in w && w.ok > 0n ? w.ok : undefined
  const { bal, alw } = funds
  const short = amt !== undefined && bal !== undefined && bal < amt
  const needsApprove = amt !== undefined && !short && alw !== undefined && alw < amt
  const fix = useRequestFix(base, short ? amt! : 0n, bal ?? 0n)
  const price = amt && wnt ? priceText({ num: wnt * 10n ** BigInt(base.decimals), den: amt * 10n ** BigInt(quote.decimals) }) : '—'
  const amtText = amt === undefined ? amount || '…' : amountText(amt, base.decimals)

  async function lock() {
    const fail = (e: string) => (setError(e), e)
    if (amt === undefined || wnt === undefined) return fail(`Enter both amounts as positive numbers (${base.symbol} at most ${base.decimals} decimals, ${quote.symbol} at most ${quote.decimals}).`)
    if (!to) return fail('Create a second account to be the taker.')
    if (typeof n !== 'bigint') return fail(n.error)
    if (headA === undefined) return fail(`Still reading ${chainA}’s head.`)
    if (short) return fail(`Not enough ${base.symbol} — you have ${amountText(bal!, base.decimals)}.`)
    const e = await onLock({ amount: amt, want: wnt, taker: to.address as Address, timeoutBlock: headA + n })
    if (!e) { setAmount(''); setWant(''); setError(undefined) }
    return e
  }
  // Next presses what the form shows: Approve while short of allowance, then the lock
  useWizardAction('xswap.approve', needsApprove && !busy ? () => orThrow(onApprove(amt!)) : undefined)
  useWizardAction('xswap.lock', !needsApprove && !busy ? () => orThrow(lock()) : undefined)

  return (
    <section {...mark('xswap.make')} aria-labelledby="mk-h" className={`${card} flex flex-[1_1_300px] flex-col gap-3.5 p-[18px]`}>
      <h2 id="mk-h" className="text-sm font-semibold">Make · lock {base.symbol} for {quote.symbol}</h2>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1.5"><label htmlFor="xa" className={label}>You lock ({base.symbol} on {chainA})</label>
          <Input {...mark('xswap.amount')} id="xa" className={input} value={amount} placeholder="10.00" onChange={e => { setAmount(e.target.value); setError(undefined) }} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="xw" className={label}>You want ({quote.symbol} on {chainB})</label>
          <Input {...mark('xswap.want')} id="xw" className={input} value={want} placeholder="12.70" onChange={e => { setWant(e.target.value); setError(undefined) }} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="xt" className={label}>Taker</label>
          <Select {...mark('xswap.taker')} id="xt" value={to?.address ?? ''} onChange={e => setTaker(e.target.value)}>
            {takers.map(t => <option key={t.address} value={t.address}>{t.label}</option>)}
          </Select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="xb" className={label}>Timeout (blocks on {chainA})</label>
          <Input {...mark('xswap.timeout')} id="xb" inputMode="numeric" className={input} value={blocks} onChange={e => { setBlocks(e.target.value); setError(undefined) }} /></div>
      </div>
      <div className="flex flex-col gap-2 rounded-[10px] bg-panel p-3 text-[13px]">
        <div className="flex justify-between"><span className="text-muted">Price</span><span className="font-mono">{price} {quote.symbol}/{base.symbol}</span></div>
        <div className="flex justify-between"><span className="text-muted">Refundable from block</span><span className="font-mono">{headA !== undefined && typeof n === 'bigint' ? String(headA + n) : '—'}</span></div>
      </div>
      <p className="text-xs leading-normal text-muted">A random secret is made in this browser; the lock carries only its hash. {to?.label ?? 'The taker'} answers on {chainB}; claiming that reveals the secret, which lets them claim here.</p>
      {error && (short
        ? <Shortfall fix={fix}><span role="alert" className="text-xs text-danger">{error}</span></Shortfall>
        : <span role="alert" className="text-xs text-danger">{error}</span>)}
      <div className="mt-auto flex flex-col gap-2">
        {needsApprove && <Button {...mark('xswap.approve')} className="min-h-11 rounded-[10px] text-sm font-semibold" disabled={busy} onClick={() => void onApprove(amt!)}>1 · Approve {amtText} {base.symbol}</Button>}
        <button {...mark('xswap.lock')} className={`${solid} min-h-12 bg-accent text-[15px]`} disabled={needsApprove || busy} onClick={lock}>
          {needsApprove ? '2 · ' : ''}{actionText('make', { amtA: amtText, base: base.symbol, chainA, amtB: '', quote: quote.symbol, chainB })}
        </button>
      </div>
    </section>
  )
}
