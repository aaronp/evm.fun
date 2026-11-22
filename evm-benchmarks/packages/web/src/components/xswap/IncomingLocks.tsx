import { useState } from 'react'
import type { LockView } from '@evmb/htlc'
import { actionText, chainLabel, defaults, parseBlocks, safety, type Role } from '../../htlc/ui'
import type { Fix } from '../../fix'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { card, solid } from '../TakePanel'
import { Shortfall } from '../Shortfall'
import { orThrow, useWizardAction, useWizardField, useWizardMark } from '../../walkthrough/wizard'

type Chains = { id: string; name: string }[]
const row = (on: boolean) => `flex w-full flex-col gap-0.5 rounded-[10px] border px-3 py-2 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-accent ${on ? 'border-accent bg-selected' : 'border-line hover:bg-surface-hover'}`

/** Open locks on A addressed to the acting account, grouped by the chain they want an answer on. */
export function IncomingLocks({ locks, chains, selected, amount, want, who, onPick }: {
  locks: LockView[]; chains: Chains; selected?: string | null
  amount(l: LockView): string; want(l: LockView): string; who(a: string): string; onPick(l: LockView): void
}) {
  const groups = [...new Set(locks.map(l => l.wantChain))]
  return (
    <section aria-labelledby="in-h" className={`${card} flex flex-[1_1_300px] flex-col gap-3 p-[18px]`}>
      <h2 id="in-h" className="text-sm font-semibold">Incoming locks</h2>
      {!locks.length && <p className="text-[13px] text-muted">No open lock is addressed to you on this chain.</p>}
      {groups.map(g => (
        <div key={g} className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Wants an answer on {chainLabel(g, chains)}</span>
          {locks.filter(l => l.wantChain === g).map(l => (
            <button key={String(l.id)} aria-pressed={l.hash === selected} className={row(l.hash === selected)} onClick={() => onPick(l)}>
              <span className="font-mono font-medium">#{String(l.id)} · {amount(l)} for {want(l)}</span>
              <span className="text-xs text-muted">from {who(l.sender)} · timeout block {String(l.timeoutBlock)}</span>
            </button>
          ))}
        </div>
      ))}
    </section>
  )
}

/** Every opening lock on A the acting account sent (maker) or was sent (taker). */
export function MySwaps({ rows, chains, selected, amount, want, onPick }: {
  rows: { lock: LockView; role: Role }[]; chains: Chains; selected?: string | null
  amount(l: LockView): string; want(l: LockView): string; onPick(l: LockView): void
}) {
  return (
    <section aria-labelledby="my-h" className={`${card} flex flex-[1_1_300px] flex-col gap-3 p-[18px]`}>
      <h2 id="my-h" className="text-sm font-semibold">My swaps</h2>
      {!rows.length && <p className="text-[13px] text-muted">No swap of yours on this chain yet.</p>}
      {rows.map(({ lock: l, role }) => (
        <button key={String(l.id)} aria-pressed={l.hash === selected} className={row(l.hash === selected)} onClick={() => onPick(l)}>
          <span className="flex items-center justify-between gap-2">
            <span className="font-mono font-medium">#{String(l.id)} · {amount(l)} for {want(l)}</span>
            <Badge variant={l.status === 'locked' ? 'accent' : 'neutral'}>{role} · {l.status}</Badge>
          </span>
          <span className="text-xs text-muted">answer on {chainLabel(l.wantChain, chains)}</span>
        </button>
      ))}
    </section>
  )
}

/** The taker's answer: lock the wanted amount on B with a shorter timeout; the safety rule is checked, and an unsafe
 * timeout needs "Lock anyway". */
