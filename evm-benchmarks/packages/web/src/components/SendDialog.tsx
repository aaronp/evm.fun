import { useState, type RefObject } from 'react'
import { isAddress, type Address } from 'viem'
import { transferCall, type Asset } from '@evmb/assets'
import type { ChainHandle } from '../chain/handle'
import type { Account } from '../store/accounts'
import { signAndSend } from '../tx/send'
import { formatAmount, parseAmount, shortAddress } from '../assets/ui'
import { Button } from '../ui/button'
import { fieldLabel, Input, Select } from '../ui/input'
import { Notice } from '../ui/notice'
import { orThrow, useWizardAction, useWizardField, useWizardMark, useWizardReport } from '../walkthrough/wizard'
import { WizardInline } from './WizardInline'

const OTHER = 'other'

/** Native modal; the parent mounts it per send and opens it with ref.current.showModal(), unmounting on onClose (state resets). Esc/Cancel close it, and the browser restores focus to the opener. */
export function SendDialog({ dialogRef, chain, asset, from, balance, accounts, onSent, onClose }: {
  dialogRef: RefObject<HTMLDialogElement | null>
  chain: ChainHandle
  asset: Asset
  from?: Account
  balance?: bigint
  accounts: Account[]
  onSent: () => void
  onClose: () => void
}) {
  const others = accounts.filter(a => a.address !== from?.address)
  const [to, setTo] = useState<string>(others[0]?.address ?? OTHER)
  const [other, setOther] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  useWizardField('send.to', to, setTo)
  useWizardField('send.amount', amount, setAmount)
  const report = useWizardReport(), mark = useWizardMark()

  /** returns the error message when it failed */
  async function send() {
    const fail = (e: string) => (setErr(e), e)
    setErr(undefined)
    const dest = to === OTHER ? other.trim() : to
    if (!isAddress(dest)) return fail('Recipient is not a valid address (check the checksum).')
    const amt = parseAmount(amount, asset.decimals)
    if ('error' in amt) return fail(amt.error)
    if (amt.ok === 0n) return fail('Amount must be more than 0')
    if (balance !== undefined && amt.ok > balance) return fail('More than the balance')
    if (!from) return fail('Select an account first.')
    setBusy(true)
    try {
      const tx = asset.kind === 'native' ? { to: dest as Address, value: amt.ok } : transferCall(asset, dest as Address, amt.ok)
      const r = await signAndSend(chain, from, tx, onSent)
      if (r.status !== 'success') throw new Error(`Transfer ${r.status}${r.error ? `: ${r.error}` : ''}`)
      report('send.submit', { tx: r.hash })
      dialogRef.current?.close()
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  useWizardAction('send.submit', busy ? undefined : () => orThrow(send()))

  return (
    <dialog ref={dialogRef} onClose={onClose} onCancel={e => busy && e.preventDefault()} aria-labelledby="send-title" className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-5 text-text backdrop:bg-bg/70">
      <form method="dialog" className="space-y-3" onSubmit={e => { e.preventDefault(); send() }}>
        <h2 id="send-title" className="font-display text-base font-semibold">Send {asset.symbol}</h2>
        <WizardInline step="transfer" />
        <p className="text-sm text-muted">
          From <span className="font-semibold text-text">{from?.label}</span>
          {balance !== undefined && <> · <span className="font-mono">{formatAmount(balance, asset.decimals, asset.kind === 'native' ? 8 : undefined)} {asset.symbol}</span></>}
        </p>
        {err && <Notice>{err}</Notice>}
        <label className={fieldLabel}>
          To
          <Select aria-label="To" value={to} onChange={e => setTo(e.target.value)}>
            {others.map(a => <option key={a.address} value={a.address}>{a.label} ({shortAddress(a.address)})</option>)}
            <option value={OTHER}>Other address…</option>
          </Select>
        </label>
        {to === OTHER && <Input aria-label="Recipient address" className="w-full font-mono" placeholder="0x…" value={other} onChange={e => setOther(e.target.value)} />}
        <label className={fieldLabel}>
          Amount ({asset.symbol})
          <Input aria-label="Amount" className="font-mono" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => dialogRef.current?.close()}>Cancel</Button>
          <Button {...mark('send.submit')} type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send'}</Button>
        </div>
      </form>
    </dialog>
  )
}
