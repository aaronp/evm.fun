import { useEffect, useRef, useState } from 'react'
import { encodeDeployData } from 'viem'
import type { Asset } from '@evmb/assets'
import { AssetToken } from '@evmb/contracts'
import type { ChainHandle } from '../chain/handle'
import type { Account } from '../store/accounts'
import { signAndSend } from '../tx/send'
import { assetRegistry } from '../assets/registry'
import { tokenAsset } from '../assets/build'
import { contractsRegistry } from '../contracts/registry'
import { MAX_NAME } from '../chain/chainFile'
import { parseAmount, shortAddress } from '../assets/ui'
import { Button } from '../ui/button'
import { fieldLabel, Input, Select } from '../ui/input'
import { Notice } from '../ui/notice'

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

  useEffect(() => { ref.current?.showModal() }, [])

  async function launch() {
    setErr(undefined)
    const n = name.trim(), s = symbol.trim()
    if (!n || !s) return setErr('Name and symbol are required.')
    if (n.length > MAX_NAME || s.length > MAX_NAME) return setErr(`Name and symbol are at most ${MAX_NAME} characters.`)
    const dec = Number(decimals)
    if (!/^\d+$/.test(decimals.trim()) || dec > 255) return setErr('Decimals is a whole number from 0 to 255.')
    const sup = parseAmount(supply, dec)
    if ('error' in sup) return setErr(`Initial supply: ${sup.error}`)
    const from = accounts.find(a => a.address === issuer)
    if (!from) return setErr('Select an issuer account first.')
    setBusy(true)
    try {
      const data = encodeDeployData({ abi: AssetToken.abi, bytecode: AssetToken.bytecode, args: [n, s, dec, sup.ok, from.address] })
      const r = await signAndSend(chain, from, { data }, onSent)
      if (r.status !== 'success' || !r.contractAddress) throw new Error(`Deploy ${r.status}${r.error ? `: ${r.error}` : ''}`)
      const a = tokenAsset(chain.info.id, r.contractAddress, { symbol: s, name: n, decimals: dec }, { origin: 'launched', issuer: from.address, mintable: true })
      await contractsRegistry.add(chain.info.id, { address: r.contractAddress, name: a.name, abi: AssetToken.abi as any[], deployer: from.address, txHash: r.hash })
      await assetRegistry.add(a)
      onLaunched(a)
      ref.current?.close()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} onCancel={e => busy && e.preventDefault()} aria-labelledby="launch-title" className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-5 text-text backdrop:bg-bg/70">
      <form method="dialog" className="space-y-3" onSubmit={e => { e.preventDefault(); launch() }}>
        <h2 id="launch-title" className="font-display text-base font-semibold">Launch asset</h2>
        {err && <Notice>{err}</Notice>}
        <label className={fieldLabel}>Name<Input aria-label="Name" value={name} maxLength={MAX_NAME} onChange={e => setName(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>Symbol<Input aria-label="Symbol" value={symbol} maxLength={MAX_NAME} onChange={e => setSymbol(e.target.value)} /></label>
          <label className={fieldLabel}>Decimals<Input aria-label="Decimals" className="font-mono" inputMode="numeric" value={decimals} onChange={e => setDecimals(e.target.value)} /></label>
        </div>
        <label className={fieldLabel}>Initial supply (whole units)<Input aria-label="Initial supply" className="font-mono" inputMode="decimal" value={supply} onChange={e => setSupply(e.target.value)} /></label>
        <label className={fieldLabel}>Issuer (signs the deploy, receives the supply)
          <Select aria-label="Issuer" value={issuer} onChange={e => setIssuer(e.target.value)}>
            {accounts.map(a => <option key={a.address} value={a.address}>{a.label} ({shortAddress(a.address)})</option>)}
          </Select>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => ref.current?.close()}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Launching…' : 'Launch'}</Button>
        </div>
      </form>
    </dialog>
  )
}
