import { useState } from 'react'
import { encodeFunctionData, type Abi, type AbiFunction, type Address } from 'viem'
import type { Receipt } from '@evmb/core'
import type { ChainHandle } from '../chain/handle'
import type { Account } from '../store/accounts'
import { encodeArgs } from '../abi/args'
import { fnKind } from '../abi/kind'
import { readContract, signAndSend } from '../tx/send'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useApp } from '../state'
import { show } from './ReceiptView'
import { ADDRESS_LIST } from './AddressList'

/** One form per function: view/pure -> eth_call, otherwise sign and send. */
export function FunctionForm({ fn, abi, to, chain, account, onReceipt }: {
  fn: AbiFunction; abi: Abi; to: Address; chain: ChainHandle; account?: Account; onReceipt(r: Receipt): void
}) {
  const { bumpBalance } = useApp()
  const [raw, setRaw] = useState<string[]>([])
  const [value, setValue] = useState('')
  const [out, setOut] = useState<{ ok: boolean; text: string }>()
  const [busy, setBusy] = useState(false)
  const read = fnKind(fn) === 'read'

  const run = async () => {
    const parsed = encodeArgs(fn.inputs, raw)
    if (!parsed.ok) return setOut({ ok: false, text: parsed.errors.join('\n') })
    let wei = 0n
    if (fn.stateMutability === 'payable' && value.trim()) {
      if (!/^\d+$/.test(value.trim())) return setOut({ ok: false, text: 'value: not a non-negative integer (wei)' })
      wei = BigInt(value.trim())
    }
    setBusy(true)
    setOut(undefined)
    try {
      if (read) setOut({ ok: true, text: show(await readContract(chain, to, abi, fn.name, parsed.values)) })
      else {
        if (!account) throw new Error('Select an account first')
        const r = await signAndSend(chain, account, { to, data: encodeFunctionData({ abi, functionName: fn.name, args: parsed.values } as any), value: wei || undefined }, bumpBalance)
        setOut({ ok: r.status === 'success', text: r.status })
        onReceipt(r)
      }
    } catch (e) {
      setOut({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1">
        <h2 className="break-all font-mono text-lg font-medium"><span className="text-accent">{fn.name}</span><span className="text-muted">({fn.inputs.map(p => `${p.type}${p.name ? ' ' + p.name : ''}`).join(', ')})</span></h2>
        <Badge variant={read ? 'accent' : 'warn'}>{read ? 'read' : 'writes'}</Badge>
      </div>
      {fn.inputs.map((p, i) => {
        const label = p.name || `arg${i}`
        return (
          <label key={i} className="flex flex-col gap-1.5 font-semibold">
            <span>{label} <span className="font-mono text-xs font-medium text-muted">{p.type}</span></span>
            <Input aria-label={label} placeholder={`${label} (${p.type})`} className="font-mono font-normal" list={p.type === 'address' ? ADDRESS_LIST : undefined}
              value={raw[i] ?? ''} onChange={e => setRaw(r => Object.assign([...r], { [i]: e.target.value }))} />
          </label>
        )
      })}
      {fn.stateMutability === 'payable' && (
        <label className="flex flex-col gap-1.5 font-semibold">
          <span>value <span className="font-mono text-xs font-medium text-muted">wei</span></span>
          <Input aria-label="value" placeholder="value (wei)" className="font-mono font-normal" value={value} onChange={e => setValue(e.target.value)} />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant={read ? 'ghost' : 'primary'} onClick={run} disabled={busy}>{read ? 'Call' : 'Send'}</Button>
        {out && <span role="status" className={`min-w-0 whitespace-pre-wrap break-all font-mono text-xs ${out.ok ? 'text-success-text' : 'text-danger'}`}>{out.text}</span>}
      </div>
    </div>
  )
}
