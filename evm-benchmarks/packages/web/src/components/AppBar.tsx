import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { withParams } from '../links'
import { registry } from '../chain/revm'
import { followerTxs, pendingSummary } from '../cloud/followerChain'
import { useApp } from '../state'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Segmented } from '../ui/segmented'
import { useAppBarConfig } from '../state/appBar'
import { useWizardMark } from '../walkthrough/wizard'

/** The page part of the top bar: what the current page registered with `useAppBar`. */
export function AppBar() {
  const c = useAppBarConfig()
  const mark = useWizardMark()
  if (!c) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-display text-lg font-semibold">{c.title}</h1>
        {c.crumbs && c.crumbs.length > 1 && (
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
              {c.crumbs.map((k, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden="true">›</span>}
                  {k.to ? <Link to={k.to} className="hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-accent">{k.label}</Link> : <span aria-current="page" className="text-text">{k.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}
        {c.chip && <span className="self-center rounded-md border border-line-strong bg-surface px-2 py-[3px] font-mono text-xs">{c.chip}</span>}
        <PendingCount />
      </div>
      {c.aside && <div className="text-[13px] text-muted">{c.aside}</div>}
      {!!c.actions?.length && (
        <div className="flex flex-wrap items-center gap-2">
          {c.actions.map(a => a.kind === 'button' ? (
            <span key={a.id} title={a.title ?? a.label} className="inline-flex">{/* a disabled button shows no tooltip itself */}
              <Button {...a.wizard && mark(a.wizard)} variant={a.text && !a.primary ? 'bar' : a.primary ? 'primary' : 'ghost'} size={a.text ? (a.primary ? 'barPrimary' : 'bar') : 'sm'} title={a.title ?? a.label} disabled={a.disabled} onClick={a.onClick}>
                {a.icon}<span className={a.text ? '' : 'sr-only'}>{a.label}</span>
              </Button>
            </span>
          ) : a.kind === 'choice' ? (
            <div key={a.id} className="flex items-center gap-2.5">
              <span className="text-[13px] text-muted">{a.label}</span>
              <div role="group" aria-label={a.label} className="flex gap-1 rounded-[10px] border border-line bg-panel p-1">
                {a.options.map(o => (
                  <button key={o.value} aria-pressed={o.value === a.value} onClick={() => a.onChange(o.value)}
                    className={`min-h-9 rounded-[7px] px-4 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-accent ${o.value === a.value ? 'bg-selected text-text' : 'text-muted hover:text-text'}`}>{o.label}</button>
                ))}
              </div>
            </div>
          ) : (
            <Segmented key={a.id} label={a.label} name={a.id} value={a.value} onChange={a.onChange} className="flex gap-0.5" itemClassName="flex p-1.5"
              options={a.options.map(o => ({ value: o.value, title: o.label, content: <>{o.icon}<span className="sr-only">{o.label}</span></> }))} />
          ))}
        </div>
      )}
    </div>
  )
}

/** "N pending" / "N conflicted" over the running follower chains; each links to the first such chain's Pending panel. */
function PendingCount() {
  const app = useApp() as ReturnType<typeof useApp> | undefined
  const { search } = useLocation()
  const [, bump] = useState(0)
  useEffect(() => registry.watch(() => bump(n => n + 1)), [])
  const live = (app?.chains ?? []).filter(c => c.follows).map(c => ({ id: c.id, ...pendingSummary(followerTxs(registry.peek(c.id))) }))
  const badge = (kind: 'pending' | 'conflicted', variant: 'neutral' | 'warn') => {
    const n = live.reduce((s, c) => s + c[kind], 0)
    const to = live.find(c => c[kind] > 0)
    return to && (
      <Link to={withParams(`/chains${search}`, { chain: to.id })} state={{ pending: true }} className="self-center rounded-full focus-visible:outline-2 focus-visible:outline-accent" title="Show pending transactions">
        <Badge variant={variant}>{n} {kind}</Badge>
      </Link>
    )
  }
  return <>{badge('pending', 'neutral')}{badge('conflicted', 'warn')}</>
}
