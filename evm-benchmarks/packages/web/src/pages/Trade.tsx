import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Address } from 'viem'
import { readTokenInfo, type Asset } from '@evmb/assets'
import { priceText, type Level, type Trade as Fill } from '@evmb/orderbook'
import { useApp } from '../state'
import { useAppBar } from '../state/appBar'
import { accounts as accountStore } from '../store/accounts'
import { assetRegistry } from '../assets/registry'
import { reconcileAssets } from '../assets/build'
import { contractsRegistry } from '../contracts/registry'
import { NO_RECORDS } from '../swap/locate'
import { pickPair } from '../swap/ui'
import { deployVenue, useVenue, venueName, type VenueKind } from '../orderbook/locate'
import { spreadOf } from '../orderbook/ui'
import { card } from '../components/TakePanel'
import { OrderBookPanel } from '../components/OrderBookPanel'
import { DepthChart } from '../components/DepthChart'
import { RecentTrades } from '../components/RecentTrades'
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
  const venue = useVenue(chain, kind, nonce, setErr)
  useEffect(() => setErr(undefined), [kind])
  const [book, setBook] = useState<{ bids: Level[]; asks: Level[] }>()
  const [trades, setTrades] = useState<Fill[]>()
  const [, setPicked] = useState<bigint>() // a clicked level's price, for the order form (Task 9)
  const [deploying, setDeploying] = useState(false)
  const reconciled = useRef(new Set<string>())
  const chainId = chain?.info.id

  useEffect(() => {
    setAssets([]); setErr(undefined)
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
  useEffect(() => { setBook(undefined); setTrades(undefined) }, [venue, base?.address, quote?.address])
  useEffect(() => {
    if (!venue || !base || !quote) return
    let live = true
    const m = { base: base.address as Address, quote: quote.address as Address }
    Promise.all([venue.book(m), venue.trades(m, 20)])
      .then(([b, t]) => { if (live) { setBook(b); setTrades(t) } }, e => live && setErr(msg(e)))
    return () => { live = false }
  }, [venue, base?.address, quote?.address, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const pairText = base && quote ? `${base.symbol}/${quote.symbol}` : undefined
  const title = pairText ? `Trade · ${pairText}` : 'Trade'
  useAppBar({
    title,
    crumbs: chain ? [{ label: chain.info.name, to: '/chains' }, { label: title }] : undefined,
    actions: people.length
      ? [{ kind: 'choice', id: 'acting', label: 'Acting as', value: acting?.address ?? '', options: people.map(p => ({ value: p.address, label: p.label })), onChange: selectAccount }]
      : undefined,
  })

  const working = deploying
  useEffect(() => { lockChain(working); return () => lockChain(false) }, [working, lockChain])

  if (!chain) return <p className="text-sm text-muted">Select a chain first.</p>

  async function deploy() {
    if (!chain || !acting || deploying) return
    setDeploying(true); setErr(undefined)
    try {
      await deployVenue(chain, kind, acting, bumpBalance)
      setNonce(n => n + 1)
    } catch (e) { setErr(msg(e)) } finally { setDeploying(false) }
  }

  const setParam = (kv: Record<string, string>) => setParams(p => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(kv)) n.set(k, v); return n }, { replace: true })
  const markets = pair.tokens.flatMap(b => pair.tokens.filter(q => q !== b).map(q => ({ b, q })))
  const s = book && spreadOf(book.bids, book.asks)
  const last = trades?.[0]?.price
  const disabled = !!chain.info.ephemeral || venue === undefined || !base || !quote
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
            <Button onClick={deploy} disabled={!acting || deploying}>{deploying ? 'Deploying…' : `Deploy ${name}.sol?`}</Button>
          </span>
        </section>
      )}
      {pair.error && <p role="alert" className="text-sm text-warn-text">{pair.error}</p>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}

      {base && quote && (
        <div inert={disabled} className={`flex flex-col gap-4 ${disabled ? 'opacity-45' : ''}`}>
          <div className="flex flex-wrap items-stretch gap-4">
            <OrderBookPanel bids={book?.bids ?? []} asks={book?.asks ?? []} base={base} quote={quote} last={last} spread={s?.spread} onPick={setPicked} />
            <div className="flex min-w-0 flex-[999_1_380px] flex-col gap-4">
              <DepthChart bids={book?.bids ?? []} asks={book?.asks ?? []} quoteDecimals={quote.decimals} />
              <RecentTrades trades={trades} base={base} quoteDecimals={quote.decimals} />
            </div>
            {/* Task 9 slot: the order form (flex-[1_1_300px] max-w-[340px]) goes here, fed by the picked level's price. */}
          </div>
          {/* Task 9 slot: "My orders" goes here, full width under the row above. */}
        </div>
      )}
    </div>
  )
}
