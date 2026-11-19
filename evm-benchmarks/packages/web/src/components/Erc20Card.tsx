import { useEffect, useState } from 'react'
import { formatUnits, type Abi, type AbiFunction, type Address } from 'viem'
import type { Receipt } from '@evmb/core'
import type { ChainHandle } from '../chain/handle'
import { accounts, type Account } from '../store/accounts'
import { readContract } from '../tx/send'
import { Card } from '../ui/card'
import { FunctionForm } from './FunctionForm'

export const isErc20 = (abi: Abi) => ['transfer', 'balanceOf', 'decimals'].every(n => abi.some(x => x.type === 'function' && x.name === n))

type Info = { name?: string; symbol?: string; decimals: number; supply: bigint; owner?: string; balances: [Account, bigint][] }

export function Erc20Card({ chain, to, abi, account, refresh, onReceipt }: {
  chain: ChainHandle; to: Address; abi: Abi; account?: Account; refresh: number; onReceipt(r: Receipt): void
}) {
  const [info, setInfo] = useState<Info>()
  const [err, setErr] = useState<string>()
  useEffect(() => {
    const get = (fn: string, args: unknown[] = []) => readContract(chain, to, abi, fn, args)
    const opt = (fn: string) => get(fn).catch(() => undefined)
    Promise.all([opt('name'), opt('symbol'), get('decimals'), get('totalSupply'), opt('owner'),
      Promise.all(accounts.list().map(async a => [a, (await get('balanceOf', [a.address])) as bigint] as [Account, bigint]))])
      .then(([name, symbol, decimals, supply, owner, balances]) =>
        setInfo({ name: name as string, symbol: symbol as string, decimals: Number(decimals), supply: supply as bigint, owner: owner as string | undefined, balances }))
      .then(() => setErr(undefined), e => setErr(e instanceof Error ? e.message : String(e)))
  }, [chain, to, abi, refresh])

  if (err) return <Card className="text-sm text-red-700">{err}</Card>
  if (!info) return <Card className="text-sm">Loading token…</Card>
  const fmt = (v: bigint) => formatUnits(v, info.decimals)
  const fn = (name: string) => abi.find((x): x is AbiFunction => x.type === 'function' && x.name === name)
  const transfer = fn('transfer')
  const mint = fn('mint')
  const isOwner = !!account && info.owner?.toLowerCase() === account.address.toLowerCase()
  return (
    <Card className="space-y-2 text-sm">
      <h2 className="font-semibold">{info.name} ({info.symbol}) · supply {fmt(info.supply)}</h2>
      <div className="overflow-x-auto"><table className="text-xs">
        <tbody>
          {info.balances.map(([a, b]) => (
            <tr key={a.address}><td className="pr-3">{a.label}</td><td className="pr-3 font-mono">{a.address}</td><td className="font-mono">{fmt(b)}</td></tr>
          ))}
        </tbody>
      </table></div>
      <p className="text-xs text-slate-500">Amounts in the forms below are raw units ({info.decimals} decimals).</p>
      {transfer && <FunctionForm fn={transfer} abi={abi} to={to} chain={chain} account={account} onReceipt={onReceipt} />}
      {mint && isOwner && <FunctionForm fn={mint} abi={abi} to={to} chain={chain} account={account} onReceipt={onReceipt} />}
    </Card>
  )
}
