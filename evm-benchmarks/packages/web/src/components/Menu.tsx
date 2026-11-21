import { Fragment, useEffect, useReducer, useRef, type KeyboardEvent, type ReactNode } from 'react'

export type MenuState = { open: boolean; /** focused item, -1 = none (focus stays on the trigger) */ active: number }
export type MenuAction = { type: 'key'; key: string; count: number } | { type: 'toggle' } | { type: 'openFirst' } | { type: 'close' }
const CLOSED: MenuState = { open: false, active: -1 }

/** Pure keyboard/open logic: arrows open and move (wrapping), Home/End jump, Escape/Tab close. */
export function menuReducer(s: MenuState, a: MenuAction): MenuState {
  if (a.type === 'toggle') return s.open ? CLOSED : { open: true, active: -1 }
  if (a.type === 'openFirst') return s.open ? CLOSED : { open: true, active: 0 } // Enter/Space on the trigger
  if (a.type === 'close') return s.open ? CLOSED : s
  const n = a.count, at = s.open ? s.active : -1
  switch (a.key) {
    case 'ArrowDown': return { open: true, active: s.open && at >= 0 ? (at + 1) % n : 0 }
    case 'ArrowUp': return { open: true, active: s.open && at >= 0 ? (at - 1 + n) % n : n - 1 }
    case 'Home': return s.open ? { open: true, active: 0 } : s
    case 'End': return s.open ? { open: true, active: n - 1 } : s
    case 'Escape': case 'Tab': return s.open ? CLOSED : s
    default: return s
  }
}

export type MenuItem = {
  key: string
  label: ReactNode
  onSelect?: () => void
  /** shown but not actionable (no onSelect also disables it) */
  disabled?: boolean
  /** a radio item (e.g. the acting account) */
  checked?: boolean
  /** a divider above this item */
  separated?: boolean
}

/** Accessible menu button: aria-haspopup/expanded trigger, role=menu items, keyboard per `menuReducer`, click outside closes. */
export function Menu({ label, name, trigger, items, align = 'left', triggerClassName = '', defaultOpen = false }: {
  /** accessible name of the menu */
  label: string
  /** accessible name of the trigger when it differs from its text; must start with the visible text (label-in-name) */
  name?: string
  trigger: ReactNode
  items: MenuItem[]
  align?: 'left' | 'right'
  triggerClassName?: string
  defaultOpen?: boolean
}) {
  const [s, dispatch] = useReducer(menuReducer, defaultOpen ? { open: true, active: -1 } : CLOSED)
  const root = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => { if (s.open && s.active >= 0) refs.current[s.active]?.focus() }, [s])
  useEffect(() => {
    if (!s.open) return
    const out = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) dispatch({ type: 'close' }) }
    document.addEventListener('pointerdown', out)
    return () => document.removeEventListener('pointerdown', out)
  }, [s.open])

  const onKey = (e: KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === btn.current) {
      e.preventDefault() // no click: Enter/Space open on the first item (menu-button pattern)
      dispatch({ type: 'openFirst' })
      return
    }
    const next = menuReducer(s, { type: 'key', key: e.key, count: items.length })
    if (next === s) return
    if (e.key !== 'Tab') e.preventDefault()
    dispatch({ type: 'key', key: e.key, count: items.length })
    if (e.key === 'Escape') btn.current?.focus()
  }
  const pick = (i: MenuItem) => {
    if (i.disabled || !i.onSelect) return
    dispatch({ type: 'close' })
    btn.current?.focus()
    i.onSelect()
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKey}>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={s.open} aria-label={name}
        onClick={() => dispatch({ type: 'toggle' })}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-text hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent ${s.open ? 'bg-surface-hover' : ''} ${triggerClassName}`}>
        {trigger}<span aria-hidden="true" className="text-muted">▾</span>
      </button>
      {s.open && (
        <div role="menu" aria-label={label} className={`absolute top-full z-40 mt-1 flex min-w-52 flex-col rounded-xl border border-line-strong bg-panel p-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {items.map((i, n) => {
            const off = i.disabled || !i.onSelect
            return (
              <Fragment key={i.key}>
              {i.separated && <div role="separator" className="my-1 border-t border-line" />}
              <button ref={el => { refs.current[n] = el }} type="button" tabIndex={-1}
                role={i.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={i.checked} aria-disabled={off || undefined}
                onClick={() => pick(i)}
                className={`flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-accent ${off ? 'text-disabled' : 'text-text hover:bg-surface-hover focus:bg-surface-hover'} ${i.checked ? 'bg-selected' : ''}`}>{i.label}</button>
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
