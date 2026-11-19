import { useAppBar } from '../state/appBar'
import { useState } from 'react'
import { ChainTypeHelp, ChainTypePicker } from '../components/ChainTypeHelp'
import { accounts } from '../store/accounts'
import { registry } from '../chain/revm'
import type { ChainType } from '../chain/registry'
import { useApp } from '../state'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import { Input } from '../ui/input'
import { Notice } from '../ui/notice'

export function Chains() {
  useAppBar({ title: 'Chains' })
  const { chains, chain, error, selectChain, refresh } = useApp()
  const list = accounts.list()
  const [name, setName] = useState('')
  const [type, setType] = useState<ChainType>('plain')
  const [off, setOff] = useState<Set<string>>(new Set()) // unchecked; default is all accounts
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()

  async function create() {
    setBusy(true)
    setErr(undefined)
    try {
      const h = await registry.create(name.trim() || `Chain ${chains.length + 1}`, type, list.map(a => a.address).filter(a => !off.has(a)))
      await refresh()
      await selectChain(h.info.id)
      setName('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {(err || error) && <Notice>{err ?? error!}</Notice>}
      <Card className="space-y-3">
        <Input className="w-full sm:w-72" placeholder="Chain name" value={name} onChange={e => setName(e.target.value)} />
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
        <Button disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create chain'}</Button>
      </Card>
      {chains.length === 0 && <p className="text-sm text-muted">No chains yet.</p>}
      {chains.map(c => (
        <Card key={c.id} className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 font-medium">
              {c.name} {c.id === chain?.info.id && <Badge variant="accent">selected</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge>{c.type}</Badge>{c.ephemeral && <Badge variant="warn">benchmark (not saved)</Badge>}<span>{c.createdAt}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => selectChain(c.id)}>Select</Button>
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                if (!confirm(`Delete chain "${c.name}"?`)) return
                if (c.id === chain?.info.id) await selectChain(undefined)
                await registry.remove(c.id)
                await refresh()
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
