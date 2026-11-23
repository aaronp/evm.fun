import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppBar, crumbsFor } from '../state/appBar'
import { registry } from '../chain/revm'
import { LIVE_WARN } from '../chain/registry'
import { provenanceText } from '../chain/chainFile'
import { filterChains, rowHeight, type ChainTab } from '../chain/filter'
import type { ChainInfo } from '../chain/handle'
import { privateKeyToAccount } from 'viem/accounts'
import { accounts } from '../store/accounts'
import { useApp } from '../state'
import { NewChainDialog } from '../components/NewChainDialog'
import { SnapshotsDialog, TakeSnapshotDialog, type Flash } from '../components/SnapshotsDialog'
import { ImportButton } from '../components/ImportButton'
import { exportChain } from '../components/exportFile'
import { NO_FUNDS } from '../chain/snapshotUi'
import { Explorer } from './Explorer'
import { DeployDialog } from '../components/cloud/DeployDialog'
import { DevicesPanel, FollowerBadge, FollowerStatusLine, syncNow } from '../components/cloud/DevicesPanel'
import { cannotDeploy, convertDeployed, deployedUrl } from '../cloud/deploy'
import { useWizardAction, useWizardMark } from '../walkthrough/wizard'
import { useBlockWindow } from '../explorer/useBlockWindow'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import { Input, Select } from '../ui/input'
import { Notice } from '../ui/notice'
import { Segmented } from '../ui/segmented'
import { CameraIcon, DownloadIcon, HistoryIcon, PlusIcon, RefreshIcon, UploadIcon } from '../ui/icons'

const tabs: { value: ChainTab; content: string }[] = [
  { value: 'all', content: 'All' },
  { value: 'saved', content: 'Saved' },
  { value: 'bench', content: 'Benchmark runs' },
]

