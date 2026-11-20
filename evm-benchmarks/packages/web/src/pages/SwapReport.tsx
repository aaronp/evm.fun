import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Address, Hash } from 'viem'
import type { Asset, Request } from '@evmb/assets'
import { fillText, takeReport, type ReportStep, type TakeReport } from '@evmb/swap'
import { useApp } from '../state'
import { useAppBar } from '../state/appBar'
import { accounts as accountStore } from '../store/accounts'
import { assetRegistry } from '../assets/registry'
import { shortAddress } from '../assets/ui'
import { amountText, reportFmt, reportJson, reportLabels, same } from '../swap/ui'
import { card } from '../components/TakePanel'
import { Notice } from '../ui/notice'
import { DownloadIcon } from '../ui/icons'

type Token = Pick<Asset, 'address' | 'symbol' | 'decimals'>
type People = { label: string; address: string }[]
/** The pair the report was opened from (`base`/`quote` in its link), when known. */
type Hint = { base?: string | null; quote?: string | null }
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The offer's base and quote: the linked pair when it is the offer's, else the chain's asset order (the Swap page's
 * default pair); and the link back to that pair. */
function pairOf(r: TakeReport, tokens: Token[], hint: Hint = {}) {
  const { giveToken: g, getToken: q } = r.offer
  const at = (a: Address) => { const i = tokens.findIndex(t => same(t.address, a)); return i < 0 ? Infinity : i }
  const [base, quote] = same(hint.base, q) && same(hint.quote, g) ? [q, g]
    : same(hint.base, g) && same(hint.quote, q) ? [g, q]
    : at(q) < at(g) ? [q, g] : [g, q]
  return { base, quote, href: `/swap?base=${base}&quote=${quote}` }
}

/** The report and the chain's assets, or the error to show. */
export const loadReport = (request: Request, chainId: string, tx: string): Promise<{ report: TakeReport; assets: Asset[] } | { error: string }> =>
  Promise.all([takeReport(request, tx as Hash), assetRegistry.list(chainId)])
    .then(([report, assets]) => ({ report, assets }), e => ({ error: msg(e) }))

const MARK = { ok: '✓', fail: '✕', undo: '↺', skip: '–' }
const DOT = {
  ok: 'bg-success-soft text-success', fail: 'bg-danger-soft text-danger', undo: 'bg-warn-soft text-warn-text',
  skip: 'border-2 border-dashed border-line-strong text-muted',
}
const kpiTone = (r: TakeReport, i: number) =>
  r.outcome === 'taken' ? (i === 1 ? 'text-success' : 'text-text') : i === 0 ? 'text-danger' : i === 1 ? 'text-warn-text' : 'text-text'
