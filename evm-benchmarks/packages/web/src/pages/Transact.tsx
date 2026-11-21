import { useAppBar } from '../state/appBar'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Abi, AbiFunction } from 'viem'
import type { Receipt } from '@evmb/core'
import { accounts } from '../store/accounts'
import { useApp } from '../state'
import { contractsRegistry, type DeployedContract } from '../contracts/registry'
import { signAndSend } from '../tx/send'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { fnKind } from '../abi/kind'
import { Card } from '../ui/card'
import { fieldHint, fieldLabel, Input, Select } from '../ui/input'
import { Erc20Card, isErc20 } from '../components/Erc20Card'
import { FunctionForm } from '../components/FunctionForm'
import { ADDRESS_LIST } from '../components/AddressList'
import { ReceiptView } from '../components/ReceiptView'
import { GasFix } from '../components/Shortfall'

const ETH = 'eth'
const NONE = ''

export function Transact() {
  useAppBar({ title: 'Transact' })
  const { chain, account, selectAccount, bumpBalance } = useApp()
  const [params] = useSearchParams()
  const [contracts, setContracts] = useState<DeployedContract[]>([])
  const [target, setTarget] = useState(params.get('contract') ?? NONE)
  const [pick, setPick] = useState(params.get('contract') ? '0' : ETH) // ETH or a function index
  const [last, setLast] = useState<{ r: Receipt; abi?: Abi }>()
  const [tick, setTick] = useState(0)
  const [eth, setEth] = useState({ to: '', amount: '' })
  const [ethErr, setEthErr] = useState<string>()
  const list = accounts.list()
  const from = list.find(a => a.address === account)
  const c = contracts.find(x => x.address.toLowerCase() === target.toLowerCase())
  const fns = useMemo(() => (c?.abi ?? []).filter((x): x is AbiFunction => x.type === 'function'), [c])

  const sel = pick !== ETH && fns[Number(pick)] ? Number(pick) : undefined // else Native ETH

  useEffect(() => {
    if (chain) contractsRegistry.list(chain.info.id).then(setContracts)
    else setContracts([])
  }, [chain])

  if (!chain) return <div className="space-y-4"><p className="text-sm text-muted">Select a chain first.</p></div>

  const record = (r: Receipt, abi?: Abi) => { setLast({ r, abi }); setTick(t => t + 1) }
  const sendEth = async () => {
    setEthErr(undefined)
    const e = eth.to.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(e)) return setEthErr('Recipient is not a valid address')
    if (!/^\d+$/.test(eth.amount.trim())) return setEthErr('Amount must be a non-negative integer (wei)')
    if (!from) return setEthErr('Select an account first')
    try { record(await signAndSend(chain, from, { to: e as `0x${string}`, value: BigInt(eth.amount.trim()) }, bumpBalance)) }
    catch (x) { setEthErr(x instanceof Error ? x.message : String(x)) }
  }

  const onTarget = (v: string) => { setTarget(v); setPick(v ? '0' : ETH) }
  const abi = c?.abi as Abi | undefined
  const rowCls = (selected: boolean, kind: 'write' | 'read') =>
    `flex min-h-10 w-full items-center gap-2 rounded-lg border px-2.5 text-left font-mono text-sm ${
      selected ? 'border-accent bg-selected text-text' : `border-transparent ${kind === 'write' ? 'bg-warn-soft text-warn-text' : 'bg-accent-soft text-accent'}`}`
  const body = sel === undefined ? (
    <div className="space-y-4 text-sm">
      <div className="space-y-1">
        <h2 className="font-mono text-lg font-medium"><span className="text-accent">transfer</span><span className="text-muted">(to, value)</span></h2>
        <Badge variant="warn">writes</Badge>
      </div>
      <label className={fieldLabel}>
        <span>to <span className={fieldHint}>address</span></span>
        <Input aria-label="Recipient" placeholder="to (address)" list={ADDRESS_LIST} className="font-mono font-normal" value={eth.to} onChange={e => setEth({ ...eth, to: e.target.value })} />
      </label>
      <label className={fieldLabel}>
        <span>value <span className={fieldHint}>wei</span></span>
        <Input aria-label="Amount" placeholder="amount (wei)" className="font-mono font-normal" value={eth.amount} onChange={e => setEth({ ...eth, amount: e.target.value })} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={sendEth}>Send</Button>
        {ethErr && <span role="alert" className="text-danger">{ethErr}</span>}
        <GasFix error={ethErr} />
      </div>
    </div>
  ) : (
    <FunctionForm key={`${c!.address}:${sel}`} fn={fns[sel]} abi={abi!} to={c!.address} chain={chain} account={from} onReceipt={r => record(r, abi)} />
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Account" value={account ?? ''} onChange={e => selectAccount(e.target.value || undefined)}>
          <option value="">Account…</option>
          {list.map(a => <option key={a.address} value={a.address}>{a.label} ({a.address.slice(0, 8)}…)</option>)}
        </Select>
        <Select aria-label="Target" value={target} onChange={e => onTarget(e.target.value)}>
          <option value={NONE}>Native ETH only</option>
          {contracts.map(x => <option key={x.address} value={x.address}>{x.name} {x.address.slice(0, 8)}…</option>)}
        </Select>
      </div>
      {c && abi && isErc20(abi) && (
        <Erc20Card chain={chain} to={c.address} abi={abi} account={from} refresh={tick} onReceipt={r => record(r, abi)} />
      )}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <nav aria-label="Targets" className="w-full space-y-1 rounded-xl border border-line-strong bg-surface p-2.5 lg:w-64 lg:shrink-0">
          <div className="px-2.5 pb-1 pt-1 text-xs uppercase tracking-wider text-muted">Native</div>
          <button aria-pressed={sel === undefined} className={rowCls(sel === undefined, 'write')} onClick={() => setPick(ETH)}>
            <Badge variant="warn">writes</Badge>Native ETH
          </button>
          {c && (
            <>
              <div className="px-2.5 pb-1 pt-4">
                <div className="text-xs uppercase tracking-wider text-muted">{c.name}</div>
                <div className="font-mono text-xs text-muted">{c.address.slice(0, 8)}…{c.address.slice(-4)}</div>
              </div>
              {fns.map((f, i) => {
                const kind = fnKind(f)
                return (
                  <button key={i} aria-pressed={sel === i} className={rowCls(sel === i, kind)} onClick={() => setPick(String(i))}>
                    <Badge variant={kind === 'read' ? 'accent' : 'warn'}>{kind === 'read' ? 'read' : 'writes'}</Badge>
                    <span className="min-w-0 break-all">{f.name}</span>
                  </button>
                )
              })}
            </>
          )}
        </nav>
        <Card className="min-w-0 flex-1 p-5">{body}</Card>
        <div className="w-full lg:w-80 lg:shrink-0">
          {last ? <ReceiptView key={last.r.hash} chain={chain} receipt={last.r} abi={last.abi} /> : <p className="rounded-xl border border-line bg-bg p-4 text-sm text-muted">No result yet.</p>}
        </div>
      </div>
    </div>
  )
}
