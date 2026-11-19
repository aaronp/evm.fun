import { useState } from 'react'
import { CHAIN_TYPE_BLURB, ChainTypeHelp } from '../components/ChainTypeHelp'
import { accounts } from '../store/accounts'
import { registry } from '../chain/revm'
import type { ChainType } from '../chain/registry'
import { useApp } from '../state'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Notice } from '../ui/notice'

export function Chains() {
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
      <h1 className="text-xl font-semibold">Chains</h1>
      {(err || error) && <Notice>{err ?? error!}</Notice>}
      <Card className="space-y-3">
        <input className="rounded-md border border-slate-300 px-2 py-1 text-sm" placeholder="Chain name" value={name} onChange={e => setName(e.target.value)} />
        <div className="space-y-1 text-sm">
          {(['plain', 'sequencer'] as const).map(t => (
            <label key={t} className="block"><input type="radio" name="type" checked={type === t} onChange={() => setType(t)} /> <b>{t}</b>: {CHAIN_TYPE_BLURB[t]}</label>
          ))}
          <ChainTypeHelp />
        </div>
        <div className="text-sm">
          Prefund 1,000 ETH:
          {list.length === 0 && <span className="text-slate-500"> no accounts</span>}
          {list.map(a => (
            <label key={a.address} className="block">
              <input
                type="checkbox"
                checked={!off.has(a.address)}
                onChange={e => setOff(s => { const n = new Set(s); e.target.checked ? n.delete(a.address) : n.add(a.address); return n })}
              />{' '}
              {a.label} <span className="font-mono text-xs">{a.address}</span>
            </label>
          ))}
        </div>
        <Button disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create chain'}</Button>
      </Card>
      {chains.length === 0 && <p className="text-sm text-slate-500">No chains yet.</p>}
      {chains.map(c => (
        <Card key={c.id} className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-medium">
              {c.name} {c.id === chain?.info.id && <span className="text-xs text-slate-500">(selected)</span>}
            </div>
            <div className="text-xs text-slate-500">{c.type}{c.ephemeral ? ' · benchmark (not saved)' : ''} · {c.createdAt}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => selectChain(c.id)}>Select</Button>
            <Button
              variant="danger"
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
