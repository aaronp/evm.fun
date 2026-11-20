import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { erc20Abi, type Address, type Hex } from 'viem'
import { approveCall, readTokenInfo, type Asset } from '@evmb/assets'
import { amountText, priceText, type Level, type Order, type OrderInput, type Trade as Fill } from '@evmb/orderbook'
import { useApp } from '../state'
import { useAppBar } from '../state/appBar'
import { accounts as accountStore } from '../store/accounts'
import { assetRegistry } from '../assets/registry'
import { reconcileAssets } from '../assets/build'
import { contractsRegistry } from '../contracts/registry'
import { NO_RECORDS } from '../swap/locate'
import { pickPair } from '../swap/ui'
import { deployVenue, useVenue, venueName, type VenueKind } from '../orderbook/locate'
import { idText, spreadOf } from '../orderbook/ui'
import { walletOf } from '../orderbook/wallet'
import { readContract, signAndSend } from '../tx/send'
import { orThrow, useWizardAction, useWizardMark, useWizardReport } from '../walkthrough/wizard'
import { placedOutputs } from '../walkthrough/run'
import { card } from '../components/TakePanel'
import { OrderBookPanel } from '../components/OrderBookPanel'
import { DepthChart } from '../components/DepthChart'
import { RecentTrades } from '../components/RecentTrades'
import { OrderForm, type Funds } from '../components/OrderForm'
import { MyOrders } from '../components/MyOrders'
import { Button } from '../ui/button'
import { Notice } from '../ui/notice'
import { Segmented } from '../ui/segmented'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const stat = 'flex flex-col gap-0.5'
const statLabel = 'text-xs text-subtle'
const VENUES: { value: VenueKind; content: string }[] = [{ value: 'onchain', content: 'On-chain' }, { value: 'offchain', content: 'Off-chain' }]

