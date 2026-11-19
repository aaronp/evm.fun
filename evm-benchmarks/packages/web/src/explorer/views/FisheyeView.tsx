import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { LENS_MAG, LENS_SPREAD, lensFocus, lensSizes, lensWindow, tileStyle } from '../lens'
import { blockMatches, windowContains, type Header } from '../window'
import { Panel } from '../../ui/panel'
import { Segmented } from '../../ui/segmented'
import { Button } from '../../ui/button'

type Orient = 'horizontal' | 'vertical'
type Order = 'newest' | 'oldest'
type Rest = 'newest' | 'selected'
interface Opts { orient: Orient; order: Order; rest: Rest; mag: number; spread: number; len: number }

const KEY = 'evmb.fisheye'
const DEFAULTS: Opts = { orient: 'horizontal', order: 'newest', rest: 'newest', mag: LENS_MAG, spread: LENS_SPREAD, len: 860 }
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}` // mockup C.short
const STEP = 30 // Older / Newer step, in blocks
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d)

function load(): Opts {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Opts>
    return {
      orient: o.orient === 'vertical' ? 'vertical' : 'horizontal',
      order: o.order === 'oldest' ? 'oldest' : 'newest',
      rest: o.rest === 'selected' ? 'selected' : 'newest',
      mag: num(o.mag, 0, 24, DEFAULTS.mag), spread: num(o.spread, 1, 6, DEFAULTS.spread), len: num(o.len, 480, 1200, DEFAULTS.len),
    }
  } catch { return DEFAULTS }
}

/** Mockup control row: orientation, order, rest focus and the three lens sliders. */
function Controls({ o, set }: { o: Opts; set(p: Partial<Opts>): void }) {
  const seg = 'flex gap-0.5 rounded-lg bg-bg p-0.5'
  const item = 'px-2.5 py-1 text-xs font-medium'
  const range = (label: string, k: 'mag' | 'spread' | 'len', min: number, max: number, step: number, shown: string) => (
    <label className="flex items-center gap-2 text-xs text-muted">{label}
      <input type="range" min={min} max={max} step={step} value={o[k]} onChange={e => set({ [k]: Number(e.target.value) })} className="w-24 accent-accent" />
      <span className="min-w-10 tabular-nums text-text">{shown}</span>
    </label>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
      <Segmented<Orient> label="Orientation" name="fe-orient" value={o.orient} onChange={v => set({ orient: v })} className={seg} itemClassName={item}
        options={[{ value: 'horizontal', content: 'Horizontal' }, { value: 'vertical', content: 'Vertical' }]} />
      <Segmented<Order> label="Order" name="fe-order" value={o.order} onChange={v => set({ order: v })} className={seg} itemClassName={item}
        options={[{ value: 'newest', content: 'Newest first' }, { value: 'oldest', content: 'Oldest first' }]} />
      <div className="flex items-center gap-1.5 text-xs text-muted">At rest
        <Segmented<Rest> label="At rest, focus" name="fe-rest" value={o.rest} onChange={v => set({ rest: v })} className={seg} itemClassName={item}
          options={[{ value: 'newest', content: 'Newest' }, { value: 'selected', content: 'Selected' }]} />
      </div>
      {range('Magnify', 'mag', 0, 24, 1, `×${1 + o.mag}`)}
      {range('Spread', 'spread', 1, 6, 0.5, String(o.spread))}
      {range('Length', 'len', 480, 1200, 20, `${o.len}px`)}
    </div>
  )
}

/** A 36-block lens over the window, magnified around the pointer (or the newest/selected block at rest), as in the mockup. */
export function FisheyeView({ q, headers, selected, loading }: { q: string; headers: Header[]; selected?: number; loading: boolean }) {
  const nav = useNavigate()
  const [o, setO] = useState(load)
  const set = (p: Partial<Opts>) => setO(prev => {
    const next = { ...prev, ...p }
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage blocked: keep for this session */ }
    return next
  })
  const H = o.orient === 'horizontal'
  const items = o.order === 'newest' ? headers : [...headers].reverse()
  const n = items.length
  const idxOf = (b: number) => items.findIndex(h => h.number === b)
  const selIdx = selected === undefined ? -1 : idxOf(selected)
  const newestIdx = o.order === 'newest' ? 0 : n - 1

  // Lens window: around the selected block (or the newest); Older/Newer pan it until the selection moves outside the panned window.
  const [pan, setPan] = useState<{ anchor: number; sel?: number } | null>(null)
  let win = lensWindow(n, selIdx >= 0 ? selIdx : newestIdx)
  const pi = pan ? idxOf(pan.anchor) : -1
  if (pi >= 0) {
    const pw = lensWindow(n, pi)
    if (pan!.sel === selected || (selIdx >= pw.start && selIdx < pw.end)) win = pw
  }
  const w = win.end - win.start
  const step = (older: boolean) => {
    const dir = (o.order === 'newest') === older ? 1 : -1
    const start = clamp(win.start + dir * STEP, 0, n - w)
    setPan({ anchor: items[start + Math.floor(w / 2)]!.number, sel: selected })
  }

  const [f, setF] = useState<number | null>(null)
  const tip = headers[0]?.number
  useEffect(() => setF(null), [selected, tip, win.start, o.order]) // focus is an index into the lens: drop it when the lens moves

  const inLens = (i: number) => i >= win.start && i < win.end
  const rest = clamp((o.rest === 'selected' && inLens(selIdx) ? selIdx : newestIdx) - win.start, 0, Math.max(0, w - 1))
  const focus = f === null ? rest : Math.min(f, w - 1)
  const fi = Math.round(focus)
  const lens = items.slice(win.start, win.end)
  const go = (i: number) => nav(`/chains/block/${lens[i]!.number}`)
  const filtering = q.trim() !== ''
  const old = selected !== undefined && n > 0 && !windowContains(headers, selected)
  const [lo, hi] = lens.length ? [Math.min(lens[0]!.number, lens[w - 1]!.number), Math.max(lens[0]!.number, lens[w - 1]!.number)] : [0, 0]
  const atNewest = o.order === 'newest' ? win.start === 0 : win.end === n
  const atOldest = o.order === 'newest' ? win.end === n : win.start === 0

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!w) return
    // Rescaled by the element's on-screen size, as in the mockup's move handler.
    const r = e.currentTarget.getBoundingClientRect()
    const frac = clamp(H ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height, 0, 1)
    setF(lensFocus(w, frac * o.len, o.mag, o.spread, o.len))
  }
  const onKey = (e: KeyboardEvent) => {
    if (!w) return
    const [back, fwd] = H ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
    if (e.key === back || e.key === fwd) {
      e.preventDefault()
      setF(clamp(fi + (e.key === fwd ? 1 : -1), 0, w - 1))
    } else if (e.key === 'Enter') go(fi)
  }

  const sizes = w ? lensSizes(w, focus, o.mag, o.spread, o.len) : []
  const max = Math.max(0, ...sizes)
  const keys = H ? 'left and right' : 'up and down'
  return (
    <Panel title="Fisheye">
      <div className="space-y-2.5 border-b border-line px-4 py-3">
        <p className="text-xs text-muted">
          Move the pointer along the lens to sweep through history{w > 0 && <>; magnified at <strong className="text-text">#{lens[fi]!.number}</strong></>}.
          At rest it focuses the {o.rest === 'newest' ? 'newest' : 'selected'} block.
        </p>
        <Controls o={o} set={set} />
      </div>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Button variant="ghost" size="sm" disabled={atOldest || !w} onClick={() => step(true)}>Older</Button>
          <Button variant="ghost" size="sm" disabled={atNewest || !w} onClick={() => step(false)}>Newer</Button>
          <span aria-live="polite">
            {w > 0 ? `Blocks #${lo}–#${hi} of the latest ${n}` : loading ? 'Loading…' : 'No blocks.'}
            {old && ` · Block #${selected} is older than the latest ${n} shown`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <div role="listbox" tabIndex={0} aria-label={`Blocks, ${o.order} first. Use ${keys} arrows to move, Enter to open.`}
            aria-activedescendant={w ? `fe-${lens[fi]!.number}` : undefined} aria-orientation={o.orient}
            className={`flex cursor-crosshair rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${H ? 'min-h-[260px] items-start' : 'flex-col'}`}
            style={H ? { width: o.len } : { height: o.len }} onPointerMove={onMove} onPointerLeave={() => setF(null)} onKeyDown={onKey}>
            {lens.map((b, i) => {
              const size = sizes[i]!, t = tileStyle(size, max, H)
              const hit = blockMatches(b, q), isSel = b.number === selected
              const ul = filtering && hit ? 'underline' : ''
              return (
                <div key={b.number} className="box-border flex flex-none justify-center"
                  style={H ? { width: size, padding: `${Math.round((150 - t.cross) / 2)}px ${t.filled ? 1 : 0}px 0` } : { height: size, maxWidth: 440, padding: `${t.filled ? 1 : 0}px 0` }}>
                  <div id={`fe-${b.number}`} role="option" aria-selected={isSel} title={`Block ${b.number}, ${b.hash.slice(0, 12)}`} onClick={() => go(i)}
                    style={H ? { width: '100%', height: t.cross, padding: t.full || t.mid ? 6 : 0 } : { width: t.cross, maxWidth: '100%', height: '100%', padding: t.full || t.mid ? '0 12px' : 0 }}
                    className={`box-border flex cursor-pointer flex-col justify-center gap-0.5 overflow-hidden text-left text-[13px] leading-[18px] text-on-accent ${t.filled ? 'rounded-md bg-accent' : 'rounded-full bg-line-strong'} ${isSel ? 'outline-2 outline-offset-2 outline-text' : ''} ${hit ? '' : 'opacity-30'}`}>
                    {(t.full || t.mid) && (
                      <span className={H ? 'flex flex-col gap-0.5' : 'flex items-center gap-2.5'}>
                        <span className={`font-semibold ${t.full ? 'text-[15px]' : ''} ${ul}`}>#{b.number}</span>
                        <span className={`font-mono ${t.mid && H ? 'text-[11px]' : 'text-xs'} ${ul}`}>{t.full ? short(b.hash) : b.hash.slice(2, 8)}</span>
                      </span>
                    )}
                    {!t.full && !t.mid && <span className="sr-only">#{b.number}</span>}
                    {isSel && <span className="sr-only"> (selected)</span>}
                    {filtering && !hit && <span className="sr-only"> (does not match filter)</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Panel>
  )
}
