import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Address } from 'viem'
import { balances as readBalances, readTokenInfo, totalSupply, type Asset } from '@evmb/assets'
import { useApp } from '../state'
import { useAppBar } from '../state/appBar'
import { accounts as accountStore, type Account } from '../store/accounts'
import { contractsRegistry } from '../contracts/registry'
import { assetRegistry } from '../assets/registry'
import { reconcileAssets } from '../assets/build'
import { badgeTone, formatAmount, glyphFor, issuerText, shares, shortAddress } from '../assets/ui'
import { AllowancesCard } from '../components/AllowancesCard'
import { ImportTokenDialog } from '../components/ImportTokenDialog'
import { LaunchAssetDialog } from '../components/LaunchAssetDialog'
import { SendDialog } from '../components/SendDialog'
import { Button } from '../ui/button'
import { InfoIcon, PlusIcon } from '../ui/icons'
import { useWizardAction } from '../walkthrough/wizard'
import { linkedSend } from '../fix'
import { pushNotice } from '../notice'

const NATIVE_DP = 8
const kindText = (a: Asset) => (a.kind === 'native' ? 'Native' : `ERC-20${a.mintable ? ' · Mintable' : ''}`)
const label = 'text-[11px] font-medium uppercase tracking-[0.08em] text-faint'
const card = 'rounded-2xl border border-line-strong bg-surface'

function Glyph({ a, size }: { a: Asset; size: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      className={`flex shrink-0 items-center justify-center rounded-full font-display font-semibold ${badgeTone(a.id)}`}>{glyphFor(a.symbol)}</span>
  )
}

