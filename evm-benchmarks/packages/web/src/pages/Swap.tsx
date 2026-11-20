import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { erc20Abi, type Address } from 'viem'
import { MAX_UINT256, type Asset } from '@evmb/assets'
import { book, priceText, readOffers, type BookRow, type Offer } from '@evmb/swap'
import { useApp } from '../state'
import { useAppBar } from '../state/appBar'
import { accounts as accountStore } from '../store/accounts'
import { assetRegistry } from '../assets/registry'
import { shortAddress } from '../assets/ui'
import { readContract } from '../tx/send'
import { deploySwap, NO_RECORDS, swapFor } from '../swap/locate'
import { amountText, makerLabel, pickPair, statsText } from '../swap/ui'
import { Button } from '../ui/button'
import { Select } from '../ui/input'
import { Notice } from '../ui/notice'

const card = 'rounded-2xl border border-line-strong bg-surface'
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
  const [selected, setSelected] = useState<bigint>() // the offer Task 6's Take panel acts on
  const [deploying, setDeploying] = useState(false)
  const [err, setErr] = useState<string>()
  const chainId = chain?.info.id

  useEffect(() => {
    setSwap(null); setAssets([]); setErr(undefined); setSelected(undefined)
    if (!chain) return
    let live = true
    Promise.all([assetRegistry.list(chain.info.id), swapFor(chain)])
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

  const setPair = (b: string, q: string) => setParams({ base: b, quote: q }, { replace: true })
  const tok = (a: Asset) => ({ address: a.address as Address, decimals: a.decimals })
  const b = base && quote ? book(offers ?? [], tok(base), tok(quote)) : undefined
  const s = b && statsText(b, base!, quote!)
  const asks = b ? [...b.asks].reverse() : [], bids = b?.bids ?? [] // asks shown highest first, so the best sits by the spread
  const disabled = !!chain.info.ephemeral || swap === undefined || !s
  const allow = (v: bigint | undefined, a: Asset) => (v === undefined ? '—' : v === MAX_UINT256 ? 'Unlimited' : amountText(v, a.decimals))
  const two = (x: string | undefined, y: string | undefined) => (
    <><span className={statLine}>{x ?? '—'} {base?.symbol}</span><span className={statLine}>{y ?? '—'} {quote?.symbol}</span></>
  )
  const amt = (v: bigint | undefined, a?: Asset) => (v === undefined || !a ? undefined : amountText(v, a.decimals))

  const row = (o: BookRow) => {
    const maker = makerLabel(o.maker, acting?.address, people)
    const on = selected === o.id
    return (
      <button key={String(o.id)} aria-pressed={on} onClick={() => setSelected(on ? undefined : o.id)}
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
          <div className={stat}><span className={statLabel}>Best bid</span><span className="font-mono text-lg font-semibold text-bid">{s?.bestBid ?? '—'}</span></div>
          <div className={stat}><span className={statLabel}>Best ask</span><span className="font-mono text-lg font-semibold text-ask">{s?.bestAsk ?? '—'}</span></div>
          <div className={stat}><span className={statLabel}>Escrowed in Swap</span>{two(s?.escrowBase, s?.escrowQuote)}</div>
          <div className={stat}><span className={statLabel}>{acting?.label ?? 'No account'} · wallet</span>{two(amt(wallet.base, base), amt(wallet.quote, quote))}</div>
          <div className={stat}><span className={statLabel}>{acting?.label ?? 'No account'} · Swap may spend</span>{two(base && allow(wallet.allowBase, base), quote && allow(wallet.allowQuote, quote))}</div>
        </div>

        {/* Task 6: success / failure flash (role="status", "View report →") goes here, between the stats and the cards. */}

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
            {asks.length === 0 && <div className="px-4 py-2.5 text-xs text-subtle">No one is selling {base?.symbol ?? 'the base token'}.</div>}
            <div className="my-1 flex justify-between border-y border-line bg-panel px-4 py-2 text-xs text-muted">
              <span>▲ selling {base?.symbol}</span><span>spread {s?.spread ?? '—'}</span><span>▼ buying {base?.symbol}</span>
            </div>
            {bids.map(row)}
            {bids.length === 0 && <div className="px-4 py-2.5 text-xs text-subtle">No one is buying {base?.symbol ?? 'the base token'}.</div>}
            <span className="mt-auto px-4 py-3 text-xs text-subtle">Click an offer to take it.</span>
          </section>

          {/* Task 6: "Take offer #n" panel for `selected` — <section aria-labelledby="tk-h" className={`${card} flex flex-[1_1_300px] flex-col gap-3.5 p-[18px]`}> */}
          {/* Task 6: "Make an offer" card — <section aria-labelledby="mk-h" className={`${card} flex flex-[1_1_300px] flex-col gap-3.5 p-[18px]`}> */}
        </div>

        <div className="flex flex-wrap items-start gap-4">
          {/* Task 6: "{acting.label}’s offers" — <section aria-labelledby="my-h" className={`${card} flex-[1_1_420px] overflow-hidden`}> */}
          {/* Task 6: "Activity" — <section aria-labelledby="ac-h" className={`${card} flex-[1_1_420px] overflow-hidden`}> */}
        </div>
      </div>
    </div>
  )
}
