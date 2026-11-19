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
import { KEYS_WARNING, Notice } from '../ui/notice'

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
  return (
    <div className="space-y-4">
      <Notice>{KEYS_WARNING}</Notice>
      <form
        className="flex gap-2"
        onSubmit={e => {
          e.preventDefault()
          const a = accounts.create(label.trim() || `Account ${list.length + 1}`)
          if (!account) selectAccount(a.address)
          setLabel('')
          bump(n => n + 1)
        }}
      >
        <Input className="min-w-0 flex-1 sm:flex-none" placeholder="Label" value={label} onChange={e => setLabel(e.target.value)} />
        <Button type="submit">Create account</Button>
      </form>
      {list.length === 0 && <p className="text-sm text-muted">No accounts yet.</p>}
      {list.map(a => (
        <Card key={a.address} className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              {a.label} {a.address === account && <Badge variant="accent">selected</Badge>}
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