export function Trade() {
  const { chain, account, selectAccount, balanceTick, bumpBalance, setBusy: lockChain } = useApp()
  const [params, setParams] = useSearchParams()
  const people = accountStore.list()
  const acting = people.find(p => p.address.toLowerCase() === account?.toLowerCase())
  const kind: VenueKind = params.get('venue') === 'offchain' ? 'offchain' : 'onchain'
  const [assets, setAssets] = useState<Asset[]>([])
  const [nonce, setNonce] = useState(0) // bumped after a deploy so the venue is looked up again
  const [err, setErr] = useState<string>()
  // the live reads' own error slots: each read clears only its own, so a good book read can't hide an orders failure
  const [readErr, setReadErr] = useState<{ book?: string; orders?: string }>({})
  const readFailed = (k: 'book' | 'orders', e?: string) => setReadErr(r => ({ ...r, [k]: e }))
  const venue = useVenue(chain, kind, nonce, setErr)
  useEffect(() => { setErr(undefined); setReadErr({}); setFlash(undefined) }, [kind, account]) // eslint-disable-line react-hooks/exhaustive-deps
  const [book, setBook] = useState<{ bids: Level[]; asks: Level[] }>()
  const [trades, setTrades] = useState<Fill[]>()
  const [picked, setPicked] = useState<{ price: bigint }>() // a clicked level's price, loaded into the order form
  const [funds, setFunds] = useState<{ base: Funds; quote: Funds }>({ base: {}, quote: {} })
  const [orders, setOrders] = useState<Order[]>()
  const [busy, setBusy] = useState(false)
  // the chain it belongs to: a result that lands after a chain switch must not flash on the new chain
  const [flash, setFlashOn] = useState<{ text: string; tone: 'success' | 'danger'; link?: { to: string; label: string }; chainId?: string }>()
  const setFlash = (f?: { text: string; tone: 'success' | 'danger'; link?: { to: string; label: string } }) => setFlashOn(f && { ...f, chainId: chain?.info.id })
  const [deploying, setDeploying] = useState(false)
  const reconciled = useRef(new Set<string>())
  const chainId = chain?.info.id
  const report = useWizardReport(), mark = useWizardMark()

  useEffect(() => {
    setAssets([]); setErr(undefined); setReadErr({})
    if (!chain) return
    let live = true
    const id = chain.info.id
    // adopt tokens deployed elsewhere once per chain per mount, as Swap does; never on benchmark chains
    const list = async () => {
      if (!chain.info.ephemeral && !reconciled.current.has(id)) {
        await reconcileAssets(id, await contractsRegistry.list(id), assetRegistry, addr => readTokenInfo(chain.request, addr))
        reconciled.current.add(id)
      }
      return assetRegistry.list(id)
    }
    list().then(a => live && setAssets(a), e => live && setErr(msg(e)))
    return () => { live = false }
  }, [chain])

  const pair = pickPair(assets.filter(a => a.chainId === chainId), params.get('base'), params.get('quote'), 'Trade')
  const { base, quote } = pair

  // the book and trades are always read live; a tick keeps the old values until the new ones land
  const market = base && quote ? { base: base.address as Address, quote: quote.address as Address } : undefined
  useEffect(() => { setBook(undefined); setTrades(undefined) }, [venue, base?.address, quote?.address])
  useEffect(() => {
    if (!venue || !market) return
    let live = true
    // 20 levels: as deep as the venue matches (maxLevels), so the form's estimate sees what the order would take
    Promise.all([venue.book(market, 20), venue.trades(market, 20)])
      .then(([b, t]) => { if (live) { setBook(b); setTrades(t); readFailed('book') } }, e => live && readFailed('book', msg(e)))
    return () => { live = false }
  }, [venue, base?.address, quote?.address, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // the acting account's orders, balances and allowances to the venue contract, read live like the book
  useEffect(() => { setOrders(undefined); setFunds({ base: {}, quote: {} }) }, [venue, base?.address, quote?.address, acting?.address])
  useEffect(() => {
    if (!chain || !venue || !market || !acting) return
    let live = true
    const read = (t: Address, fn: 'balanceOf' | 'allowance', args: Address[]) =>
      readContract(chain, t, erc20Abi, fn, args).then(v => v as bigint, () => undefined)
    const of = (t: Address) => Promise.all([read(t, 'balanceOf', [acting.address]), read(t, 'allowance', [acting.address, venue.address])]).then(([bal, alw]) => ({ bal, alw }))
    Promise.all([of(market.base), of(market.quote)]).then(([b, q]) => live && setFunds({ base: b, quote: q }))
    venue.orders({ owner: acting.address, market }).then(o => { if (live) { setOrders(o); readFailed('orders') } }, e => live && readFailed('orders', msg(e)))
    return () => { live = false }
  }, [chain, venue, base?.address, quote?.address, acting?.address, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const pairText = base && quote ? `${base.symbol}/${quote.symbol}` : undefined
  const title = pairText ? `Trade · ${pairText}` : 'Trade'
  useAppBar({
    title,
    crumbs: chain ? [{ label: chain.info.name, to: '/chains' }, { label: title }] : undefined,
    actions: people.length
      ? [{ kind: 'choice', id: 'acting', label: 'Acting as', value: acting?.address ?? '', options: people.map(p => ({ value: p.address, label: p.label })), onChange: selectAccount }]
      : undefined,
  })

  const working = deploying || busy // no chain, venue or pair switch while a tx is in flight
  useEffect(() => { lockChain(working); return () => lockChain(false) }, [working, lockChain])
  useWizardAction('trade.deploy', chain && !chain.info.ephemeral && venue === undefined && acting && !deploying ? () => orThrow(deploy()) : undefined)

  if (!chain) return <p className="text-sm text-muted">Select a chain first.</p>

  /** returns the error message when it failed */
  async function deploy() {
    if (!chain || !acting || deploying) return
    setDeploying(true); setErr(undefined)
    try {
      const address = await deployVenue(chain, kind, acting, bumpBalance)
      setNonce(n => n + 1)
      report('trade.deploy', { address, venue: kind })
    } catch (e) { setErr(msg(e)); return msg(e) } finally { setDeploying(false) }
  }

  const reportLink = (id: string) => ({ to: `/trade/report?id=${encodeURIComponent(id)}&venue=${kind}&base=${base?.address}&quote=${quote?.address}`, label: 'View report →' })
  /** Runs one action with the acting account; resolves to the error message when it could not start or threw. */
  async function act(f: (v: NonNullable<typeof venue>, a: NonNullable<typeof acting>) => Promise<void>): Promise<string | undefined> {
    if (!venue || !acting) return 'Select an account first.'
    if (busy) return 'Another transaction is still in flight.'
    setBusy(true); setFlash(undefined)
    try { await f(venue, acting) } catch (e) { return msg(e) } finally { setBusy(false) }
  }
  /** Approve the venue contract to spend `amount` of `a`; returns the error message when it failed. */
  const approve = (a: Asset, amount: bigint) => act(async (v, who) => {
    const r = await signAndSend(chain!, who, approveCall(a, v.address, amount), bumpBalance)
    if (r.status !== 'success') throw new Error(`Approve ${r.status}${r.error ? `: ${r.error}` : ''}`)
    report('order.approve', { tx: r.hash })
  })
  /** Place an order; `placed` once it landed or was signed, `error` when it failed (thrown: nothing sent) or reverted. */
  async function place(o: Omit<OrderInput, 'market'>): Promise<{ placed: boolean; error?: string }> {
    let placed = false, reverted: string | undefined
    const error = await act(async (v, who) => {
      const r = await v.place(walletOf(chain!, who, bumpBalance), { ...o, market: market! })
      placed = true
      bumpBalance() // a signed off-chain order sends nothing; the book and My orders still need a re-read
      if (r.reverted) {
        reverted = `Order reverted: ${r.reverted.error}`
        return setFlash({ text: `${reverted}; nothing moved.`, tone: 'danger', link: r.order && reportLink(r.order.id) })
      }
      report('order.submit', placedOutputs(r))
      const filled = r.fills.reduce((n, f) => n + f.amount, 0n)
      const fills = `${amountText(filled, base!)} filled in ${r.fills.length} ${r.fills.length === 1 ? 'fill' : 'fills'}`
      setFlash(r.order
        ? { text: `Order ${idText(r.order.id)} placed: ${fills}${r.order.status === 'open' || r.order.status === 'partial' ? `, ${amountText(r.order.amount - r.order.filled, base!)} resting` : ''}.`, tone: 'success', link: reportLink(r.order.id) }
        // an off-chain order filled in full rests nothing, so it has no id to report on: its settle tx is the record
        : { text: `${o.side === 'buy' ? 'Bought' : 'Sold'}: ${fills}.`, tone: 'success', link: r.tx && { to: `/chains/tx/${r.tx as Hex}`, label: 'View tx →' } })
    })
    return { placed, error: error ?? reverted }
  }
  /** Cancel one of the acting account's orders; returns the error message when it failed. */
  async function cancel(id: string) {
    const error = await act(async (v, who) => {
      await v.cancel(walletOf(chain!, who, bumpBalance), id)
      report('order.cancel', {})
      setFlash({ text: `Order ${idText(id)} cancelled.`, tone: 'success' })
    })
    if (error) setFlash({ text: error, tone: 'danger' })
    return error
  }

  const setParam = (kv: Record<string, string>) => setParams(p => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(kv)) n.set(k, v); return n }, { replace: true })
  const markets = pair.tokens.flatMap(b => pair.tokens.filter(q => q !== b).map(q => ({ b, q })))
  const s = book && spreadOf(book.bids, book.asks)
  const last = trades?.[0]?.price
  const disabled = !!chain.info.ephemeral || !venue || !base || !quote // venue null: still looking, or the lookup failed
  const name = venueName(kind)

  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-4">
      <header className="flex flex-wrap items-center gap-6 border-b border-line pb-3.5">
        <div className="flex items-center gap-2.5">
          <label className="relative flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[10px] border border-line-strong bg-surface px-3.5 font-display text-lg font-semibold text-text hover:bg-selected has-[:disabled]:cursor-default has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
            <span aria-hidden="true" className="flex">
              <span className="flex size-6 items-center justify-center rounded-full bg-tone-1-bg text-xs text-tone-1-fg">{base?.symbol[0] ?? '?'}</span>
              <span className="-ml-1.5 flex size-6 items-center justify-center rounded-full border-2 border-surface bg-tone-2-bg text-[11px] text-tone-2-fg">{quote?.symbol[0] ?? '?'}</span>
            </span>
            {pairText ?? 'No market'}
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-subtle"><path d="m6 9 6 6 6-6" /></svg>
            <select aria-label="Market" disabled={working || markets.length === 0} value={base && quote ? `${base.address}/${quote.address}` : ''}
              onChange={e => { const [b, q] = e.target.value.split('/'); setParam({ base: b!, quote: q! }) }}
              className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default">
              {markets.map(({ b, q }) => <option key={`${b.address}/${q.address}`} value={`${b.address}/${q.address}`}>{b.symbol}/{q.symbol}</option>)}
            </select>
          </label>
          <button type="button" aria-label="Invert pair" title="Invert pair" disabled={working || !base || !quote}
            onClick={() => base && quote && setParam({ base: quote.address!, quote: base.address! })}
            className="flex size-11 items-center justify-center rounded-[10px] border border-line-strong text-text-2 hover:bg-selected focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-45">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m17 2 4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
        </div>
        <div className={stat}>
          <span className="font-mono text-xl font-semibold text-bid">{last === undefined || !quote ? '—' : priceText(last, quote.decimals)}</span>
          <span className={statLabel}>last · {quote?.symbol ?? '—'} per {base?.symbol ?? '—'}</span>
        </div>
        <div className={stat}>
          <span className="font-mono text-sm font-medium">{s && quote ? priceText(s.spread, quote.decimals) : '—'}</span>
          <span className={statLabel}>spread · {s ? `${s.bps} bps` : '—'}</span>
        </div>
        <div className={stat}>
          <span className="font-mono text-sm font-medium">{chain.info.name}</span>
          <span className={statLabel}>chain</span>
        </div>
        <Segmented label="Venue" name="venue" value={kind} options={VENUES} onChange={v => !working && setParam({ venue: v })}
          className="flex gap-1 rounded-[10px] border border-line bg-panel p-1" itemClassName="flex min-h-[30px] items-center px-2.5 text-xs font-medium" />
      </header>

      {chain.info.ephemeral && <Notice>{NO_RECORDS}</Notice>}
      {!chain.info.ephemeral && venue === undefined && (
        <section className={`${card} flex flex-wrap items-center gap-4 px-[22px] py-4`}>
          <p className="flex-1 text-sm text-text-2">{chain.info.name} has no {name} contract yet.</p>
          <span title={acting ? undefined : 'Create an account first'} className="inline-flex">
            <Button {...mark('trade.deploy')} onClick={deploy} disabled={!acting || deploying}>{deploying ? 'Deploying…' : `Deploy ${name}.sol?`}</Button>
          </span>
        </section>
      )}
      {pair.error && <p role="alert" className="text-sm text-warn-text">{pair.error}</p>}
      {[err, readErr.book, readErr.orders].map((e, i) => e && <p key={i} role="alert" className="text-sm text-danger">{e}</p>)}

      {flash && flash.chainId === chainId && <Notice tone={flash.tone} action={flash.link && <Link to={flash.link.to} className="ml-auto font-semibold">{flash.link.label}</Link>}>{flash.text}</Notice>}

      {base && quote && (
        <div inert={disabled} className={`flex flex-col gap-4 ${disabled ? 'opacity-45' : ''}`}>
          <div className="flex flex-wrap items-stretch gap-4">
            <OrderBookPanel bids={book?.bids.slice(0, 10) ?? []} asks={book?.asks.slice(0, 10) ?? []} base={base} quote={quote} last={last} spread={s?.spread} onPick={price => setPicked({ price })} />
            <div className="flex min-w-0 flex-[999_1_380px] flex-col gap-4">
              <DepthChart bids={book?.bids ?? []} asks={book?.asks ?? []} quoteDecimals={quote.decimals} />
              <RecentTrades trades={trades} base={base} quoteDecimals={quote.decimals} />
            </div>
            <OrderForm base={base} quote={quote} book={book} venue={kind} funds={funds} picked={picked} busy={busy || !acting} onApprove={approve} onPlace={place} />
          </div>
          <MyOrders orders={orders} base={base} quote={quote} venue={kind} busy={busy} onCancel={cancel} />
        </div>
      )}
    </div>
  )
}
