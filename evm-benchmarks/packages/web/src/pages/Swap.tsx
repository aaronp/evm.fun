import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { erc20Abi, parseEventLogs, type Address, type Hex } from 'viem'
import { approveCall, readTokenInfo, type Asset } from '@evmb/assets'
import { activity, book, cancelCall, makeOfferCall, priceText, readOffers, swapAbi, takeCall, takeReport, type ActivityItem, type BookRow, type Offer } from '@evmb/swap'
import { useApp } from '../state'
import { useAppBar } from '../state/appBar'
import { accounts as accountStore } from '../store/accounts'
import { assetRegistry } from '../assets/registry'
import { reconcileAssets } from '../assets/build'
import { shortAddress } from '../assets/ui'
import { contractsRegistry } from '../contracts/registry'
import { readContract, signAndSend } from '../tx/send'
import { deploySwap, NO_RECORDS, swapFor } from '../swap/locate'
import { activityText, allowText, amountText, makerLabel, pickPair, rowOf, same, statsText, takeFlash } from '../swap/ui'
import { card, TakePanel, type Funds } from '../components/TakePanel'
import { MakeOfferCard } from '../components/MakeOfferCard'
import { Activity, MyOffers } from '../components/SwapActivity'
import { Button } from '../ui/button'
import { Select } from '../ui/input'
import { Notice } from '../ui/notice'

const stat = 'flex flex-col gap-1 rounded-xl border border-line-strong bg-surface px-3.5 py-3'
const statLabel = 'text-xs text-muted'
const statLine = 'font-mono text-sm font-medium'
const cols = 'grid grid-cols-[1fr_1fr_1fr_64px] gap-2'
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

type Wallet = { base?: bigint; quote?: bigint; allowBase?: bigint; allowQuote?: bigint }

