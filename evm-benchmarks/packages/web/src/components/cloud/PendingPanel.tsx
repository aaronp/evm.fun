import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { Hex } from 'viem'
import type { Outcome, PendingTx } from '@evmb/node/src/followerStore'
import type { ChainHandle } from '../../chain/handle'
import { followerTxs, pendingSummary } from '../../cloud/followerChain'
import { accounts } from '../../store/accounts'
import { useApp } from '../../state'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Notice } from '../../ui/notice'
import { Panel } from '../../ui/panel'
import { Table, td, th } from '../../ui/table'

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`
const tone = { pending: 'neutral', confirmed: 'success', conflicted: 'warn', refused: 'danger' } as const
const outcome = (o: Outcome) => `${o.status}, ${o.logs.length} log${o.logs.length === 1 ? '' : 's'}`
const sender = (from: string) => accounts.list().find((a) => a.address.toLowerCase() === from.toLowerCase())?.label ?? short(from)

function what(t: PendingTx) {
  const at = t.block === undefined ? '' : ` · Block #${t.block}`
  if (t.status === 'refused') return t.reason ?? 'refused'
  if (t.status === 'conflicted') return `Here: ${outcome(t.first)} · Cloud: ${t.cloud ? outcome(t.cloud) : '?'}${at}`
  return `${outcome(t.first)}${t.status === 'pending' ? ' (here)' : at}`
}

/** A conflicted deploy that landed at another address (re-signed with a new nonce). */
const moved = (t: PendingTx) => t.status === 'conflicted' && !!t.cloud?.contractAddress && !!t.first.contractAddress && t.cloud.contractAddress !== t.first.contractAddress

/** A follower's txs sent from this device: pending until the cloud mines them, then confirmed, conflicted or refused until dismissed. */
export function PendingPanel({ chain }: { chain: ChainHandle }) {
  useApp() as ReturnType<typeof useApp> | undefined // re-render on its balanceTick: a follower's pending list changing bumps it
  const txs = followerTxs(chain)
  const approach = chain.approach as unknown as { dismiss(h: Hex): Promise<void> }
  const [err, setErr] = useState<string>()
  const ref = useRef<HTMLDivElement>(null)
  const { state } = useLocation()
  useEffect(() => { if ((state as { pending?: boolean } | null)?.pending) ref.current?.scrollIntoView({ block: 'start' }) }, [state])

  const dismiss = async (hashes: Hex[]) => {
    setErr(undefined)
    try { for (const h of hashes) await approach.dismiss(h) } catch (e) { setErr(`Couldn't dismiss: ${e instanceof Error ? e.message : String(e)}`) }
  }
  const settled = txs.filter((t) => t.status !== 'pending')
  const { pending } = pendingSummary(txs)
  return (
    <div ref={ref} className="scroll-mt-24">
      <Panel title="Pending" badge={pending > 0 && <Badge>{pending} pending</Badge>}
        actions={settled.length > 0 && <Button variant="ghost" size="sm" onClick={() => dismiss(settled.map((t) => t.hash))}>Dismiss settled</Button>}>
        {err && <div className="p-4"><Notice onDismiss={() => setErr(undefined)}>{err}</Notice></div>}
        {txs.length === 0 ? <p className="p-4 text-sm text-muted">Nothing waiting. Transactions you send on this chain show here until the cloud has them; settled ones stay until you dismiss them.</p> : (
          <Table>
            <table className="w-full">
              <thead><tr className="border-b border-line"><th className={th}>Status</th><th className={th}>Tx</th><th className={th}>From</th><th className={th}>Outcome</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.seq} className="border-b border-line last:border-0 align-top">
                    <td className={td}><Badge variant={tone[t.status]}>{t.status}</Badge></td>
                    <td className={`${td} whitespace-nowrap font-mono text-xs`} title={t.hash}>{short(t.hash)}</td>
                    <td className={`${td} break-all`}>{sender(t.from)}</td>
                    <td className={`${td} text-xs text-text-2`}>
                      <div className="break-words">{what(t)}</div>
                      {moved(t) && <div className="mt-1 break-all">Deployed at {t.cloud!.contractAddress}, not {t.first.contractAddress}</div>}
                      {t.dependsOn && <div className="mt-1 text-muted" title={t.dependsOn}>After {short(t.dependsOn)} conflicted</div>}
                    </td>
                    <td className={td}>{t.status !== 'pending' && <Button variant="ghost" size="sm" aria-label={`Dismiss ${short(t.hash)}`} onClick={() => dismiss([t.hash])}>Dismiss</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Table>
        )}
      </Panel>
    </div>
  )
}
