import { useApp } from '../state'
import { useBalance, formatEth } from '../chain/useBalance'
import { accounts } from '../store/accounts'
import { Badge } from '../ui/badge'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

function useActive() {
  const { chain, account } = useApp()
  const acct = account ? accounts.list().find(a => a.address === account) : undefined
  const balance = useBalance(chain, account as `0x${string}` | undefined)
  return { chain, who: account ? (acct?.label || short(account)) : undefined, balance: formatEth(balance) }
}

/** Sidebar card (sm and up). */
export function ContextBox() {
  const { chain, who, balance } = useActive()
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line-strong bg-surface p-3.5 text-sm">
      <span className="text-[11px] uppercase tracking-widest text-muted">Active context</span>
      {chain ? (
        <div className="flex items-center gap-2"><span className="font-semibold">{chain.info.name}</span><Badge>{chain.info.type}</Badge></div>
      ) : <span className="text-muted">No chain selected</span>}
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold">{who ?? 'No account'}</span>
        <span className="font-mono text-xs text-muted">{balance}</span>
      </div>
    </div>
  )
}

/** One-line strip under the top bar (below sm). */
export function ContextStrip() {
  const { chain, who, balance } = useActive()
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
      <span className="font-semibold text-text">{chain?.info.name ?? 'No chain'}</span>
      {chain && <Badge>{chain.info.type}</Badge>}
      <span>·</span><span>{who ?? 'No account'}</span>
      <span>·</span><span className="font-mono">{balance}</span>
    </div>
  )
}
