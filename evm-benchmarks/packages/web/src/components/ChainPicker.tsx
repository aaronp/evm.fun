import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../state'
import { pageOf } from '../routes'
import { Badge } from '../ui/badge'
import { Select } from '../ui/input'
import { FollowerBadge } from './cloud/DevicesPanel'

/** The app-wide chain switcher. Switching drops chain-specific detail (`?asset=`, a tx report) and stays on the page; locked while a tx is in flight. */
export function ChainPicker() {
  const { chains, chain, selectChain, busy } = useApp()
  const nav = useNavigate()
  const { pathname } = useLocation()
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Select aria-label="Chain" className="max-w-40 min-w-0 sm:max-w-56" disabled={busy} title={busy ? 'A transaction is in flight on this chain' : undefined}
        value={chain?.info.id ?? ''} onChange={e => { nav(pageOf(pathname), { replace: true }); void selectChain(e.target.value || undefined) }}>
        <option value="">Select a chain</option>
        {chains.map(c => <option key={c.id} value={c.id}>{c.name}{c.ephemeral ? ' (benchmark)' : ''}</option>)}
      </Select>
      {chain && <span className="hidden lg:inline-flex"><Badge>{chain.info.type}</Badge></span>}
      {chain && <span className="hidden sm:inline-flex"><FollowerBadge chain={chain} /></span>}
    </div>
  )
}
