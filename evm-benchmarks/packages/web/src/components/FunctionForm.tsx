import { useState } from 'react'
import { encodeFunctionData, type Abi, type AbiFunction, type Address } from 'viem'
import type { Receipt } from '@evmb/core'
import type { ChainHandle } from '../chain/handle'
import type { Account } from '../store/accounts'
import { encodeArgs } from '../abi/args'
import { readContract, signAndSend } from '../tx/send'
import { Button } from '../ui/button'
import { show } from './ReceiptView'
import { ADDRESS_LIST } from './AddressList'

const input = 'rounded-md border border-slate-300 px-2 py-1 text-sm'

/** One form per function: view/pure -> eth_call, otherwise sign and send. */
export function FunctionForm({ fn, abi, to, chain, account, onReceipt }: {
  fn: AbiFunction; abi: Abi; to: Address; chain: ChainHandle; account?: Account; onReceipt(r: Receipt): void
}) {
  const [raw, setRaw] = useState<string[]>([])
  const [value, setValue] = useState('')
  const [out, setOut] = useState<{ ok: boolean; text: string }>()
  const [busy, setBusy] = useState(false)
  const read = fn.stateMutability === 'view' || fn.stateMutability === 'pure'

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
        const r = await signAndSend(chain, account, { to, data: encodeFunctionData({ abi, functionName: fn.name, args: parsed.values } as any), value: wei || undefined })
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
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-28 font-medium">{fn.name}</span>
      {fn.inputs.map((p, i) => (
        <input key={i} aria-label={p.name || `arg${i}`} placeholder={`${p.name || `arg${i}`} (${p.type})`} className={`${input} w-48`} list={p.type === 'address' ? ADDRESS_LIST : undefined}
          value={raw[i] ?? ''} onChange={e => setRaw(r => Object.assign([...r], { [i]: e.target.value }))} />
      ))}
      {fn.stateMutability === 'payable' && <input aria-label="value" placeholder="value (wei)" className={`${input} w-32`} value={value} onChange={e => setValue(e.target.value)} />}
      <Button variant={read ? 'outline' : 'default'} onClick={run} disabled={busy}>{read ? 'Call' : 'Send'}</Button>
      {out && <span role="status" className={`whitespace-pre-wrap font-mono text-xs ${out.ok ? 'text-green-700' : 'text-red-700'}`}>{out.text}</span>}
    </div>
  )
}
