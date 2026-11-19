import type { KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ChainHandle } from '../../chain/handle'
import { block } from '../data'
import { neighbours } from '../neighbours'
import { useLoad } from '../useLoad'
import { blockMatches, type Header } from '../window'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Panel } from '../../ui/panel'

const short = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`
const muted = 'p-4 text-sm text-muted'

/** The focus block (selected, else the tip) with up to 3 parents and 3 children. Cards come from block() fetches, not the window. */
export function ChainView({ chain, q, selected, total }: { chain: ChainHandle; q: string; selected?: number; total: number }) {
  const nav = useNavigate()
  const head = total - 1
  const focus = selected ?? head
  const { parents, children } = neighbours(focus, head)
  const nums = [...parents, focus, ...children]
  const cards = useLoad(() => (head < 0 ? Promise.resolve(null) : Promise.all(nums.map(n => block(chain, n, 0, 0)))), [chain, focus, head])
  const go = (n: number) => nav(`/chains/block/${n}`)
  const canParent = focus > 0 && focus <= head
  const canChild = focus < head
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.key === 'ArrowLeft' && canParent) go(focus - 1)
    else if (e.key === 'ArrowRight' && canChild) go(focus + 1)
  }
  const nav2 = (
    <div className="flex gap-2">
      <Button variant="ghost" size="sm" disabled={!canParent} onClick={() => go(focus - 1)}>Parent</Button>
      <Button variant="ghost" size="sm" disabled={!canChild} onClick={() => go(focus + 1)}>Child</Button>
    </div>
  )
  return (
    <Panel title="Chain" badge={nav2}>
      {head < 0 ? <p className={muted}>No blocks.</p> : cards === undefined ? <p className={muted}>Loading…</p> : !cards ? <p className={muted}>Not found.</p> : (
        <div tabIndex={0} onKeyDown={onKey} aria-label="Block chain: use left and right arrow keys" className="flex flex-col items-stretch gap-2 p-4 md:flex-row md:items-center">
          {cards.map((b, i) => {
            const n = nums[i]!
            const isFocus = n === focus
            const dim = !!b && !blockMatches({ number: n, hash: b.header.hash } as Header, q)
            return (
              <div key={n} className="flex flex-col items-center gap-2 md:flex-row">
                {i > 0 && <span aria-hidden className="text-muted md:hidden">↓</span>}
                {i > 0 && <span aria-hidden className="hidden text-muted md:inline">→</span>}
                <Link to={`/chains/block/${n}`} aria-current={isFocus ? 'true' : undefined}
                  className={`block w-full rounded-lg border bg-surface p-3 text-sm hover:bg-surface-hover md:w-auto ${isFocus ? 'border-2 border-accent' : 'border-line'} ${dim ? 'opacity-40' : ''}`}>
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
      )}
    </Panel>
  )
}
