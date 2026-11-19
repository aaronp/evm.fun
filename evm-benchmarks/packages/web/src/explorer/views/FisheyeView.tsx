import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { LENS_MAG, LENS_SPREAD, lensFocus, lensSizes } from '../lens'
import { blockMatches, windowContains, type Header } from '../window'
import { Panel } from '../../ui/panel'

const short = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`
const iso = (s: number) => new Date(s * 1000).toISOString().replace('.000Z', 'Z')
const LG = '(min-width: 1024px)'

/** Lens length: 860 px at lg, 600 px below. */
function useLensLen() {
  const get = () => (typeof matchMedia === 'function' && matchMedia(LG).matches ? 860 : 600)
  const [len, setLen] = useState(get)
  useEffect(() => {
    const m = matchMedia(LG), on = () => setLen(get())
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return len
}

/** The window's blocks, newest first, magnified around the pointer (or the selected/newest block at rest). */
export function FisheyeView({ q, headers, total, selected, loading }: { q: string; headers: Header[]; total: number; selected?: number; loading: boolean }) {
  const nav = useNavigate()
  const len = useLensLen()
  const [f, setF] = useState<number | null>(null)
  const n = headers.length
  const selIdx = selected === undefined ? -1 : headers.findIndex(h => h.number === selected)
  const rest = Math.max(0, selIdx)
  const focus = f === null ? rest : Math.min(f, n - 1)
  const go = (i: number) => nav(`/chains/block/${headers[i]!.number}`)
  const filtering = q.trim() !== ''

  let body
  if (n === 0) body = <p className="p-4 text-sm text-muted">{loading ? 'Loading…' : 'No blocks.'}</p>
  else {
    const sizes = lensSizes(n, focus, LENS_MAG, LENS_SPREAD, len)
    const fi = Math.round(focus)
    const max = Math.max(...sizes)
    const old = selected !== undefined && !windowContains(headers, selected)
    const onMove = (e: PointerEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      setF(lensFocus(n, Math.min(len, Math.max(0, e.clientY - r.top)), LENS_MAG, LENS_SPREAD, len))
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setF(Math.min(n - 1, Math.max(0, fi + (e.key === 'ArrowDown' ? 1 : -1))))
      } else if (e.key === 'Enter') go(fi)
    }
    body = (
      <div className="space-y-2 p-4">
        <p className="text-xs text-muted">
          Latest {n} of {total} blocks{old && ` · Block #${selected} is older than the latest 500 shown`}
        </p>
        <div role="listbox" tabIndex={0} aria-label="Blocks, newest first. Use up and down arrows to move, Enter to open."
          aria-activedescendant={`fe-${headers[fi]!.number}`}
          className="overflow-hidden rounded border border-line focus-visible:outline-2 focus-visible:outline-accent"
          style={{ height: len }} onPointerMove={onMove} onPointerLeave={() => setF(null)}>
          {headers.map((b, i) => {
            const hit = blockMatches(b, q), isSel = b.number === selected, size = sizes[i]!
            return (
              <div key={b.number} id={`fe-${b.number}`} role="option" aria-selected={isSel} onClick={() => go(i)}
                style={{ height: size }}
                className={`flex cursor-pointer items-center gap-2 overflow-hidden border-t border-line px-2 text-xs ${hit ? 'text-text' : 'text-faint opacity-40'} ${isSel ? 'border-l-4 border-l-accent bg-selected font-semibold' : ''} ${filtering && hit ? 'underline' : ''}`}>
                {size >= 14 && <span className="font-mono">#{b.number} · {b.txCount} txs · {iso(b.timestamp)}</span>}
                {size >= max * 0.5 && <span className="font-mono text-text-2">{short(b.hash)}</span>}
                {isSel && <span className="sr-only"> (selected)</span>}
                {filtering && !hit && <span className="sr-only"> (does not match filter)</span>}
              </div>
            )
          })}
        </div>
      </div>
    )
  }
  return <Panel title="Fisheye">{body}</Panel>
}
