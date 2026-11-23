import { useCallback, useEffect, useMemo, useState } from 'react'
import { privateKeyToAccount } from 'viem/accounts'
import { NodeClient, generateCode, type Member, type NodesView } from '@evmb/node/src/client'
import type { ChainHandle } from '../../chain/handle'
import { followerStatus, statusBadge, type FollowerStatus } from '../../cloud/followerChain'
import { inviteDevice, multiUseWriterWarning, removeDevice, type DeviceRole } from '../../cloud/devices'
import { joinLink } from '../../cloud/join'
import { accounts } from '../../store/accounts'
import { useApp } from '../../state'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { CopyIcon } from '../../ui/icons'
import { Input, fieldLabel } from '../../ui/input'
import { Notice } from '../../ui/notice'
import { Panel } from '../../ui/panel'
import { Segmented } from '../../ui/segmented'
import { Table, td, th } from '../../ui/table'

const TTLS = [{ value: '300', content: '5 min' }, { value: '3600', content: '1 h' }, { value: '86400', content: '1 day' }]
const ROLES = [{ value: 'reader', content: 'Reader' }, { value: 'writer', content: 'Writer' }]
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`
const message = (e: unknown) => (e && typeof e === 'object' && 'error' in e ? String(e.error) : e instanceof Error ? e.message : String(e))
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** "just now", "5 min ago", "3 h ago", "2 days ago" since `at` (unix s). */
function ago(at: number, now = Date.now() / 1000) {
  const s = now - at
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} days ago`
}

/** A follower's status as a badge (nothing for other chains or one not opened yet). */
export function FollowerBadge({ chain }: { chain?: ChainHandle }) {
  const s = followerStatus(chain)
  if (!s) return null
  const b = statusBadge(s)
  return <Badge variant={b.tone} title={s.kind === 'following' ? `Block #${s.block}` : s.detail}>{b.text}</Badge>
}

/** Sync a follower now (every sync-interval mode, Manual included). */
export const syncNow = (h: ChainHandle) => (h.approach as unknown as { syncNow(): Promise<void> }).syncNow()

/** Status line for a follower's chain card, with what can be done about it. */
export function FollowerStatusLine({ chain, onDelete }: { chain: ChainHandle; onDelete(): void }) {
  const s = followerStatus(chain)
  const f = chain.info.follows
  if (!s || !f) return null
  const rejoin = `#/cloud/join?${new URLSearchParams({ node: f.nodeUrl, chain: f.chainId })}`
  if (s.kind === 'following') return <span className="text-xs text-text-2">Block #{s.block} · {s.behind ? `${s.behind} behind` : 'in sync'}</span>
  const tone = s.kind === 'unreachable' || s.kind === 'clock' || s.kind === 'needs-key' ? 'warn' : 'danger'
  const text = s.kind === 'unreachable' ? `${s.detail}. Retrying.` : s.detail
  const action = s.kind === 'needs-key' ? <a className="shrink-0 text-xs font-medium text-accent underline" href="#/accounts">Import key on Accounts</a>
    : s.kind === 'removed' || s.kind === 'mismatch' || s.kind === 'gone' ? (
      <span className="flex shrink-0 gap-2">
        {s.kind === 'mismatch' && <a className="text-xs font-medium text-accent underline" href={rejoin}>Re-join</a>}
        <Button variant="danger" size="sm" onClick={onDelete}>Delete</Button>
      </span>
    ) : undefined
  return <Notice tone={tone} action={action}>{text}</Notice>
}

