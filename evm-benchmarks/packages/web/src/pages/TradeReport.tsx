import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Address } from 'viem'
import { readTokenInfo } from '@evmb/assets'
import { amountText, priceText, quoteFor, type OrderReport } from '@evmb/orderbook'
import { useApp } from '../state'
import { useAppBar } from '../state/appBar'
import { accounts as accountStore } from '../store/accounts'
import { formatAmount, shortAddress } from '../assets/ui'
import { same } from '../swap/ui'
import { openVenue, venueName, type VenueKind } from '../orderbook/locate'
import { idText } from '../orderbook/ui'
import { downloadJson, ReportView, type Step } from '../components/ReportView'
import { Notice } from '../ui/notice'
import { DownloadIcon } from '../ui/icons'

type Token = { address?: string; symbol: string; decimals: number }
type People = { label: string; address: string }[]
const WORD = { open: 'open', partial: 'partly filled', filled: 'filled', cancelled: 'cancelled', failed: 'failed', unfunded: 'unfunded' }
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const bigints = (_: string, v: unknown) => (typeof v === 'bigint' ? String(v) : v)
const backTo = (venue: VenueKind, base?: string | null, quote?: string | null) => `/trade?venue=${venue}&base=${base}&quote=${quote}`

/** One order's report: its fills, cancel or failure (decoded error and the package's fix), in the shared report layout. */
export function TradeReportView({ report: r, base, quote, people, venue }: { report: OrderReport; base: Token; quote: Token; people: People; venue: VenueKind }) {
  const o = r.order, buy = o.side === 'buy', f = r.failure
  const name = (a: string) => people.find(p => same(p.address, a))?.label ?? shortAddress(a)
  const price = priceText(o.price, quote.decimals), unit = `${quote.symbol}/${base.symbol}`
  const left = o.amount - o.filled
  const traded = r.fills.reduce((n, x) => n + x.amount, 0n)
  const avg = traded ? priceText(r.fills.reduce((n, x) => n + x.amount * x.price, 0n) / traded, quote.decimals) : '—'
  const back = backTo(venue, o.market.base, o.market.quote)
  const placed: Step = f
    ? { mark: 'fail', title: `Reverted: ${f.error}`, evidence: o.placedAt.block === undefined ? 'reverted' : `block #${o.placedAt.block}`,
        body: `The order to ${o.side} ${amountText(o.amount, base)} at ${price} reverted; nothing moved.`, detail: `${f.error}(${f.args.map(String).join(', ')})` }
    : { mark: 'ok', title: `Placed: ${buy ? 'Buy' : 'Sell'} ${amountText(o.amount, base)} at ${price}`, evidence: o.placedAt.block === undefined ? 'signed' : `block #${o.placedAt.block}`,
        body: venue === 'onchain' ? 'OrderPlaced on OrderBook.' : 'Signed and stored off-chain; Settlement settles its fills.' }
  const steps: Step[] = [
    placed,
    ...r.fills.map((x): Step => ({
      mark: 'ok', title: `Filled ${amountText(x.amount, base)} at ${priceText(x.price, quote.decimals)}`, evidence: `block #${x.block}`,
      body: `${buy ? 'From' : 'To'} ${name(same(x.maker, o.owner) ? x.taker : x.maker)} for ${amountText(quoteFor(x.amount, x.price, base.decimals, x.takerSide === 'buy' ? 'up' : 'down'), quote)}.`,
    })),
    ...(r.cancelled ? [{ mark: 'undo', title: 'Cancelled', evidence: r.cancelled.block === undefined ? 'cancelled' : `block #${r.cancelled.block}`, body: `The unfilled ${amountText(left, base)} came off the book.` } as Step] : []),
    ...(o.status === 'open' || o.status === 'partial' ? [{ mark: 'skip', title: `Resting: ${amountText(left, base)}`, evidence: 'open', body: `Still on the book at ${price}.` } as Step] : []),
    ...(o.status === 'unfunded' ? [{ mark: 'skip', title: `Not covered: ${amountText(left, base)}`, evidence: 'unfunded',
      body: `Your ${(buy ? quote : base).symbol} balance or allowance to Settlement doesn't cover it, so the book hides it.` } as Step] : []),
  ]
  const tx = f?.tx ?? r.fills.at(-1)?.tx ?? r.cancelled?.tx
  return (
    <ReportView
      ok={!f} title={f ? 'Order failed' : `Order ${idText(o.id)} ${WORD[o.status]}`} pill={`${venue === 'onchain' ? 'On-chain' : 'Off-chain'} · ${o.status}`}
      summary={f
        ? `${name(o.owner)}'s order to ${o.side} ${amountText(o.amount, base)} at ${price} ${unit} reverted with ${f.error}.`
        : `${name(o.owner)} ${buy ? 'buys' : 'sells'} ${amountText(o.amount, base)} at ${price} ${unit}: ${amountText(o.filled, base)} filled in ${r.fills.length} ${r.fills.length === 1 ? 'fill' : 'fills'}.`}
      meta={[`Order ${idText(o.id)} · ${venueName(venue)}`, `${name(o.owner)} · ${buy ? 'Buy' : 'Sell'} ${base.symbol} · price ${price} ${unit}`]}
      kpis={[
        { label: 'Filled', value: `${formatAmount(o.filled, base.decimals, 2)} / ${amountText(o.amount, base)}`, sub: 'filled / size', tone: f ? 'text-danger' : o.filled === o.amount ? 'text-success' : 'text-text' },
        { label: 'Average price', value: avg, sub: `${quote.symbol} per ${base.symbol}`, tone: 'text-text' },
        { label: 'Fills', value: String(r.fills.length), sub: 'trades', tone: 'text-text' },
        { label: 'Remaining', value: amountText(f ? o.amount : left, base), sub: o.status === 'open' || o.status === 'partial' ? 'on the book' : 'not resting', tone: 'text-text' },
      ]}
      steps={steps}
      fix={f?.fix ? { text: f.fix, back: { label: 'Back to the book', to: back } } : undefined}
      record={tx && { tx, ok: !f }}
    />
  )
}

