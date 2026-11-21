import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { erc20Abi, encodeFunctionData, parseEventLogs, type Address, type Hex } from 'viem'
import { readTokenInfo, type Asset } from '@evmb/assets'
import { claimCall, hashLockAbi, hashOf, lockCall, locksFor, newSecret, refundCall, swapState, type LockView, type SwapState } from '@evmb/htlc'
import { useApp } from '../state'
import { useAppBar } from '../state/appBar'
import type { ChainHandle } from '../chain/handle'
import { registry } from '../chain/revm'
import { accounts as accountStore } from '../store/accounts'
import { assetRegistry } from '../assets/registry'
import { reconcileAssets } from '../assets/build'
import { shortAddress } from '../assets/ui'
import { contractsRegistry } from '../contracts/registry'
import { readContract, signAndSend } from '../tx/send'
import { NO_RECORDS } from '../swap/locate'
import { withParams } from '../links'
import { deployHashLock, hashLockAt, headOf, sidesFor } from '../htlc/locate'
import { answers, secrets } from '../htlc/secrets'
import { actionText, actionsFor, chainLabel, roleOf, titleOf, type Action } from '../htlc/ui'
import { amountText, same } from '../swap/ui'
import { ChainColumn } from '../components/xswap/ChainColumn'
import { MakeLock } from '../components/xswap/MakeLock'
import { AcceptLock, IncomingLocks, MySwaps } from '../components/xswap/IncomingLocks'
import { ClaimRefund } from '../components/xswap/ClaimRefund'
import { SwapTimeline } from '../components/xswap/SwapTimeline'
import { GasFix, useRequestFix } from '../components/Shortfall'
import { Select } from '../ui/input'
import { Notice } from '../ui/notice'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
type Lock = { address: Address; block: bigint }
type Wallet = { bal?: bigint; alw?: bigint }
const approve = (token: Address, spender: Address, amount: bigint) =>
  ({ to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }) })

/** A chain's ERC-20s, adopting tokens deployed elsewhere first (as Swap does; never on benchmark chains). */
async function tokensOf(h: ChainHandle) {
  if (!h.info.ephemeral) await reconcileAssets(h.info.id, await contractsRegistry.list(h.info.id), assetRegistry, a => readTokenInfo(h.request, a))
  return (await assetRegistry.list(h.info.id)).filter(a => a.kind === 'erc20')
}
async function walletOf(h: ChainHandle, token: Address, who: Address, spender: Address): Promise<Wallet> {
  const read = (fn: 'balanceOf' | 'allowance', args: Address[]) => readContract(h, token, erc20Abi, fn, args).then(v => v as bigint, () => undefined)
  const [bal, alw] = await Promise.all([read('balanceOf', [who]), read('allowance', [who, spender])])
  return { bal, alw }
}

