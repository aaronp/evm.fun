import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { erc20Abi, type Address } from 'viem'
import { readTokenInfo, type Asset } from '@evmb/assets'
import { activity, position, type PoolActivity as Item } from '@evmb/pool'
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
import { amountText, makerLabel, pickPair } from '../swap/ui'
import { deployPool, usePool } from '../pool/locate'
import { activityRow, offersText } from '../pool/ui'
import { card } from '../components/TakePanel'
import { PoolStats } from '../components/PoolStats'
import { PoolCurve } from '../components/PoolCurve'
import { PoolPosition } from '../components/PoolPosition'
import { PoolActivity } from '../components/PoolActivity'
import { Button } from '../ui/button'
import { Select } from '../ui/input'
import { Notice } from '../ui/notice'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const cols = 'grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.65fr)]'

export function Pool() {
  const { chain, account, balanceTick, bumpBalance, setBusy: lockChain } = useApp()
  const [params, setParams] = useSearchParams()
  const people = accountStore.list()
  const acting = people.find(p => p.address.toLowerCase() === account?.toLowerCase())
  const [assets, setAssets] = useState<Asset[]>([])
  const [wallet, setWallet] = useState<{ base?: bigint; quote?: bigint }>({})
  const [pos, setPos] = useState<{ shares: bigint; base: bigint; quote: bigint }>()
  const [items, setItems] = useState<Item[]>()
  const [offers, setOffers] = useState<string>()
  const [deploying, setDeploying] = useState(false)
  const [deployed, setDeployed] = useState(0) // bumped after a deploy: the record lands after the send's tick
  const [err, setErr] = useState<string>()
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

  const pair = pickPair(assets.filter(a => a.chainId === chainId), params.get('base'), params.get('quote'), 'Pool')
  const { base, quote } = pair
  const pool = usePool(chain, base?.address as Address | undefined, quote?.address as Address | undefined, balanceTick + deployed)
  const s = pool.state

  // everything below is read live on each balance tick; a tick keeps the old values until the new ones land
  useEffect(() => { setWallet({}) }, [chainId, base?.address, quote?.address, acting?.address])
  useEffect(() => {
    if (!chain || !base || !quote || !acting) return
    let live = true
    const bal = (t: Asset) => readContract(chain, t.address as Address, erc20Abi, 'balanceOf', [acting.address]).then(v => v as bigint, () => undefined)
    Promise.all([bal(base), bal(quote)]).then(([b, q]) => live && setWallet({ base: b, quote: q }))
    return () => { live = false }
  }, [chain, base?.address, quote?.address, acting?.address, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPos(undefined); setItems(undefined) }, [chainId, pool.address, acting?.address])
  useEffect(() => {
    if (!chain || !s || !acting) return
    let live = true
    position(chain.request, s, acting.address).then(p => live && setPos(p), e => live && setErr(msg(e)))
    return () => { live = false }
  }, [chain, s, acting?.address]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!chain || !pool.address || pool.block === undefined) return
    let live = true
    activity(chain.request, pool.address, pool.block).then(a => live && setItems(a), e => live && setErr(msg(e)))
    return () => { live = false }
  }, [chain, pool.address, pool.block, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setOffers(undefined) }, [chainId, base?.address, quote?.address])
  useEffect(() => {
    if (!chain || !base || !quote) return
    let live = true
    const tok = (a: Asset) => ({ address: a.address as Address, decimals: a.decimals })
    swapFor(chain).then(async sw => offersText(sw ? book(await readOffers(chain.request, sw), tok(base), tok(quote)) : undefined))
      .then(t => live && setOffers(t), e => live && setErr(msg(e)))
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

  useEffect(() => { lockChain(deploying); return () => lockChain(false) }, [deploying, lockChain])

  if (!chain) return <p className="text-sm text-muted">Select a chain first.</p>

  async function deploy() {
    if (!chain || !acting || !base || !quote || deploying) return
    setDeploying(true); setErr(undefined)
    try { await deployPool(chain, acting, base.address as Address, quote.address as Address, bumpBalance); setDeployed(n => n + 1) } catch (e) { setErr(msg(e)) } finally { setDeploying(false) }
  }

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
          <Select aria-label="Base" disabled={deploying} value={base?.address ?? ''} onChange={e => setPair(e.target.value, quote?.address ?? '')}>
            {pair.tokens.map(t => <option key={t.id} value={t.address} disabled={t.address === quote?.address}>{t.symbol}</option>)}
          </Select>
          <Button variant="outline" size="field" aria-label="Swap base and quote" title="Swap base and quote" disabled={deploying || !base || !quote}
            onClick={() => base && quote && setPair(quote.address!, base.address!)}>⇄</Button>
          <Select aria-label="Quote" disabled={deploying} value={quote?.address ?? ''} onChange={e => setPair(base?.address ?? '', e.target.value)}>
            {pair.tokens.map(t => <option key={t.id} value={t.address} disabled={t.address === base?.address}>{t.symbol}</option>)}
          </Select>
        </div>
      )}

      {chain.info.ephemeral && <Notice>{NO_RECORDS}</Notice>}
      {!chain.info.ephemeral && base && quote && pool.address === undefined && !pool.error && (
        <section className={`${card} flex flex-wrap items-center gap-4 px-[22px] py-4`}>
          <p className="flex-1 text-sm text-text-2">{chain.info.name} has no {B}/{Q} pool yet.</p>
          <span title={acting ? undefined : 'Create an account first'} className="inline-flex">
            <Button onClick={deploy} disabled={!acting || deploying}>{deploying ? 'Deploying…' : 'Deploy Pool.sol?'}</Button>
          </span>
        </section>
      )}
      {pair.error && <p role="alert" className="text-sm text-warn-text">{pair.error}</p>}
      {(err ?? pool.error) && <p role="alert" className="text-sm text-danger">{err ?? pool.error}</p>}

      <div inert={disabled} className={`flex flex-col gap-[18px] ${disabled ? 'opacity-45' : ''}`}>
        <PoolStats s={s} base={B} quote={Q} />
        <div className={cols}>
          {/* Swap / Add liquidity / Remove: Task 4 */}
          <section aria-label="Swap, add or remove liquidity" data-slot="pool-tabs" className={`${card} min-h-40`} />
          <PoolCurve s={s} base={B} quote={Q} offers={offers ?? '…'} />
        </div>
        <div className={`${cols} items-start`}>
          <PoolPosition s={s} pos={pos} base={B} quote={Q} />
          <PoolActivity rows={rows} explorer={pool.address ? `/chains/address/${pool.address}` : undefined} />
        </div>
      </div>
    </div>
  )
}
