import { useEffect, useRef, useState } from 'react'
import { erc20Abi, getAddress, isAddress, zeroAddress, zeroHash } from 'viem'
import { assetId, readTokenInfo, type Asset } from '@evmb/assets'
import type { ChainHandle } from '../chain/handle'
import { assetRegistry } from '../assets/registry'
import { tokenAsset } from '../assets/build'
import { contractsRegistry } from '../contracts/registry'
import { formatAmount } from '../assets/ui'
import { Button } from '../ui/button'
import { fieldLabel, Input } from '../ui/input'
import { Notice } from '../ui/notice'

type Info = Awaited<ReturnType<typeof readTokenInfo>>

/** Native modal, mounted per open (state resets on unmount); the parent unmounts it on onClose. */
export function ImportTokenDialog({ chain, known, onAdded, onClose }: {
  chain: ChainHandle; known: Asset[]; onAdded: (a: Asset) => void; onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState('')
  const [info, setInfo] = useState<Info>()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const chainId = chain.info.id
  const addr = text.trim()
  const dup = isAddress(addr) && known.some(a => a.id === assetId(chainId, addr))

  useEffect(() => { ref.current?.showModal() }, [])

  async function lookup() {
    setErr(undefined); setInfo(undefined)
    if (!isAddress(addr)) return setErr('Not a valid address (check the checksum).')
    if (dup) return
    setBusy(true)
    try { setInfo(await readTokenInfo(chain.request, getAddress(addr))) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function add() {
    if (!info) return
    setBusy(true)
    try {
      const address = getAddress(addr)
      const a = tokenAsset(chainId, address, info, { origin: 'imported', issuer: info.owner, mintable: false })
      await contractsRegistry.add(chainId, { address, name: a.name, abi: erc20Abi as any, deployer: info.owner ?? zeroAddress, txHash: zeroHash })
      await assetRegistry.add(a)
      onAdded(a)
      ref.current?.close()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} onCancel={e => busy && e.preventDefault()} aria-labelledby="imp-title" className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-5 text-text backdrop:bg-bg/70">
      <form method="dialog" className="space-y-3" onSubmit={e => { e.preventDefault(); info ? add() : lookup() }}>
        <h2 id="imp-title" className="font-display text-base font-semibold">Import token by address</h2>
        {err && <Notice>{err}</Notice>}
        <label className={fieldLabel}>
          Token address
          <Input aria-label="Token address" className="font-mono" placeholder="0x…" value={text} onChange={e => { setText(e.target.value); setInfo(undefined); setErr(undefined) }} />
        </label>
        {dup && <p role="status" className="text-sm text-muted">Already in assets</p>}
        {info && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-line bg-surface p-3 text-[13px]">
            <dt className="text-subtle">Symbol</dt><dd className="font-semibold">{info.symbol}</dd>
            <dt className="text-subtle">Name</dt><dd>{info.name}</dd>
            <dt className="text-subtle">Decimals</dt><dd className="font-mono">{info.decimals}</dd>
            <dt className="text-subtle">Total supply</dt><dd className="font-mono">{formatAmount(info.totalSupply, info.decimals)}</dd>
          </dl>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => ref.current?.close()}>Cancel</Button>
          {info ? <Button type="submit" disabled={busy}>Add</Button> : <Button type="submit" disabled={busy || dup || !addr}>{busy ? 'Reading…' : 'Look up'}</Button>}
        </div>
      </form>
    </dialog>
  )
}
