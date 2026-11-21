import { useEffect, useState } from 'react'
import { erc20Abi, isAddress, type Address } from 'viem'
import { allowances as readAllowances, approveCall, MAX_UINT256, type Asset } from '@evmb/assets'
import type { ChainHandle } from '../chain/handle'
import type { Account } from '../store/accounts'
import { readContract, signAndSend } from '../tx/send'
import { allowanceLabel, parseAmount, shortAddress } from '../assets/ui'
import { Button } from '../ui/button'
import { GasFix } from './Shortfall'

const OTHER = 'other'
const field = 'min-h-11 w-full rounded-[10px] border border-input-line bg-surface px-3 text-sm text-text placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'
const lab = 'text-xs font-medium text-text-2'
type Row = { owner: Address; spender: Address; amount: bigint }

/** The Allowances card: live table with Revoke, and the Approve a spender form. Both re-read on `tick`. */
export function AllowancesCard({ chain, asset, people, tick, onSent }: {
  chain: ChainHandle; asset: Asset; people: Account[]; tick: number; onSent: () => void
}) {
  const [rows, setRows] = useState<Row[]>()
  const [readErr, setReadErr] = useState<string>()
  const [owner, setOwner] = useState<string>(people[0]?.address ?? '')
  const [spender, setSpender] = useState<string>(people[1]?.address ?? OTHER)
  const [other, setOther] = useState('')
  const [amount, setAmount] = useState('')
  const [unlimited, setUnlimited] = useState(false)
  const [current, setCurrent] = useState<bigint>()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>() // amount-field validation / approve failure
  const [revokeErr, setRevokeErr] = useState<string>()
  const [flash, setFlash] = useState<string>()
  const [revokeFlash, setRevokeFlash] = useState<string>()
  const who = (a: string) => people.find(p => p.address.toLowerCase() === a.toLowerCase())?.label ?? shortAddress(a)
  const spenderAddr = spender === OTHER ? other.trim() : spender
  const ownerAcc = people.find(p => p.address === owner)

  useEffect(() => { setRows(undefined); setReadErr(undefined) }, [chain, asset.id])
  useEffect(() => {
    let live = true
    readAllowances(chain.request, asset).then(r => live && (setRows(r), setReadErr(undefined)), e => live && (setRows(undefined), setReadErr(e instanceof Error ? e.message : String(e))))
    return () => { live = false }
  }, [chain, asset, tick])

  useEffect(() => {
    setCurrent(undefined)
    if (!owner || !isAddress(spenderAddr)) return
    let live = true
    readContract(chain, asset.address!, erc20Abi, 'allowance', [owner, spenderAddr]).then(v => live && setCurrent(v as bigint), () => {})
    return () => { live = false }
  }, [chain, asset, owner, spenderAddr, tick])

  async function send(verb: 'Approve' | 'Revoke', acc: Account, to: Address, value: bigint, done: string, ok: (m: string) => void, fail: (m: string) => void) {
    setBusy(true); setErr(undefined); setRevokeErr(undefined); setFlash(undefined); setRevokeFlash(undefined)
    try {
      const r = await signAndSend(chain, acc, approveCall(asset, to, value), onSent)
      if (r.status !== 'success') throw new Error(`${verb} ${r.status}${r.error ? `: ${r.error}` : ''}`)
      ok(done)
      return true
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    setErr(undefined); setFlash(undefined)
    if (!ownerAcc) return setErr('Select an owner account first.')
    if (!isAddress(spenderAddr)) return setErr('Spender is not a valid address (check the checksum).')
    let value = MAX_UINT256
    if (!unlimited) {
      const p = parseAmount(amount, asset.decimals)
      if ('error' in p) return setErr(p.error)
      if (p.ok === 0n) return setErr('Amount must be more than 0 (use Revoke to remove an allowance).')
      value = p.ok
    }
    if (await send('Approve', ownerAcc, spenderAddr, value, `Approved — approve(${who(spenderAddr)}, ${allowanceLabel(value, asset.decimals, asset.symbol)}) sent by ${ownerAcc.label}.`, setFlash, setErr)) setAmount('')
  }

  return (
    <section aria-labelledby="alw-h" className="overflow-hidden rounded-2xl border border-line-strong bg-surface">
      <div className="flex flex-col gap-1 border-b border-line px-[22px] py-4">
        <h2 id="alw-h" className="text-[15px] font-semibold">Allowances</h2>
        <span className="text-[13px] text-muted">An allowance lets a spender move up to that much of the owner’s {asset.symbol}. Swaps, pools and order books will need one.</span>
      </div>
      <div className="flex flex-wrap items-stretch">
        <div className="flex min-w-0 flex-[999_1_340px] flex-col">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_80px] gap-3 px-[22px] py-2.5 text-xs text-text-2">
            <span>Owner</span><span>Spender</span><span className="text-right">Allowance</span><span />
          </div>
          {rows?.map(r => {
            const acc = people.find(p => p.address.toLowerCase() === r.owner.toLowerCase())
            return (
              <div key={`${r.owner}:${r.spender}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_80px] items-center gap-3 border-t border-line px-[22px] py-3 text-[13px]">
                <span className="truncate font-semibold">{who(r.owner)}</span>
                <span className="truncate">{who(r.spender)}</span>
                <span className="text-right font-mono">{allowanceLabel(r.amount, asset.decimals, asset.symbol)}</span>
                <span title={acc ? undefined : 'The owner is not one of your accounts, so it cannot sign the revoke.'} className="inline-flex justify-end">
                <Button variant="danger-outline" size="chip" disabled={!acc || busy} aria-label={`Revoke ${who(r.spender)} as spender for ${who(r.owner)}`}
                  onClick={() => acc && send('Revoke', acc, r.spender, 0n, `Revoked — approve(${who(r.spender)}, 0) sent by ${acc.label}.`, setRevokeFlash, setRevokeErr)}>Revoke</Button>
                </span>
              </div>
            )
          })}
          {readErr && <div role="alert" className="border-t border-line p-[22px] text-[13px] text-danger">Couldn’t read allowances: {readErr}</div>}
          {revokeFlash && <div role="status" className="border-t border-line px-[22px] py-3 text-xs text-success-text">{revokeFlash}</div>}
          {revokeErr && <div role="alert" className="border-t border-line px-[22px] py-3 text-xs text-danger">{revokeErr}</div>}
          {revokeErr && <div className="px-[22px] pb-3"><GasFix error={revokeErr} /></div>}
          {!readErr && rows?.length === 0 && <div className="border-t border-line p-[22px] text-[13px] text-muted">No allowances on {asset.symbol} yet.</div>}
        </div>

        <form aria-labelledby="ap-h" onSubmit={e => { e.preventDefault(); approve() }} className="flex flex-[1_1_300px] flex-col gap-3 border-l border-line bg-panel px-[22px] py-[18px]">
          <h3 id="ap-h" className="text-sm font-semibold">Approve a spender</h3>
          <label className="flex flex-col gap-1.5"><span className={lab}>Owner (signs the tx)</span>
            <select className={field} value={owner} onChange={e => setOwner(e.target.value)}>
              {people.map(p => <option key={p.address} value={p.address}>{p.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5"><span className={lab}>Spender</span>
            <select className={field} value={spender} onChange={e => setSpender(e.target.value)}>
              {people.map(p => <option key={p.address} value={p.address}>{p.label}</option>)}
              <option value={OTHER}>Other address…</option>
            </select>
          </label>
          {spender === OTHER && <input aria-label="Spender address" className={`${field} font-mono`} placeholder="0x…" value={other} onChange={e => setOther(e.target.value)} />}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="am" className={lab}>Amount</label>
            <div className={`flex min-h-11 items-center rounded-[10px] border bg-surface px-3 ${err ? 'border-danger' : 'border-input-line'}`}>
              <input id="am" inputMode="decimal" disabled={unlimited} value={unlimited ? 'max' : amount} onChange={e => { setAmount(e.target.value); setErr(undefined) }}
                aria-invalid={!!err} aria-describedby={err ? 'am-err' : undefined}
                className="min-h-10 min-w-0 flex-1 bg-transparent font-mono text-sm font-medium text-text focus-visible:outline-none" />
              <span className="text-xs text-subtle">{asset.symbol}</span>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text-2">
              <input type="checkbox" checked={unlimited} onChange={e => { setUnlimited(e.target.checked); setErr(undefined) }} className="size-4 accent-accent" />
              Unlimited (max uint256)
            </label>
            {err && <span id="am-err" role="alert" className="text-xs text-danger">{err}</span>}
            <GasFix error={err} />
          </div>
          <div className="text-xs text-subtle">Currently allowed: <span className="font-mono text-text">{current === undefined ? '—' : allowanceLabel(current, asset.decimals, asset.symbol)}</span></div>
          <Button type="submit" disabled={busy} className="min-h-11 rounded-[10px] font-semibold">{busy ? 'Sending…' : 'Approve'}</Button>
          {flash && <span role="status" className="text-xs text-success-text">{flash}</span>}
        </form>
      </div>
    </section>
  )
}
