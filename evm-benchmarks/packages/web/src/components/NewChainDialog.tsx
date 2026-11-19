import { forwardRef, useState } from 'react'
import { ChainTypeHelp, ChainTypePicker } from './ChainTypeHelp'
import { accounts } from '../store/accounts'
import { registry } from '../chain/revm'
import type { ChainType } from '../chain/registry'
import { useApp } from '../state'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Notice } from '../ui/notice'

/** Native modal; the parent opens it with ref.current.showModal(). Esc/Cancel close it, and the browser restores focus to the opener. */
export const NewChainDialog = forwardRef<HTMLDialogElement>(function NewChainDialog(_, ref) {
  const { chains, refresh, selectChain } = useApp()
  const list = accounts.list()
  const [name, setName] = useState('')
  const [type, setType] = useState<ChainType>('plain')
  const [off, setOff] = useState<Set<string>>(new Set()) // unchecked; default is all accounts
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const close = (e: { currentTarget: HTMLElement }) => (e.currentTarget.closest('dialog') as HTMLDialogElement).close()

  async function create(e: React.MouseEvent<HTMLButtonElement>) {
    const d = e.currentTarget.closest('dialog') as HTMLDialogElement
    setBusy(true)
    setErr(undefined)
    try {
      const h = await registry.create(name.trim() || `Chain ${chains.length + 1}`, type, list.map(a => a.address).filter(a => !off.has(a)))
      await refresh()
      await selectChain(h.info.id)
      setName('')
      d.close()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} aria-labelledby="new-chain-title" className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-5 text-text backdrop:bg-bg/70">
      <div className="space-y-3">
        <h2 id="new-chain-title" className="font-display text-base font-semibold">New chain</h2>
        {err && <Notice>{err}</Notice>}
        <Input aria-label="Chain name" className="w-full" placeholder="Chain name" value={name} onChange={e => setName(e.target.value)} />
        <div className="space-y-2 text-sm">
          <ChainTypePicker type={type} onChange={setType} />
          <ChainTypeHelp />
        </div>
        <div className="text-sm">
          Prefund 1,000 ETH:
          {list.length === 0 && <span className="text-muted"> no accounts</span>}
          {list.map(a => (
            <label key={a.address} className="block break-all">
              <input
                className="accent-accent"
                type="checkbox"
                checked={!off.has(a.address)}
                onChange={e => setOff(s => { const n = new Set(s); e.target.checked ? n.delete(a.address) : n.add(a.address); return n })}
              />{' '}
              {a.label} <span className="font-mono text-xs text-muted">{a.address}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create chain'}</Button>
        </div>
      </div>
    </dialog>
  )
})
