import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../state'
import { useBalance, formatEth } from '../chain/useBalance'
import { accounts } from '../store/accounts'
import { pageOf } from '../routes'
import { Badge } from '../ui/badge'
import { Select } from '../ui/input'

/** The app-wide chain switcher. Switching drops chain-specific detail (`?asset=`, a tx report) and stays on the page. */
function ChainSelect({ className = '' }: { className?: string }) {
  const { chains, chain, selectChain, busy } = useApp()
  const nav = useNavigate()
  const { pathname } = useLocation()
  return (
    <Select aria-label="Chain" className={className} disabled={busy} title={busy ? 'A transaction is in flight on this chain' : undefined}
      value={chain?.info.id ?? ''} onChange={e => { nav(pageOf(pathname), { replace: true }); void selectChain(e.target.value || undefined) }}>
      <option value="">Select a chain</option>
      {chains.map(c => <option key={c.id} value={c.id}>{c.name}{c.ephemeral ? ' (benchmark)' : ''}</option>)}
    </Select>
  )
}

function AccountSelect({ className = '' }: { className?: string }) {
  const { account, selectAccount } = useApp()
  const people = accounts.list()
  if (!people.length) return <span className="text-muted">No account</span>
  return (
    <Select aria-label="Account" className={className} value={account ?? ''} onChange={e => selectAccount(e.target.value || undefined)}>
      {!account && <option value="">Select an account</option>}
      {people.map(p => <option key={p.address} value={p.address}>{p.label}</option>)}
    </Select>
  )
}

function useBalanceText() {
  const { chain, account } = useApp()
  return formatEth(useBalance(chain, account as `0x${string}` | undefined))
}

/** Sidebar card (sm and up). */
export function ContextBox() {
  const { chain } = useApp()
  const balance = useBalanceText()
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line-strong bg-surface p-3.5 text-sm">
      <span className="text-[11px] uppercase tracking-widest text-muted">Active context</span>
      <div className="flex items-center gap-2"><ChainSelect className="min-w-0 flex-1" />{chain && <Badge>{chain.info.type}</Badge>}</div>
      <AccountSelect className="w-full" />
      <span className="font-mono text-xs text-muted">{balance}</span>
    </div>
  )
}

/** One-line strip under the top bar (below sm). */
export function ContextStrip() {
  const { chain } = useApp()
  const balance = useBalanceText()
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <ChainSelect className="min-w-0 flex-1" />
      {chain && <Badge>{chain.info.type}</Badge>}
      <AccountSelect className="min-w-0 flex-1" />
      <span className="font-mono">{balance}</span>
    </div>
  )
}