/**
 * Devices on a follower's cloud chain: each member's name, role and position. The chain's admin (this browser's follow
 * account) can invite a device and remove members. Refreshes when the follower's head or status changes (its sync
 * interval) and on Sync now: no polling of its own.
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
      {isAdmin && client && signer && <Invite client={client} signer={signer} nodeUrl={f.nodeUrl} chainId={f.chainId} />}
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
                <td className={td}><Badge variant={m.role === 'admin' ? 'accent' : 'neutral'}>{m.role}</Badge></td>
                <td className={td}>{m.block === undefined ? <span className="text-muted">—</span> : `#${m.block}`}</td>
                <td className={td}>{m.behind === undefined ? <span className="text-muted">not synced yet</span> : m.behind ? `${m.behind} behind` : 'in sync'}</td>
                <td className={`${td} whitespace-nowrap text-xs text-muted`}>{m.seenAt === undefined ? '—' : <span title={new Date(m.seenAt * 1000).toLocaleString()}>{ago(m.seenAt)}</span>}</td>
                {admin && <td className={td}>{m.role !== 'admin' && <Button variant="danger-outline" size="sm" disabled={busy} onClick={() => { setRemoving(m); setCloseReads(false); setFlash(undefined) }}>Remove</Button>}</td>}
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

function Invite({ client, signer, nodeUrl, chainId }: { client: NodeClient; signer: Admin['signer']; nodeUrl: string; chainId: string }) {
  const [code, setCode] = useState(generateCode)
  const [ttl, setTtl] = useState('3600')
  const [uses, setUses] = useState('1')
  const [role, setRole] = useState<DeviceRole>('reader')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const [issued, setIssued] = useState<string>() // shown once, until dismissed or the next invite
  const n = Number(uses)
  const valid = code.trim().length > 0 && Number.isInteger(n) && n >= 1 && n <= 1000
  const warning = multiUseWriterWarning(role, n)
  const link = joinLink(location.origin + location.pathname, nodeUrl, chainId)

  async function invite() {
    setBusy(true); setErr(undefined); setIssued(undefined)
    try {
      await inviteDevice({ client, chainId, admin: signer, code, ttlS: Number(ttl), uses: n, role })
      setIssued(code.trim())
      setCode(generateCode())
    } catch (e) {
      setErr(`Couldn't create the invite: ${message(e)}`)
    } finally { setBusy(false) }
  }

  return (
    <form className="space-y-3 border-t border-line p-4" onSubmit={(e) => { e.preventDefault(); invite() }}>
      <h3 className="font-medium">Invite a device</h3>
      <label className={fieldLabel}>
        Code
        <div className="flex gap-2">
          <Input aria-label="Invite code" className="min-w-0 flex-1 font-mono" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button type="button" variant="ghost" onClick={() => setCode(generateCode())}>Generate</Button>
        </div>
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <div className={fieldLabel}>
          Valid for
          <Segmented label="Valid for" name="invite-ttl" value={ttl} onChange={setTtl} options={TTLS} className="flex gap-1" itemClassName="px-2.5 py-1 text-xs" />
        </div>
        <div className={fieldLabel}>
          Role
          <Segmented label="Role" name="invite-role" value={role} onChange={(v) => setRole(v as DeviceRole)} options={ROLES} className="flex gap-1" itemClassName="px-2.5 py-1 text-xs" />
        </div>
        <label className={fieldLabel}>
          Uses
          <Input type="number" min={1} max={1000} className="w-24" value={uses} onChange={(e) => setUses(e.target.value)} />
        </label>
        <Button type="submit" disabled={busy || !valid}>{busy ? 'Inviting…' : 'Invite'}</Button>
      </div>
      {warning && <Notice>{warning}</Notice>}
      <p className="text-xs text-muted">Readers get a read-only copy. Only the code's hash goes on chain.</p>
      {err && <Notice onDismiss={() => setErr(undefined)}>{err}</Notice>}
      {issued && (
        <div role="status" className="space-y-2 rounded-lg border border-success bg-success-soft px-3 py-2 text-sm text-success-text">
          <p>Send this code to the other device. It's shown only once.</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono font-medium">{issued}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => navigator.clipboard?.writeText(issued)}><CopyIcon className="mr-1" />Copy code</Button>
          </div>
          <p>On that device, open this link and enter the code:</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-all font-mono text-xs">{link}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => navigator.clipboard?.writeText(link)}><CopyIcon className="mr-1" />Copy link</Button>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setIssued(undefined)}>Done</Button>
        </div>
      )}
    </form>
  )
}