export function AcceptLock({ opening, chainA, chainB, headA, headB, amtB, quote, funds, fix, busy, onApprove, onLock }: {
  opening: LockView; chainA: string; chainB: string; headA?: bigint; headB?: bigint
  /** the wanted amount and token symbol, formatted */
  amtB: string; quote: string
  /** the acting account's balance and allowance of the wanted token for B's HashLock */
  funds: { bal?: bigint; alw?: bigint }; fix?: Fix; busy: boolean
  onApprove(): Promise<string | undefined>
  /** resolves to the error message when it failed */
  onLock(timeoutBlock: bigint): Promise<string | undefined>
}) {
  const [blocks, setBlocks] = useState(String(defaults.b))
  const [error, setError] = useState<string>()
  useWizardField('xswap.answerTimeout', blocks, setBlocks)
  const mark = useWizardMark()
  const n = parseBlocks(blocks)
  const ready = typeof n === 'bigint' && headA !== undefined && headB !== undefined
  const check = ready ? safety(opening.timeoutBlock, headA, headB + n, headB, chainA, chainB) : undefined
  const { bal, alw } = funds, need = opening.wantAmount
  const short = bal !== undefined && bal < need
  const needsApprove = !short && alw !== undefined && alw < need
  const text = actionText('accept', { amtA: '', base: '', chainA, amtB, quote, chainB })
  /** resolves to the error message when it failed */
  async function lock() {
    const fail = (e: string) => (setError(e), e)
    if (typeof n !== 'bigint') return fail(n.error)
    if (!ready) return fail('Still reading both chains’ heads.')
    if (short) return fail(`Not enough ${quote} on ${chainB}.`)
    const e = await onLock(headB + n)
    setError(e)
    return e
  }
  // Next presses what the page shows: Approve while short of allowance, then the lock ("Lock anyway" when unsafe)
  useWizardAction('xswap.acceptApprove', needsApprove && !busy ? () => orThrow(onApprove()) : undefined)
  useWizardAction('xswap.accept', !needsApprove && !busy && ready ? () => orThrow(lock()) : undefined)
  return (
    <section {...mark('xswap.acceptCard')} aria-labelledby="ac-h" className={`${card} flex flex-[1_1_300px] flex-col gap-3.5 p-[18px]`}>
      <h2 id="ac-h" className="text-sm font-semibold">Accept #{String(opening.id)} · answer on {chainB}</h2>
      <div className="flex flex-col gap-1.5"><label htmlFor="xtb" className="text-xs font-medium text-muted">Your timeout (blocks on {chainB})</label>
        <Input {...mark('xswap.answerTimeout')} id="xtb" inputMode="numeric" className="min-h-11 rounded-[10px] px-3 font-mono font-medium" value={blocks} onChange={e => { setBlocks(e.target.value); setError(undefined) }} /></div>
      {check && <div role={check.safe ? 'status' : 'alert'} className={`rounded-[10px] border px-3 py-2.5 text-xs leading-normal ${check.safe ? 'border-line bg-panel text-text-2' : 'border-warn bg-warn-soft text-warn-text'}`}>{check.text}</div>}
      {error && (short ? <Shortfall fix={fix}><span role="alert" className="text-xs text-danger">{error}</span></Shortfall> : <span role="alert" className="text-xs text-danger">{error}</span>)}
      {short && !error && <Shortfall fix={fix}><span className="text-xs text-danger">Not enough {quote} on {chainB} to answer.</span></Shortfall>}
      <div className="mt-auto flex flex-col gap-2">
        {needsApprove && <Button {...mark('xswap.acceptApprove')} className="min-h-11 rounded-[10px] text-sm font-semibold" disabled={busy} onClick={() => void onApprove()}>1 · Approve {amtB} {quote}</Button>}
        {check && !check.safe
          ? <Button {...mark('xswap.accept')} variant="danger" className="min-h-12 rounded-[10px] text-[15px] font-semibold" disabled={needsApprove || busy} onClick={lock}>{needsApprove ? '2 · ' : ''}Lock anyway</Button>
          : <button {...mark('xswap.accept')} className={`${solid} min-h-12 bg-bid text-[15px]`} disabled={needsApprove || busy || !ready} onClick={lock}>{needsApprove ? '2 · ' : ''}{text}</button>}
      </div>
    </section>
  )
}
