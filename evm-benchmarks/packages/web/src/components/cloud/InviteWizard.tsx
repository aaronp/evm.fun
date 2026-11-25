import { useState } from 'react'
import { generateCode, type NodeClient } from '@evmb/node/src/client'
import { inviteDefaults, inviteDevice, inviteShare, multiUseWriterWarning, singleLinkWarning, type DeviceRole } from '../../cloud/devices'
import { MAX_CODE_LENGTH, codeUsable } from '../../cloud/join'
import { Button } from '../../ui/button'
import { CopyIcon } from '../../ui/icons'
import { Input, fieldLabel } from '../../ui/input'
import { Notice } from '../../ui/notice'
import { Segmented } from '../../ui/segmented'
import { QrCode } from './QrCode'

const TTLS = [{ value: '300', content: '5 min' }, { value: '3600', content: '1 h' }, { value: '86400', content: '1 day' }]
const ROLES = [{ value: 'reader', content: 'Reader' }, { value: 'writer', content: 'Writer' }]
const message = (e: unknown) => (e && typeof e === 'object' && 'error' in e ? String(e.error) : e instanceof Error ? e.message : String(e))
const copy = (s: string) => navigator.clipboard?.writeText(s)

/** "Invite a device": step 1 creates the access code on chain, step 2 shows the link (and QR) to open on the other device. */
export function InviteWizard({ deployRole, client, signer, nodeUrl, chainId }: { deployRole: boolean; client: NodeClient; signer: Parameters<typeof inviteDevice>[0]['admin']; nodeUrl: string; chainId: string }) {
  const [code, setCode] = useState(generateCode)
  const [ttl, setTtl] = useState(inviteDefaults.ttl)
  const [uses, setUses] = useState(inviteDefaults.uses)
  const [role, setRole] = useState<DeviceRole>(inviteDefaults.role)
  const [deploy, setDeploy] = useState(inviteDefaults.deploy)
  const [singleLink, setSingleLink] = useState(inviteDefaults.singleLink)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const [shared, setShared] = useState<{ link: string; code?: string; warn?: string; role?: string }>() // step 2; shown once, until Invite another / Done
  const [closed, setClosed] = useState(false)
  const n = Number(uses)
  const valid = codeUsable(code) && Number.isInteger(n) && n >= 1 && n <= 1000
  const warning = multiUseWriterWarning(role, n)

  function reset() { setTtl(inviteDefaults.ttl); setUses(inviteDefaults.uses); setRole(inviteDefaults.role); setDeploy(inviteDefaults.deploy); setSingleLink(inviteDefaults.singleLink); setShared(undefined) }

  async function next() {
    setBusy(true); setErr(undefined)
    try {
      await inviteDevice({ client, chainId, admin: signer, code, ttlS: Number(ttl), uses: n, role, deploy: deployRole && deploy })
      setShared({ role: role === 'writer' && deployRole && deploy ? 'writer who can deploy contracts' : role, ...inviteShare({ base: location.origin + location.pathname, nodeUrl, chainId, code, singleLink }), ...(singleLink && { warn: singleLinkWarning(role) }) })
      setCode(generateCode())
    } catch (e) {
      setErr(`Couldn't create the invite: ${message(e)}`)
    } finally { setBusy(false) }
  }

  if (closed) return <div className="border-t border-line p-4"><Button type="button" variant="ghost" onClick={() => setClosed(false)}>Invite a device</Button></div>

  if (shared) return (
    <div className="space-y-3 border-t border-line p-4">
      <h3 className="font-medium">Invite a device <span className="text-xs font-normal text-muted">· step 2 of 2</span></h3>
      <p className="text-sm">Open this on another device: scan the QR code or use the link. It joins as a {shared.role}.</p>
      <div className="flex flex-wrap items-start gap-4">
        <QrCode value={shared.link} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-all font-mono text-xs">{shared.link}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => copy(shared.link)}><CopyIcon className="mr-1" />Copy link</Button>
          </div>
          {shared.code ? (
            <div className="space-y-1 text-sm">
              <p>Then enter this code on that device. Send it separately from the link.</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono font-medium">{shared.code}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => copy(shared.code!)}><CopyIcon className="mr-1" />Copy code</Button>
              </div>
            </div>
          ) : <p className="text-sm text-muted">The link includes the code. {shared.warn}</p>}
          <p className="text-xs text-muted">The code is shown only once.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={reset}>Invite another</Button>
        <Button type="button" variant="ghost" onClick={() => { reset(); setClosed(true) }}>Done</Button>
      </div>
    </div>
  )

  return (
    <form className="space-y-3 border-t border-line p-4" onSubmit={(e) => { e.preventDefault(); next() }}>
      <h3 className="font-medium">Invite a device <span className="text-xs font-normal text-muted">· step 1 of 2: create an access code</span></h3>
      <label className={fieldLabel}>
        Code
        <div className="flex gap-2">
          <Input aria-label="Invite code" className="min-w-0 flex-1 font-mono" autoComplete="off" maxLength={MAX_CODE_LENGTH} value={code} onChange={(e) => setCode(e.target.value)} />
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
      </div>
      {warning && <Notice>{warning}</Notice>}
      {deployRole && role === 'writer' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-accent" checked={deploy} onChange={(e) => setDeploy(e.target.checked)} />
          Can deploy contracts
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={singleLink} onChange={(e) => setSingleLink(e.target.checked)} />
        Create a single join link (includes the code)
      </label>
      {singleLink && <Notice>{singleLinkWarning(role)}</Notice>}
      <p className="text-xs text-muted">Readers get a read-only copy. Only the code's hash goes on chain.</p>
      {err && <Notice onDismiss={() => setErr(undefined)}>{err}</Notice>}
      <Button type="submit" disabled={busy || !valid}>{busy ? 'Inviting…' : 'Next'}</Button>
    </form>
  )
}
