import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { decodeEventLog, type Abi } from 'viem'
import type { Receipt } from '@evmb/core'
import type { ChainHandle } from '../chain/handle'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'

export const show = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x))

type Raw = { gasUsed: string; blockNumber: string; logs: { address: string; topics: `0x${string}`[]; data: `0x${string}` }[] }

export function ReceiptView({ chain, receipt, abi }: { chain: ChainHandle; receipt: Receipt; abi?: Abi }) {
  const [raw, setRaw] = useState<Raw | null>()
  useEffect(() => {
    chain.request('eth_getTransactionReceipt', [receipt.hash]).then(r => setRaw(r as Raw | null), () => setRaw(null))
  }, [chain, receipt.hash])
  const logs = (raw?.logs ?? []).map(l => {
    try { return abi ? show(decodeEventLog({ abi, data: l.data, topics: l.topics as [`0x${string}`] })) : null } catch { return null }
  })
  const block = raw ? Number(BigInt(raw.blockNumber)) : undefined
  return (
    <Card className="space-y-1.5 p-3 text-xs">
      <div>
        <Badge variant={receipt.status === 'success' ? 'success' : 'danger'}>{receipt.status}</Badge>
        {receipt.error && <span className="ml-2 text-danger">{receipt.error}</span>}
        <span className="ml-2 break-all font-mono">{receipt.hash}</span>
      </div>
      {raw && (
        <div className="text-muted">
          gas used {BigInt(raw.gasUsed).toString()} · block <Link className="text-accent underline" to={`/explorer/block/${block}`}>{block}</Link>
        </div>
      )}
      {raw?.logs.map((l, i) => (
        <div key={i} className="break-all font-mono">log {i}: {logs[i] ?? `${l.topics[0]?.slice(0, 10)}… (${l.data.length / 2 - 1} bytes, undecoded)`}</div>
      ))}
    </Card>
  )
}