const h2 = 'text-[15px] font-semibold'
const big = 'flex min-h-11 items-center justify-center rounded-[10px] text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** The report itself, success or failure layout, as in the mockup; everything comes from `report`. */
export function ReportView({ report: r, people, assets, hint }: { report: TakeReport; people: People; assets: Token[]; hint?: Hint }) {
  const labels = reportLabels(r, people)
  const pair = pairOf(r, assets, hint)
  const f = reportFmt(labels, assets, pair)
  const fill = (s: string) => fillText(s, f)
  const ok = r.outcome === 'taken'
  const o = r.offer
  const tok = (a: Address) => assets.find(t => same(t.address, a))
  // balances: the taker first, gains before losses; a revert shows what stayed put
  const rank = (h: Address) => [r.taker, o.maker, r.swap].findIndex(x => same(x, h))
  const rows = ok
    ? [...r.balanceChanges].sort((a, b) => rank(a.holder) - rank(b.holder) || Number(b.delta > a.delta) - Number(b.delta < a.delta))
    : [[r.taker, o.giveToken], [r.taker, o.getToken], [r.swap, o.giveToken]].map(([holder, token]) => ({ holder: holder!, token: token!, delta: 0n }))
  const delta = (v: bigint, t: Address) => {
    const text = amountText(v < 0n ? -v : v, tok(t)?.decimals ?? 0)
    return v > 0n ? ['+' + text, 'text-success'] : v < 0n ? ['−' + text, 'text-danger'] : [text, 'text-muted']
  }
  const step = (s: ReportStep, i: number, all: ReportStep[]) => (
    <li key={i} className="flex gap-3.5">
      <div className="flex w-6 flex-none flex-col items-center">
        <span role="img" aria-label={s.mark} className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${DOT[s.mark]}`}>{MARK[s.mark]}</span>
        {i < all.length - 1 && <span aria-hidden="true" className="min-h-4 w-0.5 flex-1 bg-line-strong" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pb-4">
        <div className="flex flex-wrap justify-between gap-2">
          <span className={`text-sm font-semibold ${s.mark === 'fail' ? 'text-danger' : s.mark === 'skip' ? 'text-muted' : 'text-text'}`}>{fill(s.title)}</span>
          <span className="font-mono text-xs text-muted">{s.evidence}</span>
        </div>
        <span className="text-[13px] leading-normal text-muted">{fill(s.body)}</span>
        {s.detail && <code className="mt-1.5 block whitespace-pre-wrap break-words rounded-lg border border-danger-line bg-danger-soft px-3 py-2.5 font-mono text-xs leading-relaxed text-danger">{fill(s.detail)}</code>}
      </div>
    </li>
  )

  return (
    <div className="flex w-full max-w-[1240px] flex-col gap-5">
      <section aria-labelledby="hd-h" className={`flex flex-wrap items-center gap-[18px] rounded-2xl border px-6 py-[22px] ${ok ? 'border-success bg-success-soft' : 'border-danger-line bg-danger-soft'}`}>
        <span aria-hidden="true" className={`flex size-[52px] flex-none items-center justify-center rounded-full bg-surface text-2xl font-bold ${ok ? 'text-success' : 'text-danger'}`}>{ok ? '✓' : '✕'}</span>
        <div className="flex min-w-[min(260px,100%)] flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id="hd-h" className="font-display text-[26px] font-semibold">{r.title}</h2>
            <span className={`rounded-full px-2.5 py-[3px] text-xs ${ok ? 'bg-surface text-success-text' : 'bg-surface text-danger'}`}>{r.pill}</span>
          </div>
          <p className="text-[15px] leading-normal text-text-2">{fill(r.summary)}</p>
        </div>
        <div className="flex flex-col gap-1 text-[13px] text-muted sm:text-right">
          <span>Offer #{String(o.id)} · {f.name(o.maker)} sells {f.amount(o.giveAmt, o.giveToken)} for {f.amount(o.getAmt, o.getToken)}</span>
          <span>Taker {f.name(r.taker)} · price {f.price(o.giveToken, o.giveAmt, o.getToken, o.getAmt)} {f.symbol(pair.quote)}/{f.symbol(pair.base)}</span>
        </div>
      </section>

      {r.reconstructedNow && <Notice>{`The reason was reconstructed at the latest block: this chain no longer keeps the state before block ${r.block}.`}</Notice>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {r.kpis.map((k, i) => (
          <div key={k.label} className="flex min-w-0 flex-col gap-1.5 rounded-[14px] border border-line-strong bg-surface px-[18px] py-4">
            <span className="text-xs font-medium text-muted">{fill(k.label)}</span>
            <span className={`break-words font-display text-[22px] font-semibold ${kpiTone(r, i)}`}>{fill(k.value)}</span>
            <span className="text-xs text-muted">{fill(k.sub)}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section aria-labelledby="tl-h" className={`${card} min-w-0 flex-[999_1_480px] px-[22px] py-5`}>
          <h2 id="tl-h" className={`${h2} mb-3.5`}>What happened</h2>
          <ol className="flex flex-col">{r.steps.map(step)}</ol>
        </section>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          {r.fix && (
            <section aria-labelledby="fx-h" className="flex flex-col gap-3 rounded-2xl border border-accent bg-accent-soft p-5">
              <h2 id="fx-h" className={h2}>What to do</h2>
              <p className="text-[13px] leading-normal text-text-2">{fill(r.fix.text)}</p>
              {r.fix.label && <Link to={pair.href} className={`${big} bg-accent font-semibold text-on-accent hover:brightness-110`}>{fill(r.fix.label)}</Link>}
              <Link to={pair.href} className={`${big} border border-line-strong font-medium text-text hover:bg-surface-hover`}>Back to offers</Link>
            </section>
          )}
          <section aria-labelledby="bc-h" className={`${card} flex flex-col gap-3 p-5`}>
            <h2 id="bc-h" className={h2}>Balance changes</h2>
            {rows.map(b => {
              const [text, tone] = delta(b.delta, b.token)
              return (
                <div key={b.holder + b.token} className="flex justify-between gap-2.5 text-[13px]">
                  <span>{same(b.holder, r.swap) ? 'Swap escrow' : f.name(b.holder)} · {f.symbol(b.token)}</span>
                  <span className={`font-mono ${tone}`}>{text}</span>
                </div>
              )
            })}
            <span className="text-xs leading-normal text-muted">{fill(r.balanceNote)}</span>
          </section>
          <section aria-labelledby="ev-h" className="flex flex-col gap-2.5 rounded-2xl border border-line-strong bg-panel px-5 py-[18px]">
            <div className="flex items-center justify-between">
              <h2 id="ev-h" className={h2}>On-chain record</h2>
              <Link to={`/chains/tx/${r.tx}`} className="text-[13px] font-medium text-accent hover:text-accent-hover">Explorer →</Link>
            </div>
            <div className="flex justify-between gap-2.5 text-[13px]"><span className="text-muted">Tx</span><span title={r.tx} className="font-mono">{shortAddress(r.tx)}</span></div>
            <div className="flex justify-between gap-2.5 text-[13px]"><span className="text-muted">Status</span><span className="font-mono">{ok ? '1 (success)' : '0 (reverted)'}</span></div>
            <div className="whitespace-pre-wrap break-words rounded-[10px] border border-line bg-surface px-3 py-2.5 font-mono text-xs leading-[1.8] text-text-2">{r.logs.map(fill).join('\n')}</div>
          </section>
        </div>
      </div>
    </div>
  )
}

/** The page once the report has been asked for: loading, its error, or the report. */
export function ReportState({ chainName, tx, got, people, hint }: {
  chainName: string; tx: string; got?: Awaited<ReturnType<typeof loadReport>>; people: People; hint?: Hint
}) {
  if (!got) return <p className="text-sm text-muted">Reading the report from {chainName}…</p>
  if ('error' in got) return <Notice tone="danger">{`No report for ${shortAddress(tx)} on ${chainName}: ${got.error}.`}</Notice>
  return <ReportView report={got.report} people={people} assets={got.assets} hint={hint} />
}

/** `/swap/report?tx=<hash>[&base=…&quote=…]` on the current chain: the take's report, read from the chain each time. */
export function SwapReport() {
  const { chain } = useApp()
  const [params] = useSearchParams()
  const tx = params.get('tx')
  const hint = { base: params.get('base'), quote: params.get('quote') }
  const people = accountStore.list()
  const [got, setGot] = useState<Awaited<ReturnType<typeof loadReport>>>()
  useEffect(() => {
    setGot(undefined)
    if (!chain || !tx) return
    let live = true
    loadReport(chain.request, chain.info.id, tx).then(g => live && setGot(g))
    return () => { live = false }
  }, [chain, tx])

  const r = got && 'report' in got ? got : undefined
  const pair = r && pairOf(r.report, r.assets, hint)
  const f = r && reportFmt({}, r.assets)
  const leaf = r ? `Take offer #${r.report.offer.id}` : 'Take report'
  useAppBar({
    title: leaf,
    crumbs: [{ label: pair ? `Swap · ${f!.symbol(pair.base)}/${f!.symbol(pair.quote)}` : 'Swap', to: pair?.href ?? '/swap' }, { label: leaf }],
    actions: r ? [{
      kind: 'button', id: 'json', label: 'Download JSON', text: true, icon: <DownloadIcon />,
      onClick: () => {
        const url = URL.createObjectURL(new Blob([reportJson(r.report, reportLabels(r.report, people))], { type: 'application/json' }))
        const a = document.createElement('a')
        a.href = url
        a.download = `swap-report-${r.report.tx.slice(0, 10)}.json`
        document.body.append(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 0)
      },
    }] : undefined,
  })

  if (!chain) return <p className="text-sm text-muted">Select a chain first.</p>
  if (!tx) return <Notice>No transaction given.</Notice>
  return <ReportState chainName={chain.info.name} tx={tx} got={got} people={people} hint={hint} />
}
