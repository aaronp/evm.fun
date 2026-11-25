import { useCallback, useEffect, useMemo, useState } from 'react'
import { privateKeyToAccount } from 'viem/accounts'
import { NodeClient, type Member, type NodesView } from '@evmb/node/src/client'
import type { ChainHandle } from '../../chain/handle'
import { ago, followerStatus, followerTxs, pendingSummary, statusBadge, type FollowerStatus } from '../../cloud/followerChain'
import { grantDeploy, removeDeploy, removeDevice } from '../../cloud/devices'
import { joinLink } from '../../cloud/join'
import { accounts } from '../../store/accounts'
import { useApp } from '../../state'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { CopyIcon } from '../../ui/icons'
import { Notice } from '../../ui/notice'
import { InviteWizard } from './InviteWizard'
import { Panel } from '../../ui/panel'
import { Table, td, th } from '../../ui/table'

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`
const message = (e: unknown) => (e && typeof e === 'object' && 'error' in e ? String(e.error) : e instanceof Error ? e.message : String(e))
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** A follower's status as a badge (nothing for other chains or one not opened yet). */
export function FollowerBadge({ chain }: { chain?: ChainHandle }) {
  const s = followerStatus(chain)
  if (!s) return null
  const b = statusBadge(s)
  return <Badge variant={b.tone} title={s.kind === 'following' ? `Block #${s.block}` : s.detail}>{b.text}</Badge>
}

/** Sync a follower now (Live and Manual alike). */
export const syncNow = (h: ChainHandle) => (h.approach as unknown as { syncNow(): Promise<void> }).syncNow()

/** Status line for a follower's chain card, with what can be done about it (`onReload`: drop the copy and boot it again from the cloud's state). */
export function FollowerStatusLine({ chain, onDelete, onReload }: { chain: ChainHandle; onDelete(): void; onReload(): void }) {
  const s = followerStatus(chain)
  const f = chain.info.follows
  if (!s || !f) return null
  const note = (chain.approach as unknown as { notice?(): string | undefined }).notice?.()
  const extra = note && <Notice tone="warn">{note}</Notice>
  const { pending } = pendingSummary(followerTxs(chain))
  if (s.kind === 'following') return <><span className="text-xs text-text-2">Block #{s.block} · {s.behind ? `${s.behind} behind` : 'in sync'}{pending > 0 && ` · ${pending} pending`}</span>{extra}</>
  const text = s.kind === 'unreachable' ? `${s.detail}. Retrying.` : s.detail
  const action = s.kind === 'needs-key' ? <a className="shrink-0 text-xs font-medium text-accent underline" href="#/accounts">Import key on Accounts</a>
    : s.kind === 'removed' || s.kind === 'mismatch' || s.kind === 'gone' ? (
      <span className="flex shrink-0 gap-2">
        {s.kind === 'mismatch' && <Button variant="ghost" size="sm" onClick={onReload} title="Close this copy and load it again from the cloud (no code needed)">Reload copy</Button>}
        {s.kind === 'mismatch' && <a className="self-center text-xs font-medium text-accent underline" href={joinLink('', f.nodeUrl, f.chainId)}>Re-join</a>}
        <Button variant="danger" size="sm" onClick={onDelete}>Delete</Button>
      </span>
    ) : undefined
  return <><Notice tone={statusBadge(s).tone} action={action}>{pending > 0 ? `${text} ${pending} pending.` : text}</Notice>{extra}</>
}

/**
 * Devices on a follower's cloud chain: each member's name, role and position. The chain's admin (this browser's follow
 * account) can invite a device and remove members. Refreshes when the follower's head or status changes (live updates) and on Sync now: no polling of its own.
 */
