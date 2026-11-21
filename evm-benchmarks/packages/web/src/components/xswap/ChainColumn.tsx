import { useState } from 'react'
import type { Address } from 'viem'
import type { LockView } from '@evmb/htlc'
import { shortAddress } from '../../assets/ui'
import { countdown } from '../../htlc/ui'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { card } from '../TakePanel'

const TONE = { locked: 'accent', claimed: 'success', refunded: 'neutral', none: 'neutral' } as const

/** One chain of the swap: its HashLock (or "Deploy HashLock.sol?"), head, "Advance {n} blocks", and the swap's locks there. */
export function ChainColumn({ role, name, hashLock, head, locks, amount, who, deploy, mine }: {
  role: 'A' | 'B'; name: string
  /** undefined: none recorded; null: still looking */
  hashLock: Address | null | undefined
  head?: bigint
  locks: LockView[]
  amount(l: LockView): string; who(a: string): string
  /** omitted where nothing can be deployed (benchmark chains, no account) */
  deploy?: { busy: boolean; onDeploy(): void }
  /** `disabled` while a send is in flight or txs are pending (the sequencer refuses to mine then) */
  mine: { disabled: boolean; busy: boolean; error?: string; onMine(n: number): void }
}) {
  const [n, setN] = useState('10')
  const count = /^[1-9]\d{0,3}$/.test(n.trim()) ? Number(n) : undefined
  return (
    <section aria-label={`Chain ${role}: ${name}`} className={`${card} flex min-w-0 flex-[1_1_300px] flex-col gap-3 p-[18px]`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold"><span className="text-muted">Chain {role} · </span>{name}</h2>
        <span className="font-mono text-xs text-muted">head {head === undefined ? '…' : String(head)}</span>
      </div>
      {hashLock === null && <p className="text-[13px] text-muted">Looking for HashLock…</p>}
      {hashLock === undefined && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 text-[13px] text-text-2">{name} has no HashLock contract yet.</span>
          {deploy && <Button size="field" disabled={deploy.busy} onClick={deploy.onDeploy}>{deploy.busy ? 'Deploying…' : 'Deploy HashLock.sol?'}</Button>}
        </div>
      )}
      {hashLock && <span className="font-mono text-xs text-text-2">HashLock.sol {shortAddress(hashLock)}</span>}
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label={`Blocks to advance ${name}`} inputMode="numeric" className="min-h-9 w-20 font-mono" value={n} onChange={e => setN(e.target.value)} />
        <Button variant="outline" size="field" disabled={mine.disabled || mine.busy || count === undefined} onClick={() => count && mine.onMine(count)}>
          {mine.busy ? 'Advancing…' : `Advance ${count ?? n} blocks`}
        </Button>
      </div>
      {mine.error && <span role="alert" className="text-xs text-danger">{mine.error}</span>}
      <ul className="flex flex-col gap-2">
        {locks.map(l => (
          <li key={l.chain + l.id} className="flex flex-col gap-1 rounded-[10px] border border-line bg-panel px-3 py-2.5 text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono font-medium">#{String(l.id)} · {amount(l)}</span>
              <Badge variant={TONE[l.status]}>{l.status}</Badge>
            </div>
            <span className="text-xs text-muted">{who(l.sender)} → {who(l.recipient)}</span>
            {head !== undefined && <span className="font-mono text-xs text-text-2">{countdown(l, head)}</span>}
          </li>
        ))}
        {!locks.length && <li className="text-xs text-subtle">No lock of this swap on {name}.</li>}
      </ul>
    </section>
  )
}
