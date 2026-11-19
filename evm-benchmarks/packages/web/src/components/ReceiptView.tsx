import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { decodeEventLog, type Abi } from 'viem'
import type { Receipt } from '@evmb/core'
import type { ChainHandle } from '../chain/handle'
import { Badge } from '../ui/badge'

export const show = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x))

type Raw = { gasUsed: string; blockNumber: string; logs: { address: string; topics: `0x${string}`[]; data: `0x${string}` }[] }
type Ev = { eventName?: string; args?: unknown }

const row = 'flex justify-between gap-3'

/** "Result" panel: status, transaction, block, gas and decoded events for one receipt. */
export function ReceiptView({ chain, receipt, abi }: { chain: ChainHandle; receipt: Receipt; abi?: Abi }) {
  const [raw, setRaw] = useState<Raw | null>()
  useEffect(() => {
    chain.request('eth_getTransactionReceipt', [receipt.hash]).then(r => setRaw(r as Raw | null), () => setRaw(null))
  }, [chain, receipt.hash])
  const logs = (raw?.logs ?? []).map(l => {
    try { return abi ? (decodeEventLog({ abi, data: l.data, topics: l.topics as [`0x${string}`] }) as Ev) : null } catch { return null }
  })
  const block = raw ? Number(BigInt(raw.blockNumber)) : undefined
  return (
    <aside aria-label="Result" className="overflow-hidden rounded-xl border border-line-strong bg-bg text-sm">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-display text-sm font-semibold">Result</h2>
        <Badge variant={receipt.status === 'success' ? 'success' : 'danger'}>{receipt.status}</Badge>
      </div>
      <div className="space-y-3 p-4">
        {receipt.error && <div className="text-danger">{receipt.error}</div>}
        <div className={row}><span className="text-text-2">Transaction</span><span className="min-w-0 break-all text-right font-mono text-xs">{receipt.hash}</span></div>
        {raw && (
          <>
            <div className={row}><span className="text-text-2">Block</span><Link className="font-mono text-accent underline" to={`/explorer/block/${block}`}>{block}</Link></div>
            <div className={row}><span className="text-text-2">Gas used</span><span className="font-mono">{BigInt(raw.gasUsed).toString()}</span></div>
          </>
        )}
      </div>
      {!!raw?.logs.length && (
        <div className="space-y-2 border-t border-line p-4">
          <span className="text-xs font-medium text-text-2">Decoded events</span>
          {raw.logs.map((l, i) => {
            const ev = logs[i]
            const fields = ev?.args && typeof ev.args === 'object' ? Object.entries(ev.args) : []
            return (
              <div key={i} className="break-all rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-relaxed">
                {ev ? (
                  <>
                    <div className="font-medium text-accent">{ev.eventName}</div>
                    {fields.map(([k, v]) => <div key={k}><span className="text-muted">{k}</span>: {show(v)}</div>)}
                  </>
                ) : (
                  <div>{l.topics[0]?.slice(0, 10)}… ({l.data.length / 2 - 1} bytes, undecoded)<div className="text-muted">{[...l.topics.slice(1), l.data].join(' ')}</div></div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </aside>
  )
}