export function DevicesPanel({ chain }: { chain: ChainHandle }) {
  const { balanceTick } = useApp()
  const f = chain.info.follows!
  const status: FollowerStatus | undefined = followerStatus(chain)
  const key = accounts.list().find((a) => same(a.address, f.account))
  const signer = useMemo(() => key && privateKeyToAccount(key.privateKey), [key?.privateKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const client = useMemo(() => signer && new NodeClient(f.nodeUrl, signer, { name: key!.label }), [signer, f.nodeUrl]) // eslint-disable-line react-hooks/exhaustive-deps
  const [view, setView] = useState<NodesView>()
  const [err, setErr] = useState<string>()
  const following = status?.kind === 'following'

  const load = useCallback(async () => {
    if (!client) return
    try { setView(await client.nodes(f.chainId)); setErr(undefined) } catch (e) { setErr(message(e)) }
  }, [client, f.chainId])
  useEffect(() => { if (following) void load() }, [load, following, balanceTick])

  const [syncing, setSyncing] = useState(false)
  async function sync() {
    setSyncing(true)
    try { await syncNow(chain); await load() } finally { setSyncing(false) }
  }

  const isAdmin = !!view && same(view.admin, f.account)
  if (!following) return null
  return (
    <Panel title="Devices" badge={view && <Badge>Cloud head #{view.head.number}</Badge>}
      actions={<Button variant="ghost" size="sm" disabled={syncing} onClick={sync}>{syncing ? 'Syncing…' : 'Sync now'}</Button>}>
      {err && <div className="p-4"><Notice>{`Couldn't list devices: ${err}`}</Notice></div>}
      {view && <Members view={view} me={f.account} admin={isAdmin && client && signer ? { client, signer, chainId: f.chainId, after: load } : undefined} />}
      {isAdmin && client && signer && <InviteWizard deployRole={view.deployRole} client={client} signer={signer} nodeUrl={f.nodeUrl} chainId={f.chainId} />}
    </Panel>
  )
}

type Admin = { client: NodeClient; signer: ReturnType<typeof privateKeyToAccount>; chainId: string; after(): Promise<void> }

function Members({ view, me, admin }: { view: NodesView; me: string; admin?: Admin }) {
  const [removing, setRemoving] = useState<Member>()
  const [closeReads, setCloseReads] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ tone: 'success' | 'warn'; text: string }>()
  const label = (m: Member) => m.name ?? short(m.address)

  async function remove() {
    if (!admin || !removing) return
    setBusy(true); setFlash(undefined)
    try {
      await removeDevice({ client: admin.client, chainId: admin.chainId, admin: admin.signer, member: removing, closeReads: view.readOpen && closeReads })
      setFlash({ tone: 'success', text: `Removed ${label(removing)}. It no longer gets updates from this chain.` })
      setRemoving(undefined)
      await admin.after()
    } catch (e) {
      setFlash({ tone: 'warn', text: `Couldn't remove ${label(removing)}: ${message(e)}` })
    } finally { setBusy(false) }
  }

  async function setDeploy(m: Member, grant: boolean) {
    if (!admin) return
    setBusy(true); setFlash(undefined)
    try {
      await (grant ? grantDeploy : removeDeploy)({ client: admin.client, chainId: admin.chainId, admin: admin.signer, member: m })
      setFlash({ tone: 'success', text: `${label(m)} ${grant ? 'can now' : 'can no longer'} deploy contracts.` })
      await admin.after()
    } catch (e) {
      setFlash({ tone: 'warn', text: `Couldn't ${grant ? 'grant' : 'remove'} deploy ${grant ? 'to' : 'from'} ${label(m)}: ${message(e)}` })
    } finally { setBusy(false) }
  }

  return (
    <>
      <Table>
        <table className="w-full">
          <thead><tr className="border-b border-line"><th className={th}>Name</th><th className={th}>Address</th><th className={th}>Role</th><th className={th}>Block</th><th className={th}>Position</th><th className={th}>Last seen</th>{admin && <th className={th}><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>
            {view.members.map((m) => (
              <tr key={m.address} className="border-b border-line last:border-0 align-top">
                <td className={td}>
                  <span className="break-all">{m.name ?? <span className="text-muted">no name yet</span>}</span>
                  {same(m.address, me) && <span className="ml-1 text-xs text-muted">(this device)</span>}
                </td>
                <td className={`${td} whitespace-nowrap font-mono text-xs`}>
                  <span title={m.address}>{short(m.address)}</span>
                  <button type="button" className="ml-1 align-middle text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent" aria-label={`Copy ${m.address}`} title="Copy address" onClick={() => navigator.clipboard?.writeText(m.address)}><CopyIcon /></button>
                </td>
                <td className={td}><Badge variant={m.role === 'admin' ? 'accent' : 'neutral'}>{m.role}</Badge>{view.deployRole && m.role === 'writer' && m.deploy && <Badge variant="neutral" className="ml-1">deploy</Badge>}</td>
                <td className={td}>{m.block === undefined ? <span className="text-muted">—</span> : `#${m.block}`}</td>
                <td className={td}>{m.behind === undefined ? <span className="text-muted">not synced yet</span> : m.behind ? `${m.behind} behind` : 'in sync'}</td>
                <td className={`${td} whitespace-nowrap text-xs text-muted`}>{m.seenAt === undefined ? '—' : <span title={new Date(m.seenAt * 1000).toLocaleString()}>{ago(m.seenAt)}</span>}</td>
                {admin && <td className={td}><div className="flex flex-wrap justify-end gap-1">
                  {view.deployRole && m.role === 'writer' && m.deploy && <Button variant="ghost" size="sm" aria-label={`Remove deploy from ${label(m)}`} disabled={busy} onClick={() => setDeploy(m, false)}>Remove deploy</Button>}
                  {view.deployRole && m.role === 'writer' && !m.deploy && <Button variant="ghost" size="sm" aria-label={`Grant deploy to ${label(m)}`} disabled={busy} onClick={() => setDeploy(m, true)}>Grant deploy</Button>}
                  {m.role !== 'admin' && <Button variant="danger-outline" size="sm" aria-label={`Remove ${label(m)}`} disabled={busy} onClick={() => { setRemoving(m); setCloseReads(false); setFlash(undefined) }}>Remove</Button>}
                </div></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Table>
      {(removing || flash) && (
        <div className="space-y-3 border-t border-line p-4">
          {removing && (
            <div role="alert" className="space-y-2 rounded-lg border border-warn bg-warn-soft px-3 py-2 text-sm text-warn-text">
              <p>Remove <span className="font-medium">{label(removing)}</span> ({short(removing.address)})? That device's copy stops updating.</p>
              {view.readOpen && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="size-4 accent-accent" checked={closeReads} onChange={(e) => setCloseReads(e.target.checked)} />
                  Close reads too: anyone can read this chain right now, so without this the removed device still can.
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" size="sm" disabled={busy} onClick={remove}>{busy ? 'Removing…' : 'Remove'}</Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(undefined)}>Cancel</Button>
              </div>
            </div>
          )}
          {flash && <Notice tone={flash.tone} onDismiss={() => setFlash(undefined)}>{flash.text}</Notice>}
        </div>
      )}
    </>
  )
}