/** `/xswap?chain=<A>&chainB=<B>&base=&quote=&hash=`: a hash-locked swap between two chains, playing both parties (`?as=`). */
export function XSwap() {
  const { chain, chains, account, selectAccount, balanceTick, bumpBalance, setBusy: lockChain } = useApp()
  const [params, setParams] = useSearchParams()
  const { pathname, search } = useLocation()
  const people = accountStore.list()
  const acting = people.find(p => same(p.address, account))
  const bId = params.get('chainB'), hash = (params.get('hash') || undefined) as Hex | undefined
  const infoB = chains.find(c => c.id === bId)
  const [chainB, setChainB] = useState<ChainHandle>()
  const [tokA, setTokA] = useState<Asset[]>([]), [tokB, setTokB] = useState<Asset[]>([])
  const [lockA, setLockA] = useState<Lock | null>(), [lockB, setLockB] = useState<Lock | null>() // null: still looking
  const [headA, setHeadA] = useState<bigint>(), [headB, setHeadB] = useState<bigint>()
  const [st, setSt] = useState<SwapState & { b: boolean }>()
  const [mine, setMine] = useState<LockView[]>([])
  const [walletA, setWalletA] = useState<Wallet>({}), [walletB, setWalletB] = useState<Wallet>({})
  const [secret, setSecret] = useState<Hex>()
  const [busy, setBusy] = useState(false)
  const [deploying, setDeploying] = useState<'A' | 'B'>()
  const [mining, setMining] = useState<'A' | 'B'>()
  const [mineErr, setMineErr] = useState<{ A?: string; B?: string }>({})
  const [err, setErr] = useState<{ text: string; on?: ChainHandle }>()
  const [flash, setFlash] = useState<{ text: string; tone: 'success' | 'danger'; href?: string }>()
  const chainId = chain?.info.id
  const okB = !!infoB && !infoB.ephemeral && infoB.id !== chainId
  const seq = useRef(0)

  useEffect(() => { setErr(undefined); setFlash(undefined) }, [chainId, bId, acting?.address])
  useEffect(() => {
    setChainB(undefined)
    if (!okB) return
    let live = true
    registry.open(infoB!.id).then(h => live && setChainB(h), e => live && setErr({ text: msg(e) }))
    return () => { live = false }
  }, [okB, infoB?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // each chain's tokens and HashLock, once per chain
  const useChain = (h: ChainHandle | undefined, setTok: (t: Asset[]) => void, setLock: (l: Lock | null | undefined) => void) => useEffect(() => {
    setTok([]); setLock(null)
    if (!h) return
    let live = true
    Promise.all([tokensOf(h), hashLockAt(h)]).then(([t, l]) => { if (live) { setTok(t); setLock(l) } }, e => live && setErr({ text: msg(e), on: h }))
    return () => { live = false }
  }, [h]) // eslint-disable-line react-hooks/exhaustive-deps
  useChain(chain, setTokA, setLockA)
  useChain(chainB, setTokB, setLockB)

  const base = tokA.find(t => same(t.address, params.get('base'))) ?? tokA[0]
  const quote = tokB.find(t => same(t.address, params.get('quote'))) ?? tokB.find(t => t.symbol !== base?.symbol) ?? tokB[0]

  // live reads, refreshed after every send and every Advance (both bump balanceTick)
  useEffect(() => {
    if (!chain) return setHeadA(undefined)
    let live = true
    headOf(chain).then(v => live && setHeadA(v), () => {})
    return () => { live = false }
  }, [chain, balanceTick])
  useEffect(() => {
    if (!chainB) return setHeadB(undefined)
    let live = true
    headOf(chainB).then(v => live && setHeadB(v), () => {})
    return () => { live = false }
  }, [chainB, balanceTick])
  useEffect(() => {
    if (!chain || !lockA || !acting) return setMine([])
    let live = true
    const read = (f: { sender?: Address; recipient?: Address }) => locksFor(chain.request, lockA.address, lockA.block, { ...f, chain: chain.info.id })
    Promise.all([read({ sender: acting.address }), read({ recipient: acting.address })])
      .then(([s, r]) => live && setMine([...s, ...r].filter(l => l.wantChain !== '').sort((x, y) => Number(y.id - x.id))), e => live && setErr({ text: msg(e) }))
    return () => { live = false }
  }, [chain, lockA, acting?.address, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSt(undefined)
  }, [chainId, hash])
  useEffect(() => {
    if (!chain || !hash || !lockA) return
    let live = true
    const n = ++seq.current
    sidesFor(chain, chainB, hash).then(async s => s.a && ({ ...await swapState(s.a, s.b, hash), b: !!s.b }))
      .then(v => live && n === seq.current && setSt(v || undefined), e => live && setErr({ text: msg(e) }))
    return () => { live = false }
  }, [chain, chainB, hash, lockA, balanceTick])

  const opening = st?.opening, answer = st?.answer
  const role = roleOf(opening, acting?.address)
  const wantB = !!opening && !!chainB && chainB.info.id === opening.wantChain
  useEffect(() => {
    if (!chain || !lockA || !base || !acting) return setWalletA({})
    let live = true
    walletOf(chain, base.address as Address, acting.address as Address, lockA.address).then(w => live && setWalletA(w))
    return () => { live = false }
  }, [chain, lockA, base?.address, acting?.address, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!chainB || !wantB || !acting) return setWalletB({})
    let live = true
    walletOf(chainB, opening!.wantToken, acting.address as Address, opening!.wantLock).then(w => live && setWalletB(w))
    return () => { live = false }
  }, [chainB, wantB, opening?.wantToken, opening?.wantLock, acting?.address, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps
  // the secret is read only for the maker's own view
  useEffect(() => {
    setSecret(undefined)
    if (role !== 'maker' || !hash) return
    let live = true
    secrets.get(hash).then(e => live && setSecret(e?.secret))
    return () => { live = false }
  }, [role, hash])

  const nameA = chain?.info.name ?? '', nameB = chainB?.info.name ?? (bId ? chainLabel(bId, chains) : '')
  const title = titleOf(base?.symbol, nameA, quote?.symbol, chainB ? nameB : undefined)
  useAppBar({
    title,
    crumbs: chain ? [{ label: chain.info.name, to: '/chains' }, { label: title }] : undefined,
    chip: lockA ? `HashLock.sol ${shortAddress(lockA.address)}` : undefined,
    actions: people.length
      ? [{ kind: 'choice', id: 'acting', label: 'Acting as', value: acting?.address ?? '', options: people.map(p => ({ value: p.address, label: p.label })), onChange: selectAccount }]
      : undefined,
  })
  const working = busy || !!deploying || !!mining
  useEffect(() => { lockChain(working); return () => lockChain(false) }, [working, lockChain])

  if (!chain) return <p className="text-sm text-muted">Select a chain first.</p>

  const tokenOf = (c: string, a: Address) => [...tokA, ...tokB].find(t => t.chainId === c && same(t.address, a))
  const amt = (c: string, v: bigint, a: Address) => { const t = tokenOf(c, a); return t ? `${amountText(v, t.decimals)} ${t.symbol}` : `${v} ${shortAddress(a)}` }
  const lockAmount = (l: LockView) => amt(l.chain, l.amount, l.token)
  const wantAmount = (l: LockView) => amt(l.wantChain, l.wantAmount, l.wantToken)
  const who = (a: string) => (same(a, acting?.address) ? 'you' : people.find(p => same(p.address, a))?.label ?? shortAddress(a))
  const handle = (s: 'A' | 'B') => (s === 'A' ? chain : chainB)
  const set = (p: Record<string, string | undefined>) => setParams(sp => {
    for (const [k, v] of Object.entries(p)) v ? sp.set(k, v) : sp.delete(k)
    return sp
  }, { replace: true })

  async function deploy(s: 'A' | 'B') {
    const h = handle(s)
    if (!h || !acting || deploying) return
    setDeploying(s); setErr(undefined)
    try {
      await deployHashLock(h, acting, bumpBalance)
      const l = await hashLockAt(h)
      ;(s === 'A' ? setLockA : setLockB)(l)
    } catch (e) { setErr({ text: msg(e), on: h }) } finally { setDeploying(undefined) }
  }
  async function advance(s: 'A' | 'B', n: number) {
    const h = handle(s)
    if (!h || mining || busy) return
    setMining(s); setMineErr(m => ({ ...m, [s]: undefined }))
    try { await h.mine(n) } catch (e) { setMineErr(m => ({ ...m, [s]: msg(e) })) } finally { setMining(undefined); bumpBalance() }
  }
  /** Sign and send on `h` from the acting account; a revert flashes with its report link. */
  async function send(h: ChainHandle, tx: { to: Address; data: Hex }, done: string) {
    if (!acting || busy) return
    setBusy(true); setErr(undefined); setFlash(undefined)
    try {
      const r = await signAndSend(h, acting, tx, bumpBalance)
      // back to this swap on this chain A, whichever chain the tx was on
      const href = withParams('/xswap/report', { tx: r.hash, chain: h.info.id, back: withParams(pathname + search, { chain: chain!.info.id }) })
      if (r.status === 'success') { setFlash({ text: done, tone: 'success', href }); return r }
      if (r.status === 'reverted') setFlash({ text: `The transaction reverted on ${h.info.name}.`, tone: 'danger', href })
      else setErr({ text: `Transaction ${r.status}${r.error ? `: ${r.error}` : ''}`, on: h })
    } catch (e) { setErr({ text: msg(e), on: h }) } finally { setBusy(false) }
  }

  async function make(t: { amount: bigint; want: bigint; taker: Address; timeoutBlock: bigint }) {
    if (!lockA || !lockB || !chainB || !base || !quote) return 'Both chains need a HashLock and a token first.'
    const s = newSecret(), h = hashOf(s)
    // kept before the lock is sent: a lock whose secret is lost could only be refunded
    await secrets.put(h, { secret: s, chain: chain!.info.id, lockId: '' })
    const r = await send(chain!, lockCall(lockA.address, { token: base.address as Address, amount: t.amount, recipient: t.taker, hash: h, timeoutBlock: t.timeoutBlock,
      wantChain: chainB.info.id, wantLock: lockB.address, wantToken: quote.address as Address, wantAmount: t.want }), `Locked ${amountText(t.amount, base.decimals)} ${base.symbol} on ${chain!.info.name}.`)
    if (!r) return 'The lock was not made.'
    const rc = (await chain!.request('eth_getTransactionReceipt', [r.hash])) as { logs: Parameters<typeof parseEventLogs>[0]['logs'] }
    const id = parseEventLogs({ abi: hashLockAbi, eventName: 'Locked', logs: rc.logs })[0]?.args.id
    if (id !== undefined) await secrets.put(h, { secret: s, chain: chain!.info.id, lockId: String(id) })
    set({ hash: h })
  }
  async function accept(timeoutBlock: bigint) {
    if (!opening || !chainB || !hash) return 'Pick an incoming lock first.'
    await answers.put(hash, await headOf(chain!)) // A's head as the taker locks: the report judges `unsafe` from it
    const r = await send(chainB, lockCall(opening.wantLock, { token: opening.wantToken, amount: opening.wantAmount, recipient: opening.sender, hash, timeoutBlock }),
      `Locked ${wantAmount(opening)} on ${chainB.info.name}.`)
    return r ? undefined : 'The lock was not made.'
  }
  function act(a: Action) {
    if (!opening) return
    const tx = {
      claimB: () => answer && secret && [chainB!, claimCall(answer.address, answer.id, secret)] as const,
      claimA: () => answer && [chain!, claimCall(opening.address, opening.id, answer.secret)] as const,
      refundA: () => [chain!, refundCall(opening.address, opening.id)] as const,
      refundB: () => answer && [chainB!, refundCall(answer.address, answer.id)] as const,
      accept: () => undefined,
    }[a]()
    if (tx) void send(tx[0], tx[1], `${actionText(a, copy)}: done.`)
  }

  const copy = {
    amtA: opening ? amountText(opening.amount, tokenOf(opening.chain, opening.token)?.decimals ?? 0) : '', base: opening ? tokenOf(opening.chain, opening.token)?.symbol ?? '' : '', chainA: nameA,
    amtB: opening ? amountText(answer?.amount ?? opening.wantAmount, tokenOf(opening.wantChain, opening.wantToken)?.decimals ?? 0) : '',
    quote: opening ? tokenOf(opening.wantChain, opening.wantToken)?.symbol ?? shortAddress(opening.wantToken) : '', chainB: opening ? chainLabel(opening.wantChain, chains) : nameB,
  }
  const actions = st ? actionsFor(st, acting?.address, { secret: !!secret, b: st.b }) : []
  const wantTok = opening && chainB ? tokenOf(chainB.info.id, opening.wantToken) : undefined
  const pending = (h?: ChainHandle) => (h?.approach.pending?.() ?? 0) > 0
  const disabled = !!chain.info.ephemeral
  const mineProps = (s: 'A' | 'B') => ({ disabled: working || pending(handle(s)), busy: mining === s, error: mineErr[s], onMine: (n: number) => void advance(s, n) })
  const deployProps = (h?: ChainHandle, s?: 'A' | 'B') => (h && !h.info.ephemeral && acting ? { busy: deploying === s, onDeploy: () => void deploy(s!) } : undefined)
  const incoming = mine.filter(l => same(l.recipient, acting?.address) && l.status === 'locked')
  const pick = (l: LockView) => set({ hash: l.hash, ...(chains.some(c => c.id === l.wantChain && c.id !== chainId) && { chainB: l.wantChain }) })
  const reportHref = opening ? `/xswap/report?hash=${opening.hash}&chain=${chainId}&chainB=${opening.wantChain}` : undefined
  const others = people.filter(p => !same(p.address, acting?.address))
  const otherChains = chains.filter(c => c.id !== chainId)

  return (
    <div className="flex w-full max-w-[1300px] flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-muted">Chain B
          <Select aria-label="Chain B" disabled={working} value={okB ? bId! : ''} onChange={e => set({ chainB: e.target.value || undefined, quote: undefined })}>
            <option value="">Pick a chain…</option>
            {otherChains.map(c => <option key={c.id} value={c.id} disabled={!!c.ephemeral}>{c.name}{c.ephemeral ? ' (benchmark)' : ''}</option>)}
          </Select>
        </label>
        {tokA.length > 0 && (
          <label className="flex items-center gap-2 text-[13px] text-muted">Base on {nameA}
            <Select aria-label="Base" disabled={working} value={base?.address ?? ''} onChange={e => set({ base: e.target.value })}>
              {tokA.map(t => <option key={t.id} value={t.address}>{t.symbol}</option>)}
            </Select>
          </label>
        )}
        {tokB.length > 0 && (
          <label className="flex items-center gap-2 text-[13px] text-muted">Quote on {nameB}
            <Select aria-label="Quote" disabled={working} value={quote?.address ?? ''} onChange={e => set({ quote: e.target.value })}>
              {tokB.map(t => <option key={t.id} value={t.address}>{t.symbol}</option>)}
            </Select>
          </label>
        )}
      </div>

      {chain.info.ephemeral && <Notice>{NO_RECORDS}</Notice>}
      {bId && !infoB && <Notice>{`Chain B: chain not in this browser (${bId}).`}</Notice>}
      {infoB?.ephemeral && <Notice>{`${infoB.name}: ${NO_RECORDS}`}</Notice>}
      {bId === chainId && <Notice>Pick a chain B other than chain A.</Notice>}
      {!bId && <Notice>Pick chain B: the chain the other token lives on.</Notice>}
      {chainB && lockA !== null && lockB !== null && (!tokA.length || !tokB.length) && <p className="text-sm text-warn-text">Each chain needs an ERC-20 asset: launch one on the Assets page.</p>}
      {err && <p role="alert" className="text-sm text-danger">{err.text}</p>}
      <GasFix error={err?.text} on={err?.on} />
      {flash && <Notice tone={flash.tone} action={flash.href && <Link to={flash.href} className="ml-auto font-semibold">View report →</Link>}>{flash.text}</Notice>}
      {st?.phase === 'expiring' && <Notice>A lock of this swap is within 10 blocks of its timeout. Blocks are only a proxy for time across chains: act before the other chain moves on.</Notice>}

      <div inert={disabled} className={`flex flex-col gap-[18px] ${disabled ? 'opacity-45' : ''}`}>
        <div className="flex flex-wrap items-stretch gap-4">
          <ChainColumn role="A" name={nameA} hashLock={lockA === null ? null : lockA?.address} head={headA} locks={opening ? [opening] : []}
            amount={lockAmount} who={who} deploy={deployProps(chain, 'A')} mine={mineProps('A')} />
          {chainB && <ChainColumn role="B" name={nameB} hashLock={lockB === null ? null : lockB?.address} head={headB} locks={answer ? [answer] : []}
            amount={lockAmount} who={who} deploy={deployProps(chainB, 'B')} mine={mineProps('B')} />}
        </div>

        <div className="flex flex-wrap items-stretch gap-4">
          {base && quote && lockA && lockB && chainB && (
            <MakeLock base={base} quote={quote} chainA={nameA} chainB={nameB} headA={headA} takers={others} funds={walletA} busy={working || !acting}
              onApprove={n => void send(chain, approve(base.address as Address, lockA.address, n), `HashLock may now spend ${amountText(n, base.decimals)} ${base.symbol}.`)}
              onLock={make} />
          )}
          {opening && actions.includes('accept') && (
            <AcceptPanel opening={opening} chainA={nameA} chainB={nameB} headA={headA} headB={headB} amtB={copy.amtB} quote={copy.quote} funds={walletB}
              asset={wantTok} on={chainB} busy={working}
              onApprove={() => void send(chainB!, approve(opening.wantToken, opening.wantLock, opening.wantAmount), `HashLock on ${nameB} may now spend ${copy.amtB} ${copy.quote}.`)}
              onLock={accept} />
          )}
          {opening && <ClaimRefund role={role} actions={actions.filter(a => a !== 'accept')} copy={copy} secret={secret} busy={working} onAction={act} />}
        </div>

        <div className="flex flex-wrap items-start gap-4">
          <SwapTimeline opening={opening} answer={answer} chainName={id => chainLabel(id, chains)} who={who} amount={lockAmount} reportHref={reportHref} />
          <IncomingLocks locks={incoming} chains={chains} selected={hash} amount={lockAmount} want={wantAmount} who={who} onPick={pick} />
          <MySwaps rows={mine.map(l => ({ lock: l, role: roleOf(l, acting?.address)! }))} chains={chains} selected={hash} amount={lockAmount} want={wantAmount} onPick={pick} />
        </div>
      </div>
    </div>
  )
}

/** AcceptLock with its "Request tokens" fix on chain B (the hook needs the token's Asset there). */
function AcceptPanel({ asset, on, ...p }: Parameters<typeof AcceptLock>[0] & { asset?: Asset; on?: ChainHandle }) {
  const { bal } = p.funds, need = p.opening.wantAmount
  const fix = useRequestFix(asset, bal !== undefined && bal < need ? need : 0n, bal ?? 0n, on)
  return <AcceptLock {...p} fix={fix} />
}

