import { Link } from 'react-router-dom'
import type { LockView } from '@evmb/htlc'
import { card } from '../TakePanel'

type Entry = { chain: string; block: bigint; text: string }

/** The swap across both chains: the two locks, then B's close (a claim there reveals the secret), then A's. */
export function SwapTimeline({ opening, answer, chainName, who, amount, reportHref }: {
  opening?: LockView; answer?: LockView
  chainName(id: string): string; who(a: string): string; amount(l: LockView): string; reportHref?: string
}) {
  const close = (l?: LockView): Entry[] => l && l.status !== 'locked' && l.status !== 'none'
    ? [{ chain: l.chain, block: l.closedBlock, text: `${who(l.status === 'claimed' ? l.recipient : l.sender)} ${l.status} ${amount(l)}${l.status === 'claimed' && l === answer ? ' · the secret is now public' : ''}` }]
    : []
  const lock = (l?: LockView): Entry[] => (l ? [{ chain: l.chain, block: l.lockedBlock ?? 0n, text: `${who(l.sender)} locked ${amount(l)} for ${who(l.recipient)}` }] : [])
  const entries = [...lock(opening), ...lock(answer), ...close(answer), ...close(opening)]
  return (
    <section aria-labelledby="sw-h" className={`${card} flex min-w-0 flex-[1_1_300px] flex-col gap-3 p-[18px]`}>
      <div className="flex items-center justify-between">
        <h2 id="sw-h" className="text-sm font-semibold">Timeline</h2>
        {reportHref && <Link to={reportHref} className="text-[13px] font-medium text-accent hover:text-accent-hover">Report →</Link>}
      </div>
      <ol className="flex flex-col gap-2">
        {entries.map((e, i) => (
          <li key={i} className="flex flex-wrap justify-between gap-2 text-[13px]">
            <span>{e.text}</span>
            <span className="font-mono text-xs text-muted">{chainName(e.chain)} · block {String(e.block)}</span>
          </li>
        ))}
        {opening && !answer && <li className="text-xs text-subtle">Waiting for {who(opening.recipient)} to lock on {chainName(opening.wantChain)}.</li>}
        {!opening && <li className="text-xs text-subtle">Pick a swap, or make one.</li>}
      </ol>
    </section>
  )
}
