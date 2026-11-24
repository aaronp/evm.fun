import { useAppBar } from '../state/appBar'
import { useState } from 'react'
import { accounts } from '../store/accounts'
import { useApp } from '../state'
import { formatEth, useBalance } from '../chain/useBalance'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { CopyIcon } from '../ui/icons'
import { Input } from '../ui/input'
import { MAX_NAME } from '../chain/chainFile'
import { KEYS_WARNING, Notice } from '../ui/notice'
import { useWizardAction, useWizardField, useWizardMark, useWizardReport } from '../walkthrough/wizard'

function Balance({ address }: { address: `0x${string}` }) {
  const { chain } = useApp()
  const bal = useBalance(chain, address)
  if (!chain) return <span className="text-muted">no chain selected</span>
  return <span>{formatEth(bal)}</span>
}

export function Accounts() {
  useAppBar({ title: 'Accounts' })
  const { account, selectAccount } = useApp()
  const [, bump] = useState(0)
  const [label, setLabel] = useState('')
  const list = accounts.list()
  useWizardField('account.label', label, setLabel)
  const report = useWizardReport(), mark = useWizardMark()
  function create() {
    const a = accounts.create(label.trim() || `Account ${list.length + 1}`)
    if (!account) selectAccount(a.address)
    setLabel('')
    bump(n => n + 1)
    report('account.create', { label: a.label, address: a.address })
  }
  useWizardAction('account.create', create)
  const [key, setKey] = useState('')
  const [keyLabel, setKeyLabel] = useState('')
  const [importErr, setImportErr] = useState<string>()
  function importKey() {
    try {
      const a = accounts.import(keyLabel.trim() || `Account ${list.length + 1}`, key)
      if (!account) selectAccount(a.address)
      setKeyLabel(''); setKey(''); setImportErr(undefined)
      bump(n => n + 1)
    } catch (e) { setImportErr(e instanceof Error ? e.message : String(e)) }
  }
  const [editing, setEditing] = useState<string>()
  const [draft, setDraft] = useState('')
  function saveName(address: string) {
    if (draft.trim()) accounts.rename(address, draft)
    setEditing(undefined)
    bump(n => n + 1)
  }
  return (
    <div className="space-y-4">
      <Notice>{KEYS_WARNING}</Notice>
      <form {...mark('account.card')} className="flex gap-2" onSubmit={e => { e.preventDefault(); create() }}>
        <Input {...mark('account.label')} className="min-w-0 flex-1 sm:flex-none" placeholder="Label" maxLength={MAX_NAME} value={label} onChange={e => setLabel(e.target.value)} />
        <Button {...mark('account.create')} type="submit">Create account</Button>
      </form>
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); importKey() }}>
        <Input aria-label="Label for the imported key" className="min-w-0 flex-1 sm:flex-none" placeholder="Label" maxLength={MAX_NAME} value={keyLabel} onChange={e => setKeyLabel(e.target.value)} />
        <Input aria-label="Private key to import" type="password" autoComplete="off" className="min-w-0 flex-1 font-mono sm:max-w-md" placeholder="Or paste a private key (0x…)" value={key} onChange={e => setKey(e.target.value)} />
        <Button variant="ghost" type="submit" disabled={!key.trim()}>Import key</Button>
      </form>
      {importErr && <Notice onDismiss={() => setImportErr(undefined)}>{importErr}</Notice>}
      {list.length === 0 && <p className="text-sm text-muted">No accounts yet.</p>}
      {list.map(a => (
        <Card key={a.address} className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              {editing === a.address ? (
                <form onSubmit={e => { e.preventDefault(); saveName(a.address) }}>
                  <Input autoFocus aria-label={`New name for ${a.label}`} maxLength={MAX_NAME} value={draft}
                    onChange={e => setDraft(e.target.value)} onBlur={() => saveName(a.address)}
                    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setEditing(undefined) } }} />
                </form>
              ) : (
                <button type="button" className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-accent" title="Rename"
                  onClick={() => { setDraft(a.label); setEditing(a.address) }}>{a.label}</button>
              )}
              {a.address === account && <Badge variant="accent">selected</Badge>}
            </div>
            <div className="break-all font-mono text-xs text-muted">{a.address}</div>
            <div className="text-sm"><Balance address={a.address} /></div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={() => selectAccount(a.address)}>Select</Button>
            <Button variant="ghost" size="sm" onClick={() => navigator.clipboard?.writeText(a.address)}>
              <CopyIcon className="mr-1" />Copy
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                accounts.remove(a.address)
                if (a.address === account) selectAccount(accounts.list()[0]?.address)
                bump(n => n + 1)
              }}
            >
              Delete
            </Button>
          </div>
        </Card>
      ))}
    </div>
  )
}
