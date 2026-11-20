import { Link } from 'react-router-dom'
import { Button } from '../ui/button'
import { Segmented } from '../ui/segmented'
import { useAppBarConfig } from '../state/appBar'

export function AppBar() {
  const c = useAppBarConfig()
  if (!c) return null
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-display text-xl font-semibold">{c.title}</h1>
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
      </div>
      {!!c.actions?.length && (
        <div className="flex flex-wrap items-center gap-2">
          {c.actions.map(a => a.kind === 'button' ? (
            <span key={a.id} title={a.title ?? a.label} className="inline-flex">{/* a disabled button shows no tooltip itself */}
              <Button variant={a.text && !a.primary ? 'bar' : a.primary ? 'primary' : 'ghost'} size={a.text ? (a.primary ? 'barPrimary' : 'bar') : 'sm'} title={a.title ?? a.label} disabled={a.disabled} onClick={a.onClick}>
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
    </header>
  )
}
