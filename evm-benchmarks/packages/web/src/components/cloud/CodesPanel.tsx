import { useCallback, useEffect, useState } from 'react'
import { keccak256, type Address, type LocalAccount } from 'viem'
import { generateCode, inviteTx, mined, type CodeRecord, type NodeClient } from '@evmb/node/src/client'
import { Button } from '../../ui/button'
import { Input, fieldLabel } from '../../ui/input'
import { Notice } from '../../ui/notice'
import { Panel } from '../../ui/panel'
import { Segmented } from '../../ui/segmented'
import { Table, td, th } from '../../ui/table'

const TTLS = [{ value: '300', content: '5 min' }, { value: '3600', content: '1 h' }, { value: '86400', content: '1 day' }]
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`
const message = (e: unknown) => (e && typeof e === 'object' && 'error' in e ? String(e.error) : e instanceof Error ? e.message : String(e))

/** "12 min", "3 h", "2 days" until `expiry` (unix s), or "expired". */
export function expiresIn(expiry: number, now = Date.now() / 1000): string {
  const s = expiry - now
  if (s <= 0) return 'expired'
  if (s < 3600) return `${Math.ceil(s / 60)} min`
  if (s < 86400) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} days`
}

/** Root admin only: issue a deploy code (an invite tx on the root chain) and list the codes issued. */
export function CodesPanel({ client, account, access }: { client: NodeClient; account: LocalAccount; access: Address }) {
  const [code, setCode] = useState(generateCode)
  const [ttl, setTtl] = useState('3600')
  const [uses, setUses] = useState('1')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ tone: 'success' | 'warn'; text: string }>()
  const [codes, setCodes] = useState<CodeRecord[]>()
  const [listErr, setListErr] = useState<string>()

  const load = useCallback(() => client.codes().then((c) => { setCodes(c); setListErr(undefined) }, (e) => setListErr(message(e))), [client])
  useEffect(() => { load() }, [load])

  async function issue() {
    setBusy(true)
    setFlash(undefined)
    try {
      const raw = await inviteTx(account, await client.nonce('root'), access, code.trim(), Number(ttl), Number(uses))
      const { head } = mined(await client.submit('root', [raw]))
      setFlash({ tone: 'success', text: `Code "${code.trim()}" is ready — share it with whoever should deploy a chain. Invite tx ${keccak256(raw)} in root block #${head.number}.` })
      setCode(generateCode())
      await load()
    } catch (e) {
      setFlash({ tone: 'warn', text: `Couldn't issue the code: ${message(e)}` })
    } finally {
      setBusy(false)
    }
  }

  const n = Number(uses)
  const valid = code.trim().length > 0 && Number.isInteger(n) && n >= 1 && n <= 1000
  return (
    <>
      <Panel title="Issue a deploy code">
        <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); issue() }}>
          <label className={fieldLabel}>
            Code
            <div className="flex gap-2">
              <Input aria-label="Code" className="min-w-0 flex-1 font-mono" value={code} onChange={(e) => setCode(e.target.value)} />
              <Button type="button" variant="ghost" onClick={() => setCode(generateCode())}>Generate</Button>
            </div>
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <div className={fieldLabel}>
              Valid for
              <Segmented label="Valid for" name="code-ttl" value={ttl} onChange={setTtl} options={TTLS} className="flex gap-1" itemClassName="px-2.5 py-1 text-xs" />
            </div>
            <label className={fieldLabel}>
              Uses
              <Input type="number" min={1} max={1000} className="w-24" value={uses} onChange={(e) => setUses(e.target.value)} />
            </label>
            <Button type="submit" disabled={busy || !valid}>{busy ? 'Issuing…' : 'Issue code'}</Button>
          </div>
          <p className="text-xs text-muted">Only the code's hash goes on chain; the code itself is shown once, here.</p>
          {flash && <Notice tone={flash.tone} onDismiss={() => setFlash(undefined)}>{flash.text}</Notice>}
        </form>
      </Panel>
      <Panel title="Codes" actions={<Button variant="ghost" size="sm" onClick={load}>Refresh</Button>}>
        {listErr && <div className="p-4"><Notice>{listErr}</Notice></div>}
        {codes && codes.length === 0 && <p className="p-4 text-muted">No codes yet.</p>}
        {codes && codes.length > 0 && (
          <Table>
            <table className="w-full">
              <thead><tr className="border-b border-line"><th className={th}>Code hash</th><th className={th}>Expires in</th><th className={th}>Uses left</th><th className={th}>Redeemed by → chain</th></tr></thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.hash} className="border-b border-line last:border-0 align-top">
                    <td className={`${td} font-mono text-xs`} title={c.hash}>{short(c.hash)}</td>
                    <td className={td}>{expiresIn(c.expiry)}</td>
                    <td className={td}>{c.usesLeft}</td>
                    <td className={`${td} font-mono text-xs`}>
                      {c.redeemed.length === 0 ? <span className="text-muted">—</span>
                        : c.redeemed.map((r, i) => <div key={i} title={`${r.by} → ${r.chainId}`}>{short(r.by)} → {r.chainId}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Table>
        )}
      </Panel>
    </>
  )
}
