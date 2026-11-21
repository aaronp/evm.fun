import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Address } from 'viem'
import { useApp } from '../state'
import { accounts } from '../store/accounts'
import { formatEth, useBalance } from '../chain/useBalance'
import { Button } from '../ui/button'
import { Input, fieldLabel } from '../ui/input'
import { Menu } from './Menu'

const TONES = ['bg-tone-1-bg text-tone-1-fg', 'bg-tone-2-bg text-tone-2-fg', 'bg-tone-3-bg text-tone-3-fg', 'bg-tone-4-bg text-tone-4-fg']

/** An account's initial in a circle, coloured by its place in the list. */
function Avatar({ label, index }: { label: string; index: number }) {
  return <span aria-hidden="true" className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${TONES[index % TONES.length]}`}>{label[0]?.toUpperCase() ?? '?'}</span>
}

/** Mounted only while the menu is open, so balances are read lazily. */
function Balance({ address }: { address: Address }) {
  const { chain } = useApp()
  return <span className="ml-auto pl-4 font-mono text-xs text-muted">{formatEth(useBalance(chain, address))}</span>
}

/** The acting account (initial, label) and a menu to switch, create or manage accounts. */
export function ProfileMenu({ defaultOpen }: { defaultOpen?: boolean }) {
  const { account, selectAccount } = useApp()
  const nav = useNavigate()
  const dialog = useRef<HTMLDialogElement>(null)
  const [label, setLabel] = useState('')
  const people = accounts.list()
  const i = people.findIndex(p => p.address === account)
  const me = people[i]

  function create() {
    const a = accounts.create(label.trim() || `Account ${people.length + 1}`)
    selectAccount(a.address)
    dialog.current?.close()
  }

  return (
    <>
      <Menu label="Account menu" align="right" defaultOpen={defaultOpen}
        trigger={me
          ? <><Avatar label={me.label} index={i} /><span className="hidden max-w-32 truncate sm:inline">{me.label}</span></>
          : <span className="text-muted">No account</span>}
        items={[
          ...people.map((p, n) => ({
            key: p.address, checked: p.address === account, onSelect: () => selectAccount(p.address),
            label: <><Avatar label={p.label} index={n} /><span className="truncate">{p.label}</span><Balance address={p.address} /></>,
          })),
          { key: 'create', label: 'Create account…', separated: people.length > 0, onSelect: () => dialog.current?.showModal() },
          { key: 'manage', label: 'Manage accounts', onSelect: () => nav('/accounts') },
        ]} />
      <dialog ref={dialog} onClose={() => setLabel('')} aria-labelledby="create-account-title" className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-5 text-text backdrop:bg-bg/70">
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); create() }}>
          <h2 id="create-account-title" className="font-display text-lg font-semibold">Create account</h2>
          <label className={fieldLabel}>Label<Input autoFocus value={label} placeholder={`Account ${people.length + 1}`} onChange={e => setLabel(e.target.value)} /></label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>Cancel</Button>
            <Button type="submit">Create</Button>
          </div>
        </form>
      </dialog>
    </>
  )
}
