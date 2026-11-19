import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppBar, crumbsFor } from '../state/appBar'
import { registry } from '../chain/revm'
import { LIVE_WARN } from '../chain/registry'
import { filterChains, rowHeight, type ChainTab } from '../chain/filter'
import type { ChainInfo } from '../chain/handle'
import { useApp } from '../state'
import { NewChainDialog } from '../components/NewChainDialog'
import { Explorer } from './Explorer'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import { Input, Select } from '../ui/input'
import { Notice } from '../ui/notice'
import { Segmented } from '../ui/segmented'
import { PlusIcon } from '../ui/icons'

const tabs: { value: ChainTab; content: string }[] = [
  { value: 'all', content: 'All' },
  { value: 'saved', content: 'Saved' },
  { value: 'bench', content: 'Benchmark runs' },
]

/** Live height if the chain is already running (never opens one), else the last saved height. */
function Height({ info, tick }: { info: ChainInfo; tick: number }) {
  const [live, setLive] = useState<number>()
  useEffect(() => {
    let on = true
    const h = registry.peek(info.id)
    if (h) Promise.resolve(h.request('eth_blockNumber', [])).then(x => on && typeof x === 'string' && setLive(parseInt(x, 16)), () => {})
    return () => { on = false }
  }, [info.id, tick])
  return <span className="font-mono text-xs text-text-2" title="Block height">{rowHeight(info, live)}</span>
}

function useWide() {
  const q = '(min-width: 1024px)'
  const [wide, set] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const m = matchMedia(q), f = () => set(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return wide
}

export function Chains() {
  const { chains, chain, error, selectChain, refresh, balanceTick } = useApp()
  const nav = useNavigate()
  const wide = useWide()
  const { pathname } = useLocation()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<ChainTab>('all')
  const dialog = useRef<HTMLDialogElement>(null)
  useAppBar({ title: 'Chains', crumbs: crumbsFor(pathname, chain?.info.name) })
  const shown = filterChains(chains, q, tab)
  const add = (
    <Button className="!size-9 !rounded-full !p-0" aria-label="New chain" title="New chain" onClick={() => dialog.current?.showModal()}>
      <PlusIcon /><span className="sr-only">New chain</span>
    </Button>
  )

  async function remove(c: ChainInfo) {
    if (!confirm(`Delete chain "${c.name}"?`)) return
    if (c.id === chain?.info.id) await selectChain(undefined)
    await registry.remove(c.id)
    await refresh()
    nav('/chains')
  }

  return (
    <div className="space-y-4">
      {error && <Notice>{error}</Notice>}
      {registry.liveCount() >= LIVE_WARN && <Notice>{`${registry.liveCount()} chains are running in this tab — this uses memory and CPU. Delete chains you don't need, or reload to stop them.`}</Notice>}
      <NewChainDialog dialogRef={dialog} />
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {!wide && <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Select aria-label="Chain" className="min-w-0 flex-1" value={chain?.info.id ?? ''} onChange={e => selectChain(e.target.value || undefined)}>
              <option value="">Select a chain</option>
              {chains.map(c => <option key={c.id} value={c.id}>{c.name}{c.ephemeral ? ' (benchmark)' : ''}</option>)}
            </Select>
            {add}
          </div>
        </div>}
        {wide && <aside className="space-y-3">
          <div className="flex items-center gap-2">
            <Input aria-label="Filter chains" className="min-w-0 flex-1" placeholder="Filter chains" value={q} onChange={e => setQ(e.target.value)} />
            {add}
          </div>
          <Segmented label="Chain filter" name="chain-tab" value={tab} onChange={v => setTab(v as ChainTab)} options={tabs} className="flex gap-1" itemClassName="px-2.5 py-1 text-xs" />
          {chains.length > 0 && shown.length === 0 && <p className="text-sm text-muted">No matching chains.</p>}
          <ul className="space-y-2">
            {shown.map(c => {
              const sel = c.id === chain?.info.id
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={sel}
                    onClick={() => selectChain(c.id)}
                    className={`w-full rounded-lg border bg-surface p-3 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent ${sel ? 'border-accent' : 'border-line'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{c.name}</span>
                      <Height info={c} tick={balanceTick} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge>{c.type}</Badge>
                      {c.ephemeral && <Badge variant="warn">benchmark</Badge>}
                      {registry.peek(c.id) && <Badge>running</Badge>}
                      {sel && <Badge variant="accent">selected</Badge>}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>}
        <section className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-1">
          {chains.length === 0 ? (
            <Card className="text-sm text-muted">No chains yet. Use the round + button to create one.</Card>
          ) : chain && (
            <Card className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{chain.info.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge>{chain.info.type}</Badge>{chain.info.ephemeral && <Badge variant="warn">benchmark (not saved)</Badge>}<span>{chain.info.createdAt}</span>
                </div>
              </div>
              <Button variant="danger" size="sm" onClick={() => remove(chain.info)}>Delete</Button>
            </Card>
          )}
          {chains.length > 0 && <Explorer />}
        </section>
      </div>
    </div>
  )
}
