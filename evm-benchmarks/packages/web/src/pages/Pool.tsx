import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { erc20Abi, isAddressEqual, type Address, type Hex } from 'viem'
import { approveCall, readTokenInfo, type Asset } from '@evmb/assets'
import { activity, addLiquidityCall, position, quoteRemove, removeLiquidityCall, swapCall, type PoolActivity as Item, type PoolState } from '@evmb/pool'
import { book, readOffers } from '@evmb/swap'
import { useApp } from '../state'
import { useAppBar } from '../state/appBar'
import { accounts as accountStore } from '../store/accounts'
import { assetRegistry } from '../assets/registry'
import { reconcileAssets } from '../assets/build'
import { shortAddress } from '../assets/ui'
import { contractsRegistry } from '../contracts/registry'
import { readContract } from '../tx/send'
import { NO_RECORDS, swapFor } from '../swap/locate'
import { amountText, makerLabel, pickPair, same } from '../swap/ui'
import { deployPool, poolTx, usePool } from '../pool/locate'
import { activityRow, offersText } from '../pool/ui'
import { card, type Funds } from '../components/TakePanel'
import { PoolTabs } from '../components/PoolTabs'
import { PoolStats } from '../components/PoolStats'
import { PoolCurve } from '../components/PoolCurve'
import { PoolPosition } from '../components/PoolPosition'
import { PoolActivity } from '../components/PoolActivity'
import { poolOutputs } from '../walkthrough/run'
import { orThrow, useWizardAction, useWizardMark, useWizardReport } from '../walkthrough/wizard'
import { Button } from '../ui/button'
import { Select } from '../ui/input'
import { Notice } from '../ui/notice'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const cols = 'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.65fr)]'

