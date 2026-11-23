import { useEffect, useMemo, useState } from 'react'
import { privateKeyToAccount } from 'viem/accounts'
import { useLocation, useNavigate } from 'react-router-dom'
import { NodeClient } from '@evmb/node/src/client'
import { useApp } from '../state'
import { useAppBar } from '../state/appBar'
import { accounts } from '../store/accounts'
import { clientFor, DEFAULT_NODE_URL, getSyncInterval, nodeUrl, setNodeUrl, setSyncInterval, type SyncInterval } from '../cloud/node'
import { joinPrefill } from '../cloud/join'
import { JoinForm } from '../components/cloud/JoinForm'
import { Segmented } from '../ui/segmented'
import { deployedUrl } from '../cloud/deploy'
import { CodesPanel } from '../components/cloud/CodesPanel'
import { FollowerBadge } from '../components/cloud/DevicesPanel'
import { followerStatus } from '../cloud/followerChain'
import { registry } from '../chain/revm'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Panel } from '../ui/panel'
import { Table, td, th } from '../ui/table'

type Health = Awaited<ReturnType<NodeClient['health']>>
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`
const SYNC_OPTIONS = [{ value: '5', content: '5 s' }, { value: '15', content: '15 s' }, { value: '60', content: '60 s' }, { value: 'manual', content: 'Manual' }]

export function Cloud() {
  useAppBar({ title: 'Cloud' })
  const { account, chains, selectChain } = useApp()
  const [, bump] = useState(0) // a follower's status or block changed
  useEffect(() => registry.watch(() => bump((n) => n + 1)), [])
  const acct = accounts.list().find((a) => a.address === account)
  const [url, setUrl] = useState(nodeUrl)
  const [draft, setDraft] = useState(url)
  const [health, setHealth] = useState<Health | { error: string }>()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let on = true
    setHealth(undefined)
    new NodeClient(url).health().then((h) => on && setHealth(h), (e) => on && setHealth({ error: message(e) }))
    return () => { on = false }
  }, [url, tick])
  const root = health && 'root' in health ? health.root : null
  const isAdmin = !!root && !!acct && root.admin.toLowerCase() === acct.address.toLowerCase()
  const client = useMemo(() => (isAdmin ? clientFor(acct) : undefined), [isAdmin, acct?.address, url]) // eslint-disable-line react-hooks/exhaustive-deps
  const signer = useMemo(() => acct && privateKeyToAccount(acct.privateKey), [acct?.address]) // eslint-disable-line react-hooks/exhaustive-deps
  const deployed = chains.filter((c) => c.deployed && !c.follows) // deployed before deploys converted: they convert when opened
  const followed = chains.filter((c) => c.follows)
  const { pathname, search } = useLocation()
  const nav = useNavigate()
  const link = pathname === '/cloud/join' ? joinPrefill(search) : {} // #/cloud/join?node=…&chain=…
  const [sync, setSync] = useState(() => String(getSyncInterval()))

  function save(next: string) {
    setNodeUrl(next)
    setUrl(nodeUrl())
    setDraft(nodeUrl())
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-2">Run a copy of one of your chains on the cloud node. You need a deploy code from the root admin.</p>
      <Panel title="Node" badge={<Badge variant={url === DEFAULT_NODE_URL ? 'neutral' : 'accent'}>{url === DEFAULT_NODE_URL ? 'default' : 'custom'}</Badge>}>
        <div className="space-y-3 p-4">
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); save(draft) }}>
            <Input aria-label="Node URL" className="min-w-0 flex-1 font-mono" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={DEFAULT_NODE_URL} />
            <Button type="submit" variant="ghost" disabled={draft.trim() === url}>Use this node</Button>
            {url !== DEFAULT_NODE_URL && <Button type="button" variant="ghost" onClick={() => save('')}>Back to default</Button>}
          </form>
          <p className="text-xs text-muted">Kept in this browser only. Default: <span className="font-mono">{DEFAULT_NODE_URL}</span></p>
          <div className="flex flex-wrap items-center gap-2" role="status">
            {!health && <span className="text-muted">Checking {url}…</span>}
            {health && 'error' in health && <><Badge variant="danger">unreachable</Badge><span className="break-all">Can't reach {url}: {health.error}</span></>}
            {health && 'root' in health && !root && <><Badge variant="warn">no root chain</Badge><span>The node is up but has no root chain yet.</span></>}
            {root && <><Badge variant="success">online</Badge><span>Root chain at block #{root.head}, admin <span className="font-mono text-xs" title={root.admin}>{short(root.admin)}</span></span></>}
            <Button variant="ghost" size="sm" onClick={() => setTick((t) => t + 1)}>Check again</Button>
          </div>
        </div>
      </Panel>

      <Panel title="Followers">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
          <div className="text-text-2">Sync followers every</div>
          <Segmented label="Sync followers every" name="sync-interval" value={sync} options={SYNC_OPTIONS} className="flex gap-1" itemClassName="px-2.5 py-1 text-xs"
            onChange={(v) => { setSync(v); setSyncInterval(v === 'manual' ? v : (Number(v) as SyncInterval)) }} />
          <p className="w-full text-xs text-muted">Kept in this browser only. Manual: followers sync only when you ask. Hidden tabs don't sync.</p>
        </div>
      </Panel>

      <JoinForm acct={acct} nodeUrl={link.nodeUrl ?? url} chainId={link.chainId} onJoined={() => pathname !== '/cloud' && nav('/cloud', { replace: true })} />

      {root && !acct && <p className="text-sm text-muted">Select an account to issue codes or deploy chains.</p>}
      {isAdmin && client && signer && <CodesPanel client={client} account={signer} access={root!.access} />}
      {root && acct && !isAdmin && <p className="text-sm text-muted">Only the root admin issues deploy codes. Ask them for one, then use <b className="text-text-2">Deploy…</b> on the Chains page.</p>}

      <Panel title="Chains you follow">
        {followed.length === 0 ? <p className="p-4 text-muted">None yet. Deploy a chain from the Chains page, or join one above.</p> : (
          <Table>
            <table className="w-full">
              <thead><tr className="border-b border-line"><th className={th}>Chain</th><th className={th}>Cloud chain</th><th className={th}>Status</th><th className={th}><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {followed.map((c) => {
                  const h = registry.peek(c.id), s = followerStatus(h)
                  return (
                    <tr key={c.id} className="border-b border-line last:border-0 align-top">
                      <td className={`${td} break-all`}>{c.name}</td>
                      <td className={`${td} break-all font-mono text-xs`} title={deployedUrl(c.follows!)}>{c.follows!.chainId}</td>
                      <td className={td}>{h ? <span className="inline-flex flex-wrap items-center gap-2"><FollowerBadge chain={h} />{s?.kind === 'following' && <span className="text-xs text-text-2">#{s.block}</span>}</span> : <span className="text-xs text-muted">not open{c.lastHeight === undefined ? '' : ` · #${c.lastHeight}`}</span>}</td>
                      <td className={td}><Button variant="ghost" size="sm" onClick={() => { void selectChain(c.id); nav('/chains') }}>Open</Button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Table>
        )}
      </Panel>

      {deployed.length > 0 && <Panel title="Deployed, not following yet">
        <p className="px-4 pt-3 text-xs text-muted">These switch to following their cloud chain when you open them on the Chains page.</p>
        <Table>
            <table className="w-full">
              <thead><tr className="border-b border-line"><th className={th}>Chain</th><th className={th}>Cloud chain</th><th className={th}>Head</th><th className={th}>Deployed</th></tr></thead>
              <tbody>
                {deployed.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0 align-top">
                    <td className={td}>{c.name}</td>
                    <td className={`${td} break-all font-mono text-xs`}>{deployedUrl(c.deployed!)}</td>
                    <td className={td}>#{c.deployed!.head}</td>
                    <td className={`${td} text-xs text-muted`}>{new Date(c.deployed!.at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
        </Table>
      </Panel>}
    </div>
  )
}
