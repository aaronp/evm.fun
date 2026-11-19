import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Abi, AbiFunction } from 'viem'
import type { Receipt } from '@evmb/core'
import { accounts } from '../store/accounts'
import { useApp } from '../state'
import { contractsRegistry, type DeployedContract } from '../contracts/registry'
import { signAndSend } from '../tx/send'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Erc20Card, isErc20 } from '../components/Erc20Card'
import { FunctionForm } from '../components/FunctionForm'
import { ADDRESS_LIST } from '../components/AddressList'
import { ReceiptView } from '../components/ReceiptView'

const input = 'rounded-md border border-slate-300 px-2 py-1 text-sm'
const ETH = 'eth'

export function Transact() {
  const { chain, account, selectAccount } = useApp()
  const [params] = useSearchParams()
  const [contracts, setContracts] = useState<DeployedContract[]>([])
  const [target, setTarget] = useState(params.get('contract') ?? ETH)
  const [receipts, setReceipts] = useState<{ r: Receipt; abi?: Abi }[]>([])
  const [tick, setTick] = useState(0)
  const [eth, setEth] = useState({ to: '', amount: '' })
  const [ethErr, setEthErr] = useState<string>()
  const list = accounts.list()
  const from = list.find(a => a.address === account)
  const c = contracts.find(x => x.address.toLowerCase() === target.toLowerCase())
  const fns = useMemo(() => (c?.abi ?? []).filter((x): x is AbiFunction => x.type === 'function'), [c])

  useEffect(() => {
    if (chain) contractsRegistry.list(chain.info.id).then(setContracts)
    else setContracts([])
  }, [chain])

  if (!chain) return <div className="space-y-4"><h1 className="text-xl font-semibold">Transact</h1><p className="text-sm">Select a chain first.</p></div>

  const record = (r: Receipt, abi?: Abi) => { setReceipts(rs => [{ r, abi }, ...rs]); setTick(t => t + 1) }
  const sendEth = async () => {
    setEthErr(undefined)
    const e = eth.to.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(e)) return setEthErr('Recipient is not a valid address')
    if (!/^\d+$/.test(eth.amount.trim())) return setEthErr('Amount must be a non-negative integer (wei)')
    if (!from) return setEthErr('Select an account first')
    try { record(await signAndSend(chain, from, { to: e as `0x${string}`, value: BigInt(eth.amount.trim()) })) }
    catch (x) { setEthErr(x instanceof Error ? x.message : String(x)) }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Transact</h1>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Account" className={input} value={account ?? ''} onChange={e => selectAccount(e.target.value || undefined)}>
          <option value="">Account…</option>
          {list.map(a => <option key={a.address} value={a.address}>{a.label} ({a.address.slice(0, 8)}…)</option>)}
        </select>
        <select aria-label="Target" className={input} value={target} onChange={e => setTarget(e.target.value)}>
          <option value={ETH}>ETH transfer</option>
          {contracts.map(x => <option key={x.address} value={x.address}>{x.name} {x.address.slice(0, 8)}…</option>)}
        </select>
      </div>
      {target === ETH && (
        <Card className="flex flex-wrap items-center gap-2 text-sm">
          <input aria-label="Recipient" placeholder="to (address)" list={ADDRESS_LIST} className={`${input} w-full sm:w-96`} value={eth.to} onChange={e => setEth({ ...eth, to: e.target.value })} />
          <input aria-label="Amount" placeholder="amount (wei)" className={`${input} w-full sm:w-40`} value={eth.amount} onChange={e => setEth({ ...eth, amount: e.target.value })} />
          <Button onClick={sendEth}>Send</Button>
          {ethErr && <span role="alert" className="text-red-700">{ethErr}</span>}
        </Card>
      )}
      {c && isErc20(c.abi as Abi) && (
        <Erc20Card chain={chain} to={c.address} abi={c.abi as Abi} account={from} refresh={tick} onReceipt={r => record(r, c.abi as Abi)} />
      )}
      {c && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">{c.name} functions</h2>
          {fns.map((f, i) => <FunctionForm key={i} fn={f} abi={c.abi as Abi} to={c.address} chain={chain} account={from} onReceipt={r => record(r, c.abi as Abi)} />)}
        </Card>
      )}
      {receipts.map(({ r, abi }) => <ReceiptView key={r.hash} chain={chain} receipt={r} abi={abi} />)}
    </div>
  )
}