type Got = { report: OrderReport; base: Token; quote: Token } | { error: string }

/** `/trade/report?id=<order id>&venue=onchain|offchain[&base=…&quote=…]` on the current chain, read live. */
export function TradeReport() {
  const { chain } = useApp()
  const [params] = useSearchParams()
  const id = params.get('id')
  const kind: VenueKind = params.get('venue') === 'offchain' ? 'offchain' : 'onchain'
  const people = accountStore.list()
  const [got, setGot] = useState<Got>()
  useEffect(() => {
    setGot(undefined)
    if (!chain || !id) return
    let live = true
    const load = async (): Promise<Got> => {
      const v = await openVenue(chain, kind)
      if (!v) throw new Error(`${chain.info.name} has no ${venueName(kind)} contract`)
      const report = await v.report(id)
      const token = async (address: Address) => ({ address, ...(await readTokenInfo(chain.request, address)) })
      const [base, quote] = await Promise.all([token(report.order.market.base), token(report.order.market.quote)])
      return { report, base, quote }
    }
    load().then(g => live && setGot(g), e => live && setGot({ error: msg(e) }))
    return () => { live = false }
  }, [chain, id, kind])

  const r = got && 'report' in got ? got : undefined
  const leaf = id ? `Order ${idText(id)}` : 'Order report'
  useAppBar({
    title: leaf,
    crumbs: [{ label: r ? `Trade · ${r.base.symbol}/${r.quote.symbol}` : 'Trade', to: backTo(kind, params.get('base') ?? r?.base.address, params.get('quote') ?? r?.quote.address) }, { label: leaf }],
    actions: r ? [{
      kind: 'button', id: 'json', label: 'Download JSON', text: true, icon: <DownloadIcon />,
      onClick: () => downloadJson(`trade-report-${idText(r.report.order.id).replace('#', '')}.json`, JSON.stringify({ venue: kind, ...r.report }, bigints, 2)),
    }] : undefined,
  })

  if (!chain) return <p className="text-sm text-muted">Select a chain first.</p>
  if (!id) return <Notice>No order given.</Notice>
  if (!got) return <p className="text-sm text-muted">Reading the report from {chain.info.name}…</p>
  if ('error' in got) return <Notice tone="danger">{`No report for order ${idText(id)} on ${chain.info.name}: ${got.error}.`}</Notice>
  return <TradeReportView report={got.report} base={got.base} quote={got.quote} people={people} venue={kind} />
}
