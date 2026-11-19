import { useEffect, useState } from 'react'
import { formatEther } from 'viem'
import { accounts } from '../store/accounts'
import { useApp } from '../state'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { KEYS_WARNING, Notice } from '../ui/notice'

function Balance({ address }: { address: string }) {
  const { chain } = useApp()
  const [bal, setBal] = useState<string>()
  useEffect(() => {
    setBal(undefined)
    chain?.approach.getBalance(address as `0x${string}`).then(b => setBal(formatEther(b)), () => setBal('?'))
  }, [chain, address])
  if (!chain) return <span className="text-slate-400">no chain selected</span>
  return <span>{bal === undefined ? '…' : `${bal} ETH`}</span>
}

export function Accounts() {
  const { account, selectAccount } = useApp()
  const [, bump] = useState(0)
  const [label, setLabel] = useState('')
  const list = accounts.list()
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Accounts</h1>
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
        <input className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm sm:flex-none" placeholder="Label" value={label} onChange={e => setLabel(e.target.value)} />
        <Button type="submit">Create account</Button>
      </form>
      {list.length === 0 && <p className="text-sm text-slate-500">No accounts yet.</p>}
      {list.map(a => (
        <Card key={a.address} className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="font-medium">
              {a.label} {a.address === account && <span className="text-xs text-slate-500">(selected)</span>}
            </div>
            <div className="truncate font-mono text-xs">{a.address}</div>
            <div className="text-sm"><Balance address={a.address} /></div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => selectAccount(a.address)}>Select</Button>
            <Button variant="outline" onClick={() => navigator.clipboard?.writeText(a.address)}>Copy</Button>
            <Button
              variant="destructive"
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