export function Swap() {
  const { chains, chain, selectChain, account, selectAccount, balanceTick, bumpBalance } = useApp()
  const [params, setParams] = useSearchParams()
  const people = accountStore.list()
  const acting = people.find(p => p.address.toLowerCase() === account?.toLowerCase())
  const [assets, setAssets] = useState<Asset[]>([])
  const [swap, setSwap] = useState<Address | null>() // undefined: none on this chain; null: still looking
  const [offers, setOffers] = useState<Offer[]>()
  const [wallet, setWallet] = useState<Wallet>({})
  const [selected, setSelected] = useState<bigint>() // the offer the Take panel acts on
  const [items, setItems] = useState<ActivityItem[]>()
  const [deploying, setDeploying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const [flash, setFlash] = useState<{ text: string; tone: 'success' | 'danger'; tx?: Hex }>()
  const reconciled = useRef(new Set<string>())
  const chainId = chain?.info.id

  useEffect(() => {
    setSwap(null); setAssets([]); setErr(undefined); setFlash(undefined); setSelected(undefined)
    if (!chain) return
    let live = true
    const id = chain.info.id
    // adopt tokens deployed elsewhere (Studio, imports) once per chain per mount, as the Assets page does; never on benchmark chains
    const list = async () => {
      if (!chain.info.ephemeral && !reconciled.current.has(id)) {
        await reconcileAssets(id, await contractsRegistry.list(id), assetRegistry, addr => readTokenInfo(chain.request, addr))
        reconciled.current.add(id) // only once it worked, so a failed attempt is retried on the next visit
      }
      return assetRegistry.list(id)
    }
    Promise.all([list(), swapFor(chain)])
      .then(([a, s]) => { if (live) { setAssets(a); setSwap(s) } }, e => live && setErr(msg(e)))
    return () => { live = false }
  }, [chain])

  const pair = pickPair(assets.filter(a => a.chainId === chainId), params.get('base'), params.get('quote'))
  const { base, quote } = pair

  // offers, balances and allowances are always read live; a tick keeps the old values until the new ones land
  useEffect(() => { setOffers(undefined) }, [chainId, swap])
  useEffect(() => {
    if (!chain || !swap) return
    let live = true
    readOffers(chain.request, swap).then(o => live && setOffers(o), e => live && setErr(msg(e)))
    return () => { live = false }
  }, [chain, swap, balanceTick])

  useEffect(() => { setItems(undefined) }, [chainId, swap, base?.address, quote?.address])
  useEffect(() => {
    if (!chain || !swap || !base || !quote) return
    let live = true
    activity(chain.request, swap, [base.address as Address, quote.address as Address]).then(a => live && setItems(a), e => live && setErr(msg(e)))
    return () => { live = false }
  }, [chain, swap, base?.address, quote?.address, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFlash(undefined) }, [acting?.address])

  useEffect(() => { setWallet({}) }, [chainId, swap, base?.address, quote?.address, acting?.address])
  useEffect(() => {
    if (!chain || !base || !quote || !acting) return
    let live = true
    const read = (t: Asset, fn: 'balanceOf' | 'allowance', args: Address[]) =>
      readContract(chain, t.address as Address, erc20Abi, fn, args).then(v => v as bigint, () => undefined)
    Promise.all([
      read(base, 'balanceOf', [acting.address]), read(quote, 'balanceOf', [acting.address]),
      swap ? read(base, 'allowance', [acting.address, swap]) : undefined, swap ? read(quote, 'allowance', [acting.address, swap]) : undefined,
    ]).then(([b, q, ab, aq]) => live && setWallet({ base: b, quote: q, allowBase: ab, allowQuote: aq }))
    return () => { live = false }
  }, [chain, swap, base?.address, quote?.address, acting?.address, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const pairText = base && quote ? `${base.symbol}/${quote.symbol}` : undefined
  const title = pairText ? `Swap · ${pairText}` : 'Swap'
  useAppBar({
    title,
    crumbs: chain ? [{ label: chain.info.name, to: '/chains' }, { label: title }] : undefined,
    chip: swap ? `Swap.sol ${shortAddress(swap)}` : undefined,
    actions: people.length
      ? [{ kind: 'choice', id: 'acting', label: 'Acting as', value: acting?.address ?? '', options: people.map(p => ({ value: p.address, label: p.label })), onChange: selectAccount }]
      : undefined,
  })

  const picker = (
    <Select aria-label="Chain" className="w-full" value={chainId ?? ''} onChange={e => { setParams({}, { replace: true }); void selectChain(e.target.value || undefined) }}>
      <option value="">Select a chain</option>
      {chains.map(c => <option key={c.id} value={c.id}>{c.name}{c.ephemeral ? ' (benchmark)' : ''}</option>)}
    </Select>
  )
  if (!chain) return <div className="flex max-w-[260px] flex-col gap-2">{picker}<p className="text-sm text-muted">Select a chain first.</p></div>

  async function deploy() {
    if (!chain || !acting || deploying) return
    setDeploying(true); setErr(undefined)
    try { setSwap(await deploySwap(chain, acting, bumpBalance)) } catch (e) { setErr(msg(e)) } finally { setDeploying(false) }
  }

  /** Sign and send from the acting account; a revert is an error unless the caller wants the receipt anyway (takes). */
  async function send(tx: { to: Address; data: Hex }, revertOk = false) {
    if (!chain || !acting || busy) return
    setBusy(true); setErr(undefined); setFlash(undefined)
    try {
      const r = await signAndSend(chain, acting, tx, bumpBalance)
      if (r.status === 'success' || (revertOk && r.status === 'reverted')) return r
      setErr(`Transaction ${r.status}${r.error ? `: ${r.error}` : ''}`)
    } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const approve = (a: Asset, amount: bigint) => void send(approveCall(a, swap!, amount))
  async function take(id: bigint, paySymbol: string) {
    const r = await send(takeCall(swap!, id), true)
    if (!r) return
    if (r.status === 'success') return setFlash({ text: takeFlash(id, 'success'), tone: 'success', tx: r.hash })
    const reason = await takeReport(chain!.request, r.hash).then(x => x.reason, () => undefined)
    setFlash({ text: takeFlash(id, 'reverted', reason, paySymbol), tone: 'danger', tx: r.hash })
  }
  const cancel = async (id: bigint) => { if (await send(cancelCall(swap!, id))) setFlash({ text: `Offer #${id} cancelled; escrow returned.`, tone: 'success' }) }
  async function create(give: { asset: Asset; amount: bigint }, get: { asset: Asset; amount: bigint }) {
    const r = await send(makeOfferCall(swap!, give.asset.address as Address, give.amount, get.asset.address as Address, get.amount))
    if (!r) return false
    const rc = (await chain!.request('eth_getTransactionReceipt', [r.hash]).catch(() => null)) as { logs: Parameters<typeof parseEventLogs>[0]['logs'] } | null
    const id = rc && parseEventLogs({ abi: swapAbi, eventName: 'OfferMade', logs: rc.logs })[0]?.args.id
    setFlash({ text: `Offer${id ? ` #${id}` : ''} created; ${amountText(give.amount, give.asset.decimals)} ${give.asset.symbol} moved into escrow.`, tone: 'success' })
    if (id) setSelected(id)
    return true
  }

  const setPair = (b: string, q: string) => setParams({ base: b, quote: q }, { replace: true })
  const tok = (a: Asset) => ({ address: a.address as Address, decimals: a.decimals })
  const b = base && quote && offers ? book(offers, tok(base), tok(quote)) : undefined
  const s = b && statsText(b, base!, quote!)
  const loading = !!swap && !offers // no "no one is selling" or empty dashes while the offers load
  const dash = loading ? '…' : '—'
  const asks = b ? [...b.asks].reverse() : [], bids = b?.bids ?? [] // asks shown highest first, so the best sits by the spread
  const disabled = !!chain.info.ephemeral || swap === undefined || !base || !quote
  const allow = (v: bigint | undefined, a: Asset) => (v === undefined ? '—' : allowText(v, a.decimals))
  const two = (x: string | undefined, y: string | undefined) => (
    <><span className={statLine}>{x ?? dash} {base?.symbol}</span><span className={statLine}>{y ?? dash} {quote?.symbol}</span></>
  )
  const funds: Funds = a => (same(a.address, base?.address) ? { bal: wallet.base, alw: wallet.allowBase } : { bal: wallet.quote, alw: wallet.allowQuote })
  const name = (a: string) => makerLabel(a, undefined, people)
  const offerOf = (id?: bigint) => offers?.find(o => o.id === id)
  const inPair = (o?: Offer) => (o && base && quote ? rowOf(o, base, quote) : undefined)
  const selRow = inPair(offerOf(selected))
  const isMine = (maker: string) => same(maker, acting?.address)
  const mine = acting && offers?.filter(o => isMine(o.maker)).map(inPair).filter((r): r is BookRow => !!r).reverse()
  const pairItems = offers && items?.filter(i => i.kind === 'approved' || inPair(offerOf(i.id))) // approvals are already pair-filtered
  const amt = (v: bigint | undefined, a?: Asset) => (v === undefined || !a ? undefined : amountText(v, a.decimals))

  const row = (o: BookRow) => {
    const maker = makerLabel(o.maker, acting?.address, people)
    const on = selected === o.id
    return (
      <button key={String(o.id)} aria-pressed={on} onClick={() => { setSelected(o.id); setFlash(undefined) }}
        className={`${cols} min-h-9 items-center px-4 text-left font-mono text-[13px] text-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${on ? 'bg-selected shadow-[inset_3px_0_0_var(--c-accent)]' : 'hover:bg-surface-hover'}`}>
        <span className={o.side === 'ask' ? 'text-ask' : 'text-bid'}>{priceText(o.price)}</span>
        <span className="text-right">{amountText(o.base, base!.decimals)}</span>
        <span className="text-right text-muted">{amountText(o.quote, quote!.decimals)}</span>
        <span className={`text-right font-sans text-xs ${maker === 'you' ? 'text-accent-hover' : 'text-muted'}`}>{maker}</span>
      </button>
    )
  }

  return (
    <div className="flex w-full max-w-[1300px] flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-[260px] max-w-full">{picker}</div>
        {pair.tokens.length >= 2 && (
          <div className="flex items-center gap-2">
            <Select aria-label="Base" value={base?.address ?? ''} onChange={e => setPair(e.target.value, quote?.address ?? '')}>
              {pair.tokens.map(t => <option key={t.id} value={t.address} disabled={t.address === quote?.address}>{t.symbol}</option>)}
            </Select>
            <Button variant="outline" size="field" aria-label="Swap base and quote" title="Swap base and quote" disabled={!base || !quote}
              onClick={() => base && quote && setPair(quote.address!, base.address!)}>⇄</Button>
            <Select aria-label="Quote" value={quote?.address ?? ''} onChange={e => setPair(base?.address ?? '', e.target.value)}>
              {pair.tokens.map(t => <option key={t.id} value={t.address} disabled={t.address === base?.address}>{t.symbol}</option>)}
            </Select>
          </div>
        )}
      </div>

      {chain.info.ephemeral && <Notice>{NO_RECORDS}</Notice>}
      {!chain.info.ephemeral && swap === undefined && (
        <section className={`${card} flex flex-wrap items-center gap-4 px-[22px] py-4`}>
          <p className="flex-1 text-sm text-text-2">{chain.info.name} has no Swap contract yet.</p>
          <span title={acting ? undefined : 'Create an account first'} className="inline-flex">
            <Button onClick={deploy} disabled={!acting || deploying}>{deploying ? 'Deploying…' : 'Deploy Swap.sol?'}</Button>
          </span>
        </section>
      )}
      {pair.error && <p role="alert" className="text-sm text-warn-text">{pair.error}</p>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}

      <div inert={disabled} className={`flex flex-col gap-[18px] ${disabled ? 'opacity-45' : ''}`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className={stat}><span className={statLabel}>Best bid</span><span className="font-mono text-lg font-semibold text-bid">{s?.bestBid ?? dash}</span></div>
          <div className={stat}><span className={statLabel}>Best ask</span><span className="font-mono text-lg font-semibold text-ask">{s?.bestAsk ?? dash}</span></div>
          <div className={stat}><span className={statLabel}>Escrowed in Swap</span>{two(s?.escrowBase, s?.escrowQuote)}</div>
          <div className={stat}><span className={statLabel}>{acting?.label ?? 'No account'} · wallet</span>{two(amt(wallet.base, base), amt(wallet.quote, quote))}</div>
          <div className={stat}><span className={statLabel}>{acting?.label ?? 'No account'} · Swap may spend</span>{two(base && allow(wallet.allowBase, base), quote && allow(wallet.allowQuote, quote))}</div>
        </div>

        {flash && <Notice tone={flash.tone} action={flash.tx && <Link to={`/swap/report?tx=${flash.tx}`} className="ml-auto font-semibold">View report →</Link>}>{flash.text}</Notice>}

        <div className="flex flex-wrap items-stretch gap-4">
          <section aria-labelledby="bk-h" className={`${card} flex max-w-[420px] flex-[1_1_340px] flex-col overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
              <h2 id="bk-h" className="text-sm font-semibold">Open offers</h2>
              <span className="text-xs text-subtle">each fills whole</span>
            </div>
            <div className={`${cols} px-4 py-2 text-[11px] text-subtle`}>
              <span>Price ({quote?.symbol ?? '—'})</span><span className="text-right">{base?.symbol ?? '—'}</span><span className="text-right">{quote?.symbol ?? '—'}</span><span className="text-right">Maker</span>
            </div>
            {asks.map(row)}
            {b && asks.length === 0 && <div className="px-4 py-2.5 text-xs text-subtle">No one is selling {base?.symbol ?? 'the base token'}.</div>}
            <div className="my-1 flex justify-between border-y border-line bg-panel px-4 py-2 text-xs text-muted">
              <span>▲ selling {base?.symbol}</span><span>spread {s?.spread ?? dash}</span><span>▼ buying {base?.symbol}</span>
            </div>
            {bids.map(row)}
            {b && bids.length === 0 && <div className="px-4 py-2.5 text-xs text-subtle">No one is buying {base?.symbol ?? 'the base token'}.</div>}
            <span className="mt-auto px-4 py-3 text-xs text-subtle">Click an offer to take it.</span>
          </section>

          {base && quote && <>
            <TakePanel row={selRow} base={base} quote={quote} maker={selRow ? makerLabel(selRow.maker, acting?.address, people) : ''} own={!!selRow && isMine(selRow.maker)}
              funds={funds} busy={busy || !acting} onApprove={approve} onTake={() => selRow && take(selRow.id, (same(selRow.getToken, base.address) ? base : quote).symbol)} onCancel={() => selRow && cancel(selRow.id)} />
            <MakeOfferCard base={base} quote={quote} book={b} funds={funds} busy={busy || !acting} onApprove={approve} onCreate={create} />
          </>}
        </div>

        <div className="flex flex-wrap items-start gap-4">
          {base && quote && <>
            <MyOffers who={acting?.label ?? 'No account'} rows={mine} base={base} busy={busy}
              name={name} onCancel={r => cancel(r.id)} />
            <Activity items={pairItems} text={i => activityText(i, { name, offer: offerOf, base, quote })} />
          </>}
        </div>
      </div>
    </div>
  )
}