export function Pool() {
  const { chain, account, balanceTick, bumpBalance, setBusy: lockChain } = useApp()
  const [params, setParams] = useSearchParams()
  const people = accountStore.list()
  const acting = people.find(p => p.address.toLowerCase() === account?.toLowerCase())
  const [assets, setAssets] = useState<Asset[]>([])
  const [wallet, setWallet] = useState<{ base?: bigint; quote?: bigint; allowBase?: bigint; allowQuote?: bigint }>({})
  const [pos, setPos] = useState<{ shares: bigint; base: bigint; quote: bigint }>()
  const [items, setItems] = useState<Item[]>()
  const [offers, setOffers] = useState<string>()
  const [deploying, setDeploying] = useState(false)
  const [deployed, setDeployed] = useState(0) // bumped after a deploy: the record lands after the send's tick
  // one error per read source (and one for the last action), so one source's success never hides another's failure
  const [errs, setErrs] = useState<Partial<Record<'assets' | 'position' | 'activity' | 'offers' | 'action', string>>>({})
  const report = (k: keyof typeof errs) => (e?: unknown) => setErrs(o => ({ ...o, [k]: e === undefined ? undefined : msg(e) }))
  const setErr = report('action')
  const err = errs.assets ?? errs.position ?? errs.activity ?? errs.offers ?? errs.action
  const [busy, setBusy] = useState(false)
  const [after, setAfter] = useState<Pick<PoolState, 'reserveBase' | 'reserveQuote'>>() // the Swap tab's quote, for the curve
  // the chain it belongs to: a tx that lands after a chain switch must not flash on the new chain
  const [flash, setFlashOn] = useState<{ text: string; tone: 'success' | 'danger'; tx?: Hex; chainId?: string }>()
  const setFlash = (f?: { text: string; tone: 'success' | 'danger'; tx?: Hex }) => setFlashOn(f && { ...f, chainId: chain?.info.id })
  const reconciled = useRef(new Set<string>())
  const chainId = chain?.info.id

  useEffect(() => {
    setAssets([]); setErrs({})
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
    list().then(a => { if (live) { setAssets(a); report('assets')() } }, e => live && report('assets')(e))
    return () => { live = false }
  }, [chain])

  const pair = pickPair(assets.filter(a => a.chainId === chainId), params.get('base'), params.get('quote'), 'Pool')
  const { base, quote } = pair
  const pool = usePool(chain, base?.address as Address | undefined, quote?.address as Address | undefined, balanceTick + deployed)
  const s = pool.state

  // everything below is read live on each balance tick; a tick keeps the old values until the new ones land
  useEffect(() => { setWallet({}) }, [chainId, base?.address, quote?.address, acting?.address, pool.address])
  useEffect(() => { setErrs({}); setFlash(undefined) }, [chainId, base?.address, quote?.address, acting?.address]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!chain || !base || !quote || !acting) return
    let live = true
    const read = (t: Asset, fn: 'balanceOf' | 'allowance', args: Address[]) =>
      readContract(chain, t.address as Address, erc20Abi, fn, args).then(v => v as bigint, () => undefined)
    const at = pool.address
    Promise.all([
      read(base, 'balanceOf', [acting.address]), read(quote, 'balanceOf', [acting.address]),
      at ? read(base, 'allowance', [acting.address, at]) : undefined, at ? read(quote, 'allowance', [acting.address, at]) : undefined,
    ]).then(([b, q, ab, aq]) => live && setWallet({ base: b, quote: q, allowBase: ab, allowQuote: aq }))
    return () => { live = false }
  }, [chain, base?.address, quote?.address, acting?.address, pool.address, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPos(undefined); setItems(undefined) }, [chainId, pool.address, acting?.address])
  useEffect(() => {
    if (!chain || !s || !acting) return
    let live = true
    position(chain.request, s, acting.address).then(p => { if (live) { setPos(p); report('position')() } }, e => live && report('position')(e))
    return () => { live = false }
  }, [chain, s, acting?.address]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!chain || !pool.address || pool.block === undefined) return
    let live = true
    activity(chain.request, pool.address, pool.block).then(a => { if (live) { setItems(a); report('activity')() } }, e => live && report('activity')(e))
    return () => { live = false }
  }, [chain, pool.address, pool.block, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setOffers(undefined) }, [chainId, base?.address, quote?.address])
  useEffect(() => {
    if (!chain || !base || !quote) return
    let live = true
    const tok = (a: Asset) => ({ address: a.address as Address, decimals: a.decimals })
    swapFor(chain).then(async sw => offersText(sw ? book(await readOffers(chain.request, sw), tok(base), tok(quote)) : undefined))
      .then(t => { if (live) { setOffers(t); report('offers')() } }, e => live && report('offers')(e))
    return () => { live = false }
  }, [chain, base?.address, quote?.address, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const pairText = base && quote ? `${base.symbol}/${quote.symbol}` : undefined
  const title = pairText ? `Pool · ${pairText}` : 'Pool'
  const held = (v: bigint | undefined, a?: Asset) => (v === undefined || !a ? '—' : `${amountText(v, a.decimals)} ${a.symbol}`)
  useAppBar({
    title,
    crumbs: chain ? [{ label: chain.info.name, to: '/chains' }, { label: title }] : undefined,
    chip: pool.address ? `Pool.sol ${shortAddress(pool.address)}` : undefined,
    aside: acting && base && quote ? <>Your wallet: <span className="font-mono text-text">{held(wallet.base, base)} · {held(wallet.quote, quote)}</span></> : undefined,
  })

  useEffect(() => { lockChain(deploying || busy); return () => lockChain(false) }, [deploying, busy, lockChain])
  const wzReport = useWizardReport(), mark = useWizardMark()
  useWizardAction('pool.deploy', chain && !chain.info.ephemeral && base && quote && pool.address === undefined && !pool.error && acting && !deploying ? () => orThrow(deploy()) : undefined)

  if (!chain) return <p className="text-sm text-muted">Select a chain first.</p>

  /** returns the error message when it failed */
  async function deploy() {
    if (!chain || !acting || !base || !quote || deploying) return
    setDeploying(true); setErr(undefined)
    try {
      const address = await deployPool(chain, acting, base.address as Address, quote.address as Address, bumpBalance)
      setDeployed(n => n + 1)
      wzReport('pool.deploy', { address })
    } catch (e) { setErr(e); return msg(e) } finally { setDeploying(false) }
  }

  type Tok = { symbol: string; decimals: number }
  /**
   * Send one pool/approve call; flashes the outcome with its tx and resolves to the page's error message when it failed.
   * `ok(hash)` runs once it landed: it reports the step's outputs to a walkthrough, whoever pressed.
   */
  async function send(call: { to: Address; data: Hex }, unit: (out: bigint, min: bigint) => Tok, done: string, ok: (tx: Hex) => unknown): Promise<string | undefined> {
    if (!chain || !acting) return 'Create an account first.'
    if (busy) return 'Another transaction is still in flight.'
    setBusy(true); setErr(undefined); setFlash(undefined)
    try {
      const r = await poolTx(chain, acting, call, unit, bumpBalance)
      if (r.error && !r.hash) setErr(r.error)
      else setFlash({ text: r.error ?? done, tone: r.error ? 'danger' : 'success', tx: r.hash })
      if (!r.error && r.hash) await ok(r.hash)
      return r.error
    } catch (e) { setErr(e); return msg(e) } finally { setBusy(false) }
  }
  const reported = (id: string, kind: 'addLiquidity' | 'removeLiquidity' | 'poolSwap') => async (tx: Hex) => { try { wzReport(id, await poolOutputs(chain!, kind, tx)) } catch { /* the tx landed; a failed extra read must not look like a failed send */ } }
  const raw = pool.raw, LP: Tok = { symbol: 'LP', decimals: 18 }
  /** page (base, quote) amounts → the pool's on-chain order */
  const onChain = (b: bigint, q: bigint): [bigint, bigint] => (raw && base && same(raw.base, base.address) ? [b, q] : [q, b])
  const amt = (v: bigint, a: Tok) => `${amountText(v, a.decimals)} ${a.symbol}`
  async function approve(a: Asset, amount: bigint) {
    if (!pool.address) return 'No pool for this pair.'
    return send(approveCall(a, pool.address, amount), () => a, `Approved Pool to spend ${amt(amount, a)}.`, tx => wzReport('pool.approve', { tx }))
  }
  async function swap(tokenIn: Asset, amountIn: bigint, minOut: bigint) {
    if (!raw || !base || !quote) return 'No pool for this pair.'
    const t = tokenIn.address as Address
    if (!isAddressEqual(t, raw.base) && !isAddressEqual(t, raw.quote)) return `${tokenIn.symbol} is not one of this pool's tokens.`
    const out = same(t, base.address) ? quote : base
    return send(swapCall(raw.address, t, amountIn, minOut), () => out, `Swapped ${amt(amountIn, tokenIn)} for at least ${amt(minOut, out)}.`, reported('pool.swap', 'poolSwap'))
  }
  async function add(baseIn: bigint, quoteIn: bigint, minShares: bigint) {
    if (!raw || !base || !quote) return 'No pool for this pair.'
    return send(addLiquidityCall(raw.address, ...onChain(baseIn, quoteIn), minShares), () => LP, `Added liquidity to the ${base.symbol}/${quote.symbol} pool.`, reported('pool.add', 'addLiquidity'))
  }
  async function remove(shares: bigint, minBase: bigint, minQuote: bigint) {
    if (!raw || !base || !quote) return 'No pool for this pair.'
    if (!shares || pos === undefined || shares > pos.shares) return 'Remove between 0 and your shares.'
    const [m0, m1] = onChain(minBase, minQuote)
    // a Slippage(out, min) names one side: the min it failed (pool order); equal mins → the payout nearer `out`
    const [t0, t1] = same(raw.base, base.address) ? [base, quote] : [quote, base]
    const pay = quoteRemove(raw, shares), dist = (x: bigint, y: bigint) => (x > y ? x - y : y - x)
    const side = (out: bigint, min: bigint) => (min !== m1 ? t0 : min !== m0 ? t1 : dist(out, pay.base) <= dist(out, pay.quote) ? t0 : t1)
    return send(removeLiquidityCall(raw.address, shares, m0, m1), side, `Removed ${amt(shares, LP)} from the pool.`, reported('pool.remove', 'removeLiquidity'))
  }
  const funds: Funds = a => (same(a.address, base?.address) ? { bal: wallet.base, alw: wallet.allowBase } : { bal: wallet.quote, alw: wallet.allowQuote })

  const setPair = (b: string, q: string) => setParams({ base: b, quote: q }, { replace: true })
  const disabled = !!chain.info.ephemeral || !pool.address || !base || !quote
  const name = (a: string) => makerLabel(a, undefined, people)
  const rows = items && pool.raw && base && quote
    ? items.map(i => ({ key: `${i.tx}:${i.kind}`, ...activityRow(i, pool.raw!, { base, quote }, name) }))
    : undefined
  const B = base?.symbol ?? '—', Q = quote?.symbol ?? '—'

  return (
    <div className="flex w-full max-w-[1300px] flex-col gap-[18px]">
      {pair.tokens.length >= 2 && (
        <div className="flex items-center gap-2">
          <Select aria-label="Base" disabled={deploying || busy} value={base?.address ?? ''} onChange={e => setPair(e.target.value, quote?.address ?? '')}>
            {pair.tokens.map(t => <option key={t.id} value={t.address} disabled={t.address === quote?.address}>{t.symbol}</option>)}
          </Select>
          <Button variant="outline" size="field" aria-label="Swap base and quote" title="Swap base and quote" disabled={deploying || busy || !base || !quote}
            onClick={() => base && quote && setPair(quote.address!, base.address!)}>⇄</Button>
          <Select aria-label="Quote" disabled={deploying || busy} value={quote?.address ?? ''} onChange={e => setPair(base?.address ?? '', e.target.value)}>
            {pair.tokens.map(t => <option key={t.id} value={t.address} disabled={t.address === base?.address}>{t.symbol}</option>)}
          </Select>
        </div>
      )}

      {chain.info.ephemeral && <Notice>{NO_RECORDS}</Notice>}
      {!chain.info.ephemeral && base && quote && pool.address === undefined && !pool.error && (
        <section className={`${card} flex flex-wrap items-center gap-4 px-[22px] py-4`}>
          <p className="flex-1 text-sm text-text-2">{chain.info.name} has no {B}/{Q} pool yet.</p>
          <span title={acting ? undefined : 'Create an account first'} className="inline-flex">
            <Button {...mark('pool.deploy')} onClick={deploy} disabled={!acting || deploying}>{deploying ? 'Deploying…' : 'Deploy Pool.sol?'}</Button>
          </span>
        </section>
      )}
      {pair.error && <p role="alert" className="text-sm text-warn-text">{pair.error}</p>}
      {(err ?? pool.error) && <p role="alert" className="text-sm text-danger">{err ?? pool.error}</p>}
      {flash && flash.chainId === chainId && <Notice tone={flash.tone} action={flash.tx && <Link to={`/chains/tx/${flash.tx}`} className="ml-auto font-semibold">View tx →</Link>}>{flash.text}</Notice>}

      <div inert={disabled} className={`flex flex-col gap-[18px] ${disabled ? 'opacity-45' : ''}`}>
        <PoolStats s={s} base={B} quote={Q} />
        <div className={cols}>
          {s && base && quote
            ? <PoolTabs key={`${pool.address}:${base.address}`} s={s} base={base} quote={quote} funds={funds} busy={busy || !acting} mine={pos?.shares}
                onApprove={approve} onSwap={swap} onAdd={add} onRemove={remove} onAfter={setAfter} />
            : <section aria-label="Swap, add or remove liquidity" className={`${card} min-h-40`} />}
          <PoolCurve s={s} after={after} base={B} quote={Q} offers={offers ?? '…'} />
        </div>
        <div className={`${cols} items-start`}>
          <PoolPosition s={s} pos={pos} base={B} quote={Q} />
          <PoolActivity rows={rows} explorer={pool.address ? `/chains/address/${pool.address}` : undefined} />
        </div>
      </div>
    </div>
  )
}
