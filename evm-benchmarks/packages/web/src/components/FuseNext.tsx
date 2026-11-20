import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/button'
import { autoDelay, DEFAULT_AUTO, setAutoDelay } from '../walkthrough/auto'

const typing = (el: Element | null) => !!el && (el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))

/** The walkthrough's Next. With `?auto=…` a ring drains around it and presses it when empty.
 *  Waits while busy and while a modal dialog that doesn't hold this button is open (its own Next runs instead);
 *  typing in a field restarts it. Restarts per step and after each press; stops on an error. */
export function FuseNext({ step, busy, disabled, error, onNext, size, className = '' }: {
  step: string; busy: boolean; disabled: boolean; error?: string; onNext(): void; size?: 'sm'; className?: string
}) {
  const [, rerender] = useState(0)
  const total = autoDelay()
  const [paused, setPaused] = useState(false)
  /** No `?auto`: ▶ starts it at the default delay, for the rest of the walkthrough. */
  const play = () => { setAutoDelay(DEFAULT_AUTO); setPaused(false); rerender(n => n + 1) }
  const wrap = useRef<HTMLSpanElement>(null), left = useRef<HTMLSpanElement>(null)
  const latest = useRef(onNext)
  latest.current = onNext
  const on = !!total && !disabled && !error

  useEffect(() => {
    if (!on || paused) return
    let elapsed = 0, last = performance.now(), frame = 0, fired = false
    const loop = (now: number) => {
      const dt = now - last
      last = now
      const b = wrap.current?.querySelector('button'), modal = document.querySelector('dialog:modal')
      const hold = busy || !b || (modal && !modal.contains(b))
      if (!hold) elapsed += dt
      const f = Math.max(0, 1 - elapsed / total!)
      wrap.current?.style.setProperty('--fuse', String(f))
      if (left.current) left.current.textContent = `${Math.ceil((total! - Math.min(elapsed, total!)) / 1000)}s`
      if (f === 0 && !fired) { fired = true; latest.current(); return }
      frame = requestAnimationFrame(loop)
    }
    // Typing in a field restarts the countdown, so an edit is never cut off. Focus alone doesn't (a dialog
    // focuses its first field when it opens), nor does a resting pointer (it stays over Next after a click).
    const poke = (e: Event) => { if (typing(e.target as Element)) elapsed = 0 }
    document.addEventListener('input', poke, true)
    document.addEventListener('keydown', poke, true)
    frame = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('input', poke, true); document.removeEventListener('keydown', poke, true) }
  }, [on, paused, busy, step, total]) // a new step, or the end of a press (busy → false), refills the fuse

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {on && (
        <button type="button" onClick={() => setPaused(p => !p)} aria-pressed={paused} title={paused ? 'Resume auto-advance' : 'Pause auto-advance'}
          className="rounded px-1 font-mono text-xs text-muted tabular-nums hover:text-text focus-visible:outline-2 focus-visible:outline-accent">
          {paused ? '▶ auto' : <>⏸ <span ref={left}>{`${Math.ceil(total! / 1000)}s`}</span></>}
        </button>
      )}
      {!total && !disabled && (
        <button type="button" onClick={play} aria-label="Auto-advance" title={`Auto-advance: press Next every ${DEFAULT_AUTO / 1000}s`}
          className="rounded px-1 text-xs text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent">▶</button>
      )}
      <span ref={wrap} className="relative inline-flex" data-wz-fuse={on && !paused ? '' : undefined}>
        <Button type="button" size={size} disabled={disabled} onClick={onNext}>Next</Button>
      </span>
    </span>
  )
}
