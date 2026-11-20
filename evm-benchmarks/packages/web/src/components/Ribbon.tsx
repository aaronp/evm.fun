import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Button } from '../ui/button'
import { FuseNext } from './FuseNext'
import { adoptAuto } from '../walkthrough/auto'
import { Notice } from '../ui/notice'
import { checkTone, useWizard, type CheckResult } from '../walkthrough/wizard'
import type { Check, Outputs, Step } from '../walkthrough/types'

const TONE = { pass: 'text-success-text', fail: 'text-danger', differs: 'text-warn-text' }

const describe = (c: Check) =>
  'balance' in c ? `${c.balance} has at least ${c.has}`
  : 'escrowed' in c ? `The swap holds ${c.escrowed}`
  : 'offer' in c ? `${c.offer} is ${c.status}`
  : `The take was ${c.outcome}${c.error ? ` (${c.error})` : ''}`

/** One-line summary of what a done step made: the account, chain, token or offer. */
function made(v: Outputs[keyof Outputs] | undefined) {
  if (!v) return undefined
  if ('label' in v) return v.label
  if ('symbol' in v) return v.symbol
  if ('name' in v) return v.name
  if ('offerId' in v) return `offer #${v.offerId}`
  return undefined
}

function download(json: string, name: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** The walkthrough in progress: stepper, the current step, Back / Next and the ribbon's settings. */
export function Ribbon() {
  const c = useWizard()
  const { search } = useLocation()
  useEffect(() => adoptAuto(search, window.location.search), [search])
  if (c && !c.w && c.error) return <Notice tone="danger" onDismiss={c.exit}>{c.error}</Notice> // e.g. couldn't resume
  if (!c?.w || !c.run || !c.step) return null
  const { w, run, step, index } = c
  const vertical = c.layout === 'vertical'
  const label = (s: Step) => made(s.key ? run.values[s.key] : undefined)
  const sub = (s: Step) =>
    c.reused.has(s.id) ? `${label(s)} already exists — reused.`
    : made(s.key ? run.values[s.key] : undefined) ?? (c.isDone(s) ? 'done' : 'not yet')
  const json = JSON.stringify(run.values, null, 2)
  const results: CheckResult[] = c.results[step.id] ?? []

  return (
    <section data-wz-ribbon="" aria-label="Walkthrough" className={`space-y-4 rounded-xl border-2 border-accent bg-accent-soft p-4 shadow-lg ${vertical ? 'sm:sticky sm:top-6 sm:w-80 sm:shrink-0' : ''}`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm"><span className="mr-2 inline-block rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-on-accent">Walkthrough</span><span className="font-semibold text-text">{w.title}</span> <span className="text-muted">· Step {index + 1} of {w.steps.length}</span></p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={c.focus ? 'primary' : 'ghost'} aria-pressed={c.focus} onClick={() => c.setFocus(!c.focus)}>Focus</Button>
          <Button size="sm" variant="ghost" onClick={() => c.setLayout(vertical ? 'horizontal' : 'vertical')} title={vertical ? 'Show the steps above the page' : 'Show the steps beside the page'}>
            {vertical ? 'Steps on top' : 'Steps at the side'}
          </Button>
        </div>
      </header>

      <ol className={`flex gap-3 overflow-x-auto pb-1 ${vertical ? 'sm:flex-col sm:gap-0 sm:overflow-visible' : ''}`}>
        {w.steps.map((s, i) => {
          const current = i === index, isDone = c.isDone(s)
          return (
            <li key={s.id} aria-current={current ? 'step' : undefined} className={`relative flex min-w-36 shrink-0 items-start gap-2.5 ${vertical ? 'sm:min-w-0 sm:pb-3' : ''}`}>
              {vertical && i < w.steps.length - 1 && <span aria-hidden className="absolute top-7 left-3 hidden h-[calc(100%-1.75rem)] w-px bg-line-strong sm:block" />}
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${current ? 'border-accent bg-accent text-on-accent' : isDone ? 'border-success text-success-text' : 'border-line-strong text-muted'}`}>
                {isDone && !current ? '✓' : i + 1}
              </span>
              <span className={`min-w-0 rounded-md px-1.5 ${current ? 'bg-selected' : ''}`}>
                <span className={`block text-[13px] font-medium ${current ? 'text-text' : 'text-text-2'}`}>{s.title}</span>
                <span className="block truncate text-xs text-muted">{sub(s)}</span>
              </span>
            </li>
          )
        })}
      </ol>

      <div className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-widest text-accent">Step {index + 1}</p>
        <h2 className="font-display text-lg font-semibold">{step.title}</h2>
        <p className="text-sm text-text-2">{step.text}</p>
        {c.reused.has(step.id) && <p className="text-sm text-muted">{label(step)} already exists — reused.</p>}
        {c.error && <p role="alert" className="rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{c.error}</p>}
        {results.length > 0 && (
          <ul className="space-y-1 text-sm">
            {results.map((r, i) => {
              const tone = checkTone(r.pass, run.edited)
              return (
                <li key={i} className={TONE[tone]}>
                  {tone === 'pass' ? '✓' : '✗'} {describe(r.check)} — found {r.actual}{tone === 'differs' && ' · Differs from the walkthrough'}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button variant="ghost" disabled={index === 0 || c.busy} onClick={c.back}>Back</Button>
        <Button variant="ghost" onClick={() => c.restart()}>Restart</Button>
        <Button variant="ghost" onClick={c.exit}>Exit</Button>
        <FuseNext className="ml-auto" step={step.id} busy={c.busy} error={c.error} disabled={c.busy || (index === w.steps.length - 1 && c.isDone(step))} onNext={() => void c.next()} />
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted hover:text-text">Run values</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-surface p-2 font-mono text-xs">{json}</pre>
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => download(json, `${w.id}-run.json`)}>Download</Button>
      </details>
    </section>
  )
}
