import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Address, Hash } from 'viem'
import type { Asset, Request } from '@evmb/assets'
import { fillText, takeReport, type TakeReport } from '@evmb/swap'
import { useApp } from '../state'
import { useAppBar } from '../state/appBar'
import { accounts as accountStore } from '../store/accounts'
import { assetRegistry } from '../assets/registry'
import { shortAddress } from '../assets/ui'
import { amountText, reportFmt, reportJson, reportLabels, same } from '../swap/ui'
import { card } from '../components/TakePanel'
import { downloadJson, ReportView } from '../components/ReportView'
import { Notice } from '../ui/notice'
import { useWizardMark } from '../walkthrough/wizard'
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

const kpiTone = (r: TakeReport, i: number) =>
  r.outcome === 'taken' ? (i === 1 ? 'text-success' : 'text-text') : i === 0 ? 'text-danger' : i === 1 ? 'text-warn-text' : 'text-text'

/** The take report, success or failure layout, as in the mockup; everything comes from `report`. */
export function TakeReportView({ report: r, people, assets, hint }: { report: TakeReport; people: People; assets: Token[]; hint?: Hint }) {
  const labels = reportLabels(r, people)
  const pair = pairOf(r, assets, hint)
  const f = reportFmt(labels, assets, pair)
  const mark = useWizardMark()
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

  return (
    <ReportView
      rootProps={mark('view')} ok={ok} title={r.title} pill={r.pill} summary={fill(r.summary)}
      meta={[
        `Offer #${String(o.id)} · ${f.name(o.maker)} sells ${f.amount(o.giveAmt, o.giveToken)} for ${f.amount(o.getAmt, o.getToken)}`,
        `Taker ${f.name(r.taker)} · price ${f.price(o.giveToken, o.giveAmt, o.getToken, o.getAmt)} ${f.symbol(pair.quote)}/${f.symbol(pair.base)}`,
      ]}
      notice={r.reconstructedNow ? `The reason was reconstructed at the latest block: this chain no longer keeps the state before block ${r.block}.` : undefined}
      kpis={r.kpis.map((k, i) => ({ label: fill(k.label), value: fill(k.value), sub: fill(k.sub), tone: kpiTone(r, i) }))}
      steps={r.steps.map(s => ({ mark: s.mark, title: fill(s.title), body: fill(s.body), evidence: s.evidence, detail: s.detail && fill(s.detail) }))}
      fix={r.fix && { text: fill(r.fix.text), action: r.fix.label ? { label: fill(r.fix.label), to: pair.href } : undefined, back: { label: 'Back to offers', to: pair.href } }}
      record={{ tx: r.tx, ok, logs: r.logs.map(fill) }}
      aside={
        <section aria-labelledby="bc-h" className={`${card} flex flex-col gap-3 p-5`}>
          <h2 id="bc-h" className="text-[15px] font-semibold">Balance changes</h2>
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
      }
    />
  )
}

/** The page once the report has been asked for: loading, its error, or the report. */
export function ReportState({ chainName, tx, got, people, hint }: {
  chainName: string; tx: string; got?: Awaited<ReturnType<typeof loadReport>>; people: People; hint?: Hint
}) {
  if (!got) return <p className="text-sm text-muted">Reading the report from {chainName}…</p>
  if ('error' in got) return <Notice tone="danger">{`No report for ${shortAddress(tx)} on ${chainName}: ${got.error}.`}</Notice>
  return <TakeReportView report={got.report} people={people} assets={got.assets} hint={hint} />
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
      onClick: () => downloadJson(`swap-report-${r.report.tx.slice(0, 10)}.json`, reportJson(r.report, reportLabels(r.report, people))),
    }] : undefined,
  })

  if (!chain) return <p className="text-sm text-muted">Select a chain first.</p>
  if (!tx) return <Notice>No transaction given.</Notice>
  return <ReportState chainName={chain.info.name} tx={tx} got={got} people={people} hint={hint} />
}
