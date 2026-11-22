import { useState } from 'react'
import type { Hex } from 'viem'
import { actionText, maskSecret, type Action, type Role } from '../../htlc/ui'
import { Button } from '../../ui/button'
import { card, solid } from '../TakePanel'
import { orThrow, useWizardAction, useWizardMark } from '../../walkthrough/wizard'

const ALL: Action[] = ['claimA', 'claimB', 'refundA', 'refundB']

type Copy = Parameters<typeof actionText>[1]

/** The acting account's claim/refund buttons for the swap (from `actionsFor`), and for the maker only its secret,
 * masked until "Reveal". The taker's view never renders the secret, whatever it is given. */
export function ClaimRefund({ role, actions, copy, secret, busy, onAction }: {
  role?: Role; actions: Action[]; copy: Copy; secret?: Hex; busy: boolean; onAction(a: Action): Promise<string | undefined>
}) {
  const [shown, setShown] = useState(false)
  const mark = useWizardMark()
  // a walkthrough's claim/refund step presses the button shown for it (`xswap.claimB`, …); a fixed list, so hooks keep their order
  for (const a of ALL) useWizardAction(`xswap.${a}`, actions.includes(a) && !busy ? () => orThrow(onAction(a)) : undefined) // eslint-disable-line react-hooks/rules-of-hooks
  const mine = role === 'maker' ? secret : undefined
  return (
    <section {...mark('xswap.claims')} aria-labelledby="cr-h" className={`${card} flex flex-[1_1_300px] flex-col gap-3 p-[18px]`}>
      <h2 id="cr-h" className="text-sm font-semibold">{role === 'maker' ? 'You are the maker' : role === 'taker' ? 'You are the taker' : 'Claim / refund'}</h2>
      {!role && <p className="text-[13px] text-muted">The acting account is neither the maker nor the taker of this swap.</p>}
      {role === 'maker' && (mine
        ? <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-panel px-3 py-2">
            <span className="text-xs text-muted">Your secret</span>
            <span className="min-w-0 flex-1 break-all font-mono text-xs">{shown ? mine : maskSecret(mine)}</span>
            <Button variant="ghost" size="chip" onClick={() => setShown(s => !s)}>{shown ? 'Hide' : 'Reveal'}</Button>
          </div>
        : <p className="text-[13px] text-muted">The secret for this swap is not in this browser, so you can’t claim on {copy.chainB} here.</p>)}
      {actions.map(a => (
        <button key={a} {...mark(`xswap.${a}`)} className={`${solid} min-h-11 text-sm ${a.startsWith('refund') ? 'bg-ask' : 'bg-bid'}`} disabled={busy} onClick={() => void onAction(a)}>
          {actionText(a, copy)}
        </button>
      ))}
      {role && !actions.length && <p className="text-[13px] text-muted">Nothing for you to do right now: the buttons follow each chain’s head and the locks’ timeouts.</p>}
    </section>
  )
}
