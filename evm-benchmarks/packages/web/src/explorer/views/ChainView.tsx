import { useRef, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ChainHandle } from '../../chain/handle'
import { block } from '../data'
import { neighbours, shownPair, stepTarget } from '../neighbours'
import { useLoad } from '../useLoad'
import { blockMatches, type Header } from '../window'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Panel } from '../../ui/panel'

const short = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`

/** The focus block (selected, else the tip) with up to 3 parents and 3 children. Cards come from block() fetches, not the window. */
export function ChainView({ chain, q, selected, total, loading }: { chain: ChainHandle; q: string; selected?: number; total: number; loading: boolean }) {
  const nav = useNavigate()
  const filtering = q.trim() !== ''
  const head = total - 1
  const focus = selected ?? head
  const { parents, children } = neighbours(focus, head)
  const nums = [...parents, focus, ...children]
  // The loaded value carries its own numbers so cards are never paired with another focus's numbers.
  const cur = useLoad(async () => (head < 0 ? null : { chain, focus, nums, cards: await Promise.all(nums.map(n => block(chain, n, 0, 0))) }), [chain, focus, head])
  const last = useRef<typeof cur>(null)
  if (cur) last.current = cur
  const shown = shownPair(last.current ?? null, cur, chain)
  const go = (n: number | null) => n !== null && nav(`/chains/block/${n}`)
  const parent = stepTarget(focus, head, -1)
  const child = stepTarget(focus, head, 1)
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.key === 'ArrowLeft') go(parent)
    else if (e.key === 'ArrowRight') go(child)
  }
  const nav2 = (
    <div className="flex gap-2">
      <Button variant="ghost" size="sm" disabled={parent === null} onClick={() => go(parent)}>{focus > head ? 'Go to tip' : 'Parent'}</Button>
      <Button variant="ghost" size="sm" disabled={child === null} onClick={() => go(child)}>Child</Button>
    </div>
  )
  return (
    <Panel title="Chain" badge={nav2}>
      <div role="group" tabIndex={0} onKeyDown={onKey} aria-label="Block chain: use left and right arrow keys" className="flex flex-col items-stretch gap-2 p-4 md:flex-row md:items-center">
        {head < 0 ? <p className="text-sm text-muted">{loading ? 'Loading…' : 'No blocks.'}</p> : !shown ? <p className="text-sm text-muted">{cur === null ? 'Not found.' : 'Loading…'}</p> : shown.cards.map((b, i) => {
          const n = shown.nums[i]!
          const isFocus = n === shown.focus
          const dim = !!b && !blockMatches({ number: n, hash: b.header.hash } as Header, q)
          return (
            <div key={n} className="flex flex-col items-center gap-2 md:flex-row">
              {i > 0 && <span aria-hidden className="text-muted md:hidden">↓</span>}
              {i > 0 && <span aria-hidden className="hidden text-muted md:inline">→</span>}
              <Link to={`/chains/block/${n}`} aria-current={isFocus ? 'true' : undefined}
                className={`block w-full rounded-lg border bg-surface p-3 text-sm hover:bg-surface-hover md:w-auto ${isFocus ? 'border-2 border-accent' : 'border-line'} ${dim ? 'opacity-40' : ''} ${filtering && !dim ? 'underline' : ''}`}>
                <div className="font-mono font-medium">#{n}</div>
                <div className="font-mono text-xs text-text-2" title={b?.header.hash}>{b ? short(b.header.hash) : 'not found'}</div>
                <div className="text-xs text-text-2">{b ? `${b.txTotal} txs` : ''}</div>
                {isFocus && <Badge variant="accent" className="mt-1">selected</Badge>}
                {dim && <span className="sr-only">filtered</span>}
              </Link>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
