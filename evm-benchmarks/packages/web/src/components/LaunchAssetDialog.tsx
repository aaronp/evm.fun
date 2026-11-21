import { useEffect, useRef, useState } from 'react'
import type { Asset } from '@evmb/assets'
import type { ChainHandle } from '../chain/handle'
import type { Account } from '../store/accounts'
import { launchToken, NotSavedError } from '../assets/launch'
import { MAX_NAME } from '../chain/chainFile'
import { parseAmount, shortAddress } from '../assets/ui'
import { Button } from '../ui/button'
import { fieldLabel, Input, Select } from '../ui/input'
import { Notice } from '../ui/notice'
import { orThrow, useWizardAction, useWizardField, useWizardMark, useWizardReport } from '../walkthrough/wizard'
import { WizardInline } from './WizardInline'
import { GasFix } from './Shortfall'

/** Native modal, mounted per open (state resets on unmount); the parent unmounts it on onClose. */
export function LaunchAssetDialog({ chain, accounts, onLaunched, onSent, onClose }: {
  chain: ChainHandle; accounts: Account[]; onLaunched: (a: Asset) => void; onSent: () => void; onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [decimals, setDecimals] = useState('18')
  const [supply, setSupply] = useState('')
  const [issuer, setIssuer] = useState<string>(accounts[0]?.address ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const [stuck, setStuck] = useState(false) // deployed but not saved: only Close is offered, so no duplicate deploy

  useEffect(() => { ref.current?.showModal() }, [])
  useWizardField('launch.name', name, setName)
  useWizardField('launch.symbol', symbol, setSymbol)
  useWizardField('launch.decimals', decimals, setDecimals)
  useWizardField('launch.supply', supply, setSupply)
  useWizardField('launch.issuer', issuer, setIssuer)
  const report = useWizardReport(), mark = useWizardMark()
  useWizardAction('launch.submit', busy || stuck ? undefined : () => orThrow(launch()))

  /** returns the error message when it failed */
  async function launch() {
    const fail = (e: string) => (setErr(e), e)
    setErr(undefined)
    const n = name.trim(), s = symbol.trim()
    if (!n || !s) return fail('Name and symbol are required.')
    if (n.length > MAX_NAME || s.length > MAX_NAME) return fail(`Name and symbol are at most ${MAX_NAME} characters.`)
    const dec = Number(decimals)
    if (!/^\d+$/.test(decimals.trim()) || dec > 255) return fail('Decimals is a whole number from 0 to 255.')
    const sup = parseAmount(supply, dec)
    if ('error' in sup) return fail(`Initial supply: ${sup.error}`)
    const from = accounts.find(a => a.address === issuer)
    if (!from) return fail('Select an issuer account first.')
    setBusy(true)
    try {
      const a = await launchToken(chain, from, { name: n, symbol: s, decimals: dec, supply: sup.ok }, onSent)
      onLaunched(a)
      report('launch.submit', { address: a.address!, symbol: a.symbol, name: a.name, decimals: a.decimals })
      ref.current?.close()
    } catch (e) {
      if (e instanceof NotSavedError) setStuck(true)
      setBusy(false)
      return fail(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} onCancel={e => busy && e.preventDefault()} aria-labelledby="launch-title" className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-5 text-text backdrop:bg-bg/70">
      <form method="dialog" className="space-y-3" onSubmit={e => { e.preventDefault(); launch() }}>
        <h2 id="launch-title" className="font-display text-base font-semibold">Launch asset</h2>
        <WizardInline step="launchAsset" />
        {err && <Notice>{err}</Notice>}
        <GasFix error={err} onClick={() => ref.current?.close()} />
        <label className={fieldLabel}>Name<Input {...mark('launch.name')} aria-label="Name" value={name} maxLength={MAX_NAME} onChange={e => setName(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>Symbol<Input {...mark('launch.symbol')} aria-label="Symbol" value={symbol} maxLength={MAX_NAME} onChange={e => setSymbol(e.target.value)} /></label>
          <label className={fieldLabel}>Decimals<Input {...mark('launch.decimals')} aria-label="Decimals" className="font-mono" inputMode="numeric" value={decimals} onChange={e => setDecimals(e.target.value)} /></label>
        </div>
        <label className={fieldLabel}>Initial supply (whole units)<Input {...mark('launch.supply')} aria-label="Initial supply" className="font-mono" inputMode="decimal" value={supply} onChange={e => setSupply(e.target.value)} /></label>
        <label className={fieldLabel}>Issuer (signs the deploy, receives the supply)
          <Select {...mark('launch.issuer')} aria-label="Issuer" value={issuer} onChange={e => setIssuer(e.target.value)}>
            {accounts.map(a => <option key={a.address} value={a.address}>{a.label} ({shortAddress(a.address)})</option>)}
          </Select>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => ref.current?.close()}>{stuck ? 'Close' : 'Cancel'}</Button>
          {!stuck && <Button {...mark('launch.submit')} type="submit" disabled={busy}>{busy ? 'Launching…' : 'Launch'}</Button>}
        </div>
      </form>
    </dialog>
  )
}