/** Live height if the chain is already running (never opens one), else the last saved height. */
function Height({ info, tick }: { info: ChainInfo; tick: number }) {
  const [live, setLive] = useState<number>()
  const running = !!registry.peek(info.id)
  useEffect(() => {
    let on = true
    const h = registry.peek(info.id)
    if (h) Promise.resolve(h.request('eth_blockNumber', [])).then(x => on && typeof x === 'string' && setLive(parseInt(x, 16)), () => {})
    return () => { on = false }
  }, [info.id, tick, running])
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
  const { pathname, search, state: navState } = useLocation()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<ChainTab>('all')
  const dialog = useRef<HTMLDialogElement>(null)
  const win = useBlockWindow(chain)
  const takeRef = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLDialogElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const deployRef = useRef<HTMLDialogElement>(null)
  const [takeTick, setTakeTick] = useState(0)
  const [listTick, setListTick] = useState(0)
  const [flash, setFlash] = useState<Flash>()
  const [diverged, setDiverged] = useState<string>() // id of a chain deployed earlier that has moved on since
  const converting = useRef(new Set<string>())
  const selected = useRef<string | undefined>(undefined)
  selected.current = chain?.info.id
  const [, bumpFollowers] = useState(0) // a follower's status or head changed: redraw its badge in the list
  useEffect(() => registry.watch(() => bumpFollowers(n => n + 1)), [])
  const [syncing, setSyncing] = useState(false)
  const [noFunds, setNoFunds] = useState<string>() // id of the imported chain with no funded account, checked once at import
  // an import from the File menu lands here with the same check's result
  useEffect(() => {
    const id = (navState as { noFunds?: string } | null)?.noFunds
    if (id) { setNoFunds(id); nav(pathname + search, { replace: true, state: null }) } // once: a reload or Back doesn't bring it back
  }, [navState])
  /** A plain chain deployed before deploys converted: becomes a follower when opened here (asks first if it moved on). */
  async function convert(id: string, force = false) {
    if (converting.current.has(id)) return
    converting.current.add(id)
    try {
      const keys = accounts.list().map(a => privateKeyToAccount(a.privateKey))
      if (await convertDeployed(id, { registry, accounts: keys, force }) === 'diverged') return setDiverged(id)
      setDiverged(undefined)
      await refresh()
      if (selected.current === id) await selectChain(id) // still the one shown: pick up its follower handle
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setFlash({ tone: 'warn', text: `Couldn't switch this chain to follow its cloud copy: ${m}${m.startsWith('Needs ') ? '. Import that key on Accounts, then open the chain again.' : ''}` })
    } finally { converting.current.delete(id) }
  }
  useEffect(() => {
    if (chain?.info.type === 'plain' && chain.info.deployed && !chain.info.ephemeral) void convert(chain.info.id)
  }, [chain])
  async function convertAnyway() {
    if (!chain || !confirm(`Make "${chain.info.name}" follow its cloud chain? Changes made in this browser since the deploy are dropped. Export the chain first to keep them.`)) return
    await convert(chain.info.id, true)
  }
  const none = chain ? undefined : 'Select a chain first'
  useAppBar({
    title: 'Chains',
    crumbs: crumbsFor(pathname, chain?.info.name),
    actions: [
      { kind: 'button', id: 'snapshot', label: 'Snapshot', icon: <CameraIcon />, title: none ?? 'Take a snapshot', disabled: !chain, onClick: () => { setTakeTick(t => t + 1); takeRef.current?.showModal() } },
      { kind: 'button', id: 'snapshots', label: 'Snapshots', icon: <HistoryIcon />, title: none ?? 'Snapshots of this chain', disabled: !chain, onClick: () => { setListTick(t => t + 1); listRef.current?.showModal() } },
      { kind: 'button', id: 'export', label: 'Export', icon: <DownloadIcon />, title: none ?? 'Export this chain to a file', disabled: !chain, onClick: () => { exportChain(chain!).catch(e => setFlash({ tone: 'warn', text: `Export failed: ${e instanceof Error ? e.message : String(e)}` })) } },
      { kind: 'button', id: 'import', label: 'Import', icon: <UploadIcon />, title: 'Import a chain file as a new chain', onClick: () => fileRef.current?.click() },
      { kind: 'button', id: 'refresh', label: 'Refresh', icon: <RefreshIcon />, title: none ?? 'Refresh', onClick: win.refresh, disabled: !chain },
    ],
  })
  const shown = filterChains(chains, q, tab)
  const mark = useWizardMark()
  useWizardAction('chains.new', () => dialog.current?.showModal())
  const add = (
    <Button {...mark('chains.new')} className="!size-9 !rounded-full !p-0" aria-label="New chain" title="New chain" onClick={() => dialog.current?.showModal()}>
      <PlusIcon /><span className="sr-only">New chain</span>
    </Button>
  )

  /** Switching chain drops a block/tx URL that belongs to the old one. */
  function pick(id?: string) { if (id !== chain?.info.id) nav('/chains'); return selectChain(id) }

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
      {flash && <Notice tone={flash.tone} onDismiss={() => setFlash(undefined)}>{flash.text}</Notice>}
      <NewChainDialog dialogRef={dialog} />
      <TakeSnapshotDialog dialogRef={takeRef} chain={chain} openTick={takeTick} onFlash={setFlash} />
      <SnapshotsDialog dialogRef={listRef} chain={chain} openTick={listTick} onFlash={setFlash} />
      {chain && <DeployDialog key={chain.info.id} dialogRef={deployRef} chain={chain} onDeployed={win.refresh} />}
      <ImportButton inputRef={fileRef} onFlash={setFlash} onImported={(id, funded) => setNoFunds(funded ? undefined : id)} />
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {!wide && <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Select aria-label="Chain" className="min-w-0 flex-1" value={chain?.info.id ?? ''} onChange={e => pick(e.target.value || undefined)}>
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
                    onClick={() => pick(c.id)}
                    className={`w-full rounded-lg border bg-surface p-3 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent ${sel ? 'border-accent' : 'border-line'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{c.name}</span>
                      <Height info={c} tick={balanceTick} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge>{c.type}</Badge>
                      {c.ephemeral && <Badge variant="warn">benchmark</Badge>}
                      {c.deployed && <Badge variant="success">deployed</Badge>}
                      <FollowerBadge chain={registry.peek(c.id)} />
                      {registry.peek(c.id) && <Badge>running</Badge>}
                      {sel && <Badge variant="accent">selected</Badge>}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>}
        <section className="@container min-w-0 space-y-4 lg:col-start-2 lg:row-start-1">
          {chains.length === 0 ? (
            <Card className="text-sm text-muted">No chains yet. Use the round + button to create one.</Card>
          ) : chain && (
            <Card className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{chain.info.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge>{chain.info.type}</Badge>{chain.info.ephemeral && <Badge variant="warn">benchmark (not saved)</Badge>}{chain.info.deployed && <Badge variant="success">Deployed</Badge>}<span>{chain.info.createdAt}</span>
                </div>
                {provenanceText(chain.info.source) && <div className="mt-1 text-xs text-muted">{provenanceText(chain.info.source)}</div>}
                {chain.info.follows && <div className="mt-1"><FollowerStatusLine chain={chain} onDelete={() => remove(chain.info)} /></div>}
                {noFunds === chain.info.id && <div className="mt-2"><Notice onDismiss={() => setNoFunds(undefined)}>{NO_FUNDS}</Notice></div>}
              </div>
              {diverged === chain.info.id && chain.info.deployed && (
                <div role="alert" className="order-last w-full space-y-2 rounded-lg border border-warn bg-warn-soft px-3 py-2 text-sm text-warn-text">
                  <p><span className="font-medium">Local changes since deploy.</span> This chain has moved on from block #{chain.info.deployed.head}, where it was deployed. To keep following the cloud chain, this browser's copy switches to the cloud's and drops those changes — export it first to keep them.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" onClick={() => { exportChain(chain).catch(e => setFlash({ tone: 'warn', text: `Export failed: ${e instanceof Error ? e.message : String(e)}` })) }}><DownloadIcon /> Export chain</Button>
                    <Button variant="ghost" size="sm" onClick={convertAnyway}>Convert anyway</Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {chain.info.follows
                  ? <>
                      <div className="min-w-0 text-xs text-muted">Follows <span className="break-all font-mono text-text-2">{deployedUrl(chain.info.follows)}</span></div>
                      <Button variant="ghost" size="sm" disabled={syncing} onClick={() => { setSyncing(true); syncNow(chain).finally(() => setSyncing(false)) }}>{syncing ? 'Syncing…' : 'Sync now'}</Button>
                    </>
                  : chain.info.deployed
                  ? <div className="min-w-0 text-xs text-muted">Deployed as <span className="break-all font-mono text-text-2">{deployedUrl(chain.info.deployed)}</span> at block #{chain.info.deployed.head}</div>
                  : <Button variant="ghost" size="sm" disabled={!!cannotDeploy(chain.info)} title={cannotDeploy(chain.info) ?? 'Run a copy of this chain on the cloud node'} onClick={() => deployRef.current?.showModal()}>Deploy…</Button>}
                <Button variant="danger" size="sm" onClick={() => remove(chain.info)}>Delete</Button>
              </div>
            </Card>
          )}
          {chain?.info.follows && <DevicesPanel key={chain.info.id} chain={chain} />}
          {chains.length > 0 && <Explorer win={win} />}
        </section>
      </div>
    </div>
  )
}