export function Assets() {
  const { chain, account, balanceTick, bumpBalance } = useApp()
  const [params, setParams] = useSearchParams()
  const [assets, setAssets] = useState<Asset[]>([])
  const [listErr, setListErr] = useState<string>()
  const [supply, setSupply] = useState<bigint>()
  const [bals, setBals] = useState<Map<Address, bigint>>()
  const [sender, setSender] = useState<Account>()
  const [prefill, setPrefill] = useState<ReturnType<typeof linkedSend>>() // the Send a request link opened
  const opened = useRef<string | undefined>(undefined)
  const nav = useNavigate()
  const [dlg, setDlg] = useState<'import' | 'launch'>()
  const reconciled = useRef(new Set<string>())
  const prevId = useRef<string | undefined>(undefined)
  const sendRef = useRef<HTMLDialogElement>(null)
  const people = accountStore.list()
  const chainId = chain?.info.id

  const noWrites = chain?.info.ephemeral ? 'Benchmark chains keep no asset records' : undefined
  useAppBar({
    title: 'Assets',
    crumbs: chain ? [{ label: chain.info.name, to: '/chains' }, { label: 'Assets' }] : undefined,
    actions: [
      { kind: 'button', id: 'import', label: 'Import token by address', icon: null, text: true, title: noWrites ?? (chain ? undefined : 'Select a chain first'), disabled: !chain || !!noWrites, onClick: () => setDlg('import') },
      { kind: 'button', id: 'launch', label: 'Launch asset', icon: <PlusIcon width={14} height={14} />, text: true, primary: true, title: noWrites ?? (chain ? undefined : 'Select a chain first'), disabled: !chain || !!noWrites, onClick: () => setDlg('launch'), wizard: 'assets.launch' },
    ],
  })

  useWizardAction('assets.launch', chain && !noWrites ? () => setDlg('launch') : undefined)

  // Reload the list, first adopting already-deployed tokens once per chain per mount (never on benchmark chains).
  useEffect(() => {
    if (prevId.current !== chainId) setAssets([]) // never act on the previous chain's tokens while the new list loads
    prevId.current = chainId
    setListErr(undefined)
    if (!chain || !chainId) return
    let live = true
    ;(async () => {
      if (!chain.info.ephemeral && !reconciled.current.has(chainId)) {
        reconciled.current.add(chainId)
        await reconcileAssets(chainId, await contractsRegistry.list(chainId), assetRegistry, addr => readTokenInfo(chain.request, addr))
      }
      const list = await assetRegistry.list(chainId)
      if (live) setAssets(list)
    })().catch(e => live && setListErr(e instanceof Error ? e.message : String(e)))
    return () => { live = false }
  }, [chain, chainId])

  const mine = assets.filter(a => a.chainId === chainId)
  const cur = mine.find(a => a.id === params.get('asset')) ?? mine[0]
  const addrKey = people.map(p => p.address).join()
  const acting = people.find(p => p.address.toLowerCase() === account?.toLowerCase())
  // a walkthrough's transfer: Send from the acting account (the ribbon selected the step's `from`)
  useWizardAction('assets.send', chain && cur && acting && !sender ? () => setSender(acting) : undefined)

  useEffect(() => { setSupply(undefined); setBals(undefined) }, [chainId, cur?.id]) // a tick refresh keeps the old values until the new ones land

  useEffect(() => {
    if (!chain || !cur) return
    let live = true
    totalSupply(chain.request, cur).then(v => live && setSupply(v), () => live && setSupply(undefined))
    readBalances(chain.request, cur, people.map(p => p.address)).then(v => live && setBals(v), () => live && setBals(undefined))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, cur?.id, addrKey, balanceTick])

  useEffect(() => { if (sender) sendRef.current?.showModal() }, [sender])

  // a request link (`?as=&asset=&send=&amount=&back=`): once its asset's balances are read and `as` holds some, open
  // its Send — once per link, so closing it stays closed
  const link = linkedSend(params, people)
  const linkKey = link && [link.from.address, link.asset, link.to, link.amount, link.back].join('|')
  useEffect(() => {
    if (!link || opened.current === linkKey || sender || cur?.id !== link.asset || !bals || !((bals.get(link.from.address) ?? 0n) > 0n)) return
    opened.current = linkKey
    setPrefill(link)
    setSender(link.from)
  }, [linkKey, cur?.id, bals, sender]) // eslint-disable-line react-hooks/exhaustive-deps
  function sent(amount: string, to: string) {
    if (!prefill?.back || !sender || !cur) return
    const asked = to.toLowerCase() === prefill.to.toLowerCase() // the user may have changed the recipient
    pushNotice(asked ? `Received ${amount} ${cur.symbol} from ${sender.label}` : `Sent ${amount} ${cur.symbol} to ${people.find(p => p.address.toLowerCase() === to.toLowerCase())?.label ?? shortAddress(to)}`, 'success')
    nav(prefill.back, { replace: true }) // carries chain and as: the requester's page and persona come back
  }

  async function added(a: Asset) {
    if (chainId) setAssets(await assetRegistry.list(chainId))
    setParams({ asset: a.id }, { replace: true })
  }

  const barShares = useMemo(() => shares(people.map(p => bals?.get(p.address) ?? 0n)), [bals, addrKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!chain) return <p className="text-sm text-muted">Select a chain first.</p>
  if (!cur) return <div className="flex max-w-[260px] flex-col gap-2">{listErr && <p role="alert" className="text-sm text-danger">Couldn’t load assets: {listErr}</p>}</div>

  const dp = cur.kind === 'native' ? NATIVE_DP : undefined
  const native = cur.kind === 'native'
  return (
    <div className="flex flex-wrap items-start gap-5">
      <aside aria-labelledby="al-h" className="flex max-w-[260px] flex-[1_1_220px] flex-col gap-2">
        <h2 id="al-h" className={`${label} mb-1`}>Assets on {chain.info.name} · {mine.length}</h2>
        {mine.map(a => (
          <button key={a.id} aria-pressed={a.id === cur.id} onClick={() => setParams({ asset: a.id }, { replace: true })}
            className={`asset flex w-full items-center gap-3 rounded-xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-accent ${a.id === cur.id ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface hover:border-accent'}`}>
            <Glyph a={a} size={34} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-semibold">{a.symbol}</span>
              <span className="text-xs text-subtle">{kindText(a)}</span>
            </span>
          </button>
        ))}
      </aside>

      <div className="flex min-w-0 flex-[999_1_34rem] flex-col gap-[18px]">
        <section aria-labelledby="as-h" className={`${card} flex flex-wrap items-center gap-[18px] px-6 py-[22px]`}>
          <Glyph a={cur} size={52} />
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <h1 id="as-h" className="font-display text-[26px] font-semibold">{cur.symbol} <span className="text-base font-medium text-subtle">{cur.name}</span></h1>
            <span className="font-mono text-xs text-subtle">{native ? 'native — no contract' : cur.address}</span>
          </div>
          <dl className="grid grid-cols-[repeat(3,auto)] gap-x-7 gap-y-1 text-[13px]">
            <dt className="text-subtle">Total supply</dt><dt className="text-subtle">Decimals</dt><dt className="text-subtle">Issuer</dt>
            <dd className="font-mono">{supply === undefined ? '—' : formatAmount(supply, cur.decimals)}</dd>
            <dd className="font-mono">{cur.decimals}</dd>
            <dd>{issuerText(cur, people)}</dd>
          </dl>
        </section>

        <section aria-labelledby="bal-h" className={`${card} overflow-hidden`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-[22px] py-4">
            <h2 id="bal-h" className="text-[15px] font-semibold">Balances</h2>
            <span className="text-xs text-subtle">read with <span className="font-mono">{native ? 'eth_getBalance' : 'balanceOf()'}</span> at latest block</span>
          </div>
          {people.length === 0 && <p className="px-[22px] py-4 text-sm text-muted">No accounts yet.</p>}
          {people.map((p, i) => {
            const v = bals?.get(p.address)
            return (
              <div key={p.address} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line px-[22px] py-3.5 last:border-b-0 hover:bg-surface-hover sm:grid-cols-[minmax(140px,1fr)_minmax(0,1.4fr)_180px_auto]">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">{p.label}</span>
                  <span className="font-mono text-[11px] text-subtle">{shortAddress(p.address)}</span>
                </div>
                <span className="order-last col-span-2 h-1.5 overflow-hidden rounded-[3px] bg-line sm:order-none sm:col-span-1">
                  <span className="block h-full bg-accent" style={{ width: `${barShares[i] ?? 0}%` }} />
                </span>
                <span className="text-right font-mono text-sm font-medium">{v === undefined ? '—' : `${formatAmount(v, cur.decimals, dp)} ${cur.symbol}`}</span>
                <Button variant="outline" size="field" aria-label={`Send ${cur.symbol} from ${p.label}`} onClick={() => setSender(p)}>Send</Button>
              </div>
            )
          })}
        </section>

        {!native && <AllowancesCard key={cur.id} chain={chain} asset={cur} people={people} tick={balanceTick} onSent={bumpBalance} />}

        {native && (
          <section className="flex gap-3 rounded-2xl border border-dashed border-input-line bg-surface px-[22px] py-5 text-[13px] leading-[1.55] text-text-2">
            <InfoIcon width={18} height={18} className="mt-px shrink-0 text-accent" />
            <span>ETH is the chain’s native coin, not an ERC-20, so it has no allowances. Contracts receive it as <span className="font-mono">msg.value</span> attached to a call.</span>
          </section>
        )}
      </div>

      {dlg === 'import' && <ImportTokenDialog chain={chain} known={assets} onAdded={added} onClose={() => setDlg(undefined)} />}
      {dlg === 'launch' && <LaunchAssetDialog chain={chain} accounts={people} onLaunched={added} onSent={bumpBalance} onClose={() => setDlg(undefined)} />}
      {sender && <SendDialog dialogRef={sendRef} chain={chain} asset={cur} from={sender} balance={bals?.get(sender.address)} accounts={people}
        to={prefill?.to} amount={prefill?.amount} onSent={bumpBalance} onDone={sent} onClose={() => { setSender(undefined); setPrefill(undefined) }} />}
    </div>
  )
}
