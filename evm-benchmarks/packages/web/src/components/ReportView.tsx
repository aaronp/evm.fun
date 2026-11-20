import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { shortAddress } from '../assets/ui'
import { Notice } from '../ui/notice'
import { card } from './TakePanel'

export type Mark = 'ok' | 'fail' | 'undo' | 'skip'
export type Step = { mark: Mark; title: string; body: string; evidence: string; detail?: string }
type To = { label: string; to: string }

const MARK = { ok: '✓', fail: '✕', undo: '↺', skip: '–' }
const DOT = {
  ok: 'bg-success-soft text-success', fail: 'bg-danger-soft text-danger', undo: 'bg-warn-soft text-warn-text',
  skip: 'border-2 border-dashed border-line-strong text-muted',
}
const h2 = 'text-[15px] font-semibold'
const big = 'flex min-h-11 items-center justify-center rounded-[10px] text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** Download `text` as a JSON file named `name`. */
export function downloadJson(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** The report layout (Swap's take report, the Trade order report): banner, KPIs, "What happened", "What to do", the
 * page's own side sections (`aside`) and the on-chain record. All text arrives ready to show. */
export function ReportView({ ok, title, pill, summary, meta, notice, kpis, steps, fix, aside, record, rootProps }: {
  ok: boolean; title: string; pill: string; summary: string; meta: string[]; notice?: string
  kpis: { label: string; value: string; sub: string; tone: string }[]
  steps: Step[]
  fix?: { text: string; action?: To; back: To }
  aside?: ReactNode
  record?: { tx: string; ok: boolean; logs?: string[] }
  /** e.g. a walkthrough mark (`data-wizard`) */
  rootProps?: Record<`data-${string}`, string | undefined>
}) {
  const step = (s: Step, i: number, all: Step[]) => (
    <li key={i} className="flex gap-3.5">
      <div className="flex w-6 flex-none flex-col items-center">
        <span role="img" aria-label={s.mark} className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${DOT[s.mark]}`}>{MARK[s.mark]}</span>
        {i < all.length - 1 && <span aria-hidden="true" className="min-h-4 w-0.5 flex-1 bg-line-strong" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pb-4">
        <div className="flex flex-wrap justify-between gap-2">
          <span className={`text-sm font-semibold ${s.mark === 'fail' ? 'text-danger' : s.mark === 'skip' ? 'text-muted' : 'text-text'}`}>{s.title}</span>
          <span className="font-mono text-xs text-muted">{s.evidence}</span>
        </div>
        <span className="text-[13px] leading-normal text-muted">{s.body}</span>
        {s.detail && <code className="mt-1.5 block whitespace-pre-wrap break-words rounded-lg border border-danger-line bg-danger-soft px-3 py-2.5 font-mono text-xs leading-relaxed text-danger">{s.detail}</code>}
      </div>
    </li>
  )

  return (
    <div {...rootProps} className="flex w-full max-w-[1240px] flex-col gap-5">
      <section aria-labelledby="hd-h" className={`flex flex-wrap items-center gap-[18px] rounded-2xl border px-6 py-[22px] ${ok ? 'border-success bg-success-soft' : 'border-danger-line bg-danger-soft'}`}>
        <span aria-hidden="true" className={`flex size-[52px] flex-none items-center justify-center rounded-full bg-surface text-2xl font-bold ${ok ? 'text-success' : 'text-danger'}`}>{ok ? '✓' : '✕'}</span>
        <div className="flex min-w-[min(260px,100%)] flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id="hd-h" className="font-display text-[26px] font-semibold">{title}</h2>
            <span className={`rounded-full px-2.5 py-[3px] text-xs ${ok ? 'bg-surface text-success-text' : 'bg-surface text-danger'}`}>{pill}</span>
          </div>
          <p className="text-[15px] leading-normal text-text-2">{summary}</p>
        </div>
        <div className="flex flex-col gap-1 text-[13px] text-muted sm:text-right">{meta.map(m => <span key={m}>{m}</span>)}</div>
      </section>

      {notice && <Notice>{notice}</Notice>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(k => (
          <div key={k.label} className="flex min-w-0 flex-col gap-1.5 rounded-[14px] border border-line-strong bg-surface px-[18px] py-4">
            <span className="text-xs font-medium text-muted">{k.label}</span>
            <span className={`break-words font-display text-[22px] font-semibold ${k.tone}`}>{k.value}</span>
            <span className="text-xs text-muted">{k.sub}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section aria-labelledby="tl-h" className={`${card} min-w-0 flex-[999_1_480px] px-[22px] py-5`}>
          <h2 id="tl-h" className={`${h2} mb-3.5`}>What happened</h2>
          <ol className="flex flex-col">{steps.map(step)}</ol>
        </section>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          {fix && (
            <section aria-labelledby="fx-h" className="flex flex-col gap-3 rounded-2xl border border-accent bg-accent-soft p-5">
              <h2 id="fx-h" className={h2}>What to do</h2>
              <p className="text-[13px] leading-normal text-text-2">{fix.text}</p>
              {fix.action && <Link to={fix.action.to} className={`${big} bg-accent font-semibold text-on-accent hover:brightness-110`}>{fix.action.label}</Link>}
              <Link to={fix.back.to} className={`${big} border border-line-strong font-medium text-text hover:bg-surface-hover`}>{fix.back.label}</Link>
            </section>
          )}
          {aside}
          {record && (
            <section aria-labelledby="ev-h" className="flex flex-col gap-2.5 rounded-2xl border border-line-strong bg-panel px-5 py-[18px]">
              <div className="flex items-center justify-between">
                <h2 id="ev-h" className={h2}>On-chain record</h2>
                <Link to={`/chains/tx/${record.tx}`} className="text-[13px] font-medium text-accent hover:text-accent-hover">Explorer →</Link>
              </div>
              <div className="flex justify-between gap-2.5 text-[13px]"><span className="text-muted">Tx</span><span title={record.tx} className="font-mono">{shortAddress(record.tx)}</span></div>
              <div className="flex justify-between gap-2.5 text-[13px]"><span className="text-muted">Status</span><span className="font-mono">{record.ok ? '1 (success)' : '0 (reverted)'}</span></div>
              {record.logs && <div className="whitespace-pre-wrap break-words rounded-[10px] border border-line bg-surface px-3 py-2.5 font-mono text-xs leading-[1.8] text-text-2">{record.logs.join('\n')}</div>}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
