import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { decodeFunctionData, parseEventLogs, toHex, type Address, type Hash, type Hex } from 'viem'
import type { Asset, Request } from '@evmb/assets'
import { fillText } from '@evmb/swap'
import { decodeHtlcError, hashLockAbi, swapReport, type HtlcError, type SwapReport } from '@evmb/htlc'
import { useApp } from '../state'
import { useAppBar } from '../state/appBar'
import type { ChainHandle } from '../chain/handle'
import { registry } from '../chain/revm'
import { accounts as accountStore } from '../store/accounts'
import { assetRegistry } from '../assets/registry'
import { shortAddress } from '../assets/ui'
import { safeBack } from '../links'
import { sidesFor } from '../htlc/locate'
import { answers } from '../htlc/secrets'
import { chainLabel } from '../htlc/ui'
import { amountText, reportFmt, same } from '../swap/ui'
import { card } from '../components/TakePanel'
import { downloadJson, ReportView, type Step } from '../components/ReportView'
import { Notice } from '../ui/notice'
import { DownloadIcon } from '../ui/icons'

type People = { label: string; address: string }[]
type Chains = { id: string; name: string }[]
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

// ---------- one transaction: /xswap/report?tx=&chain= ----------

export type TxReport = {
  tx: Hash; block: bigint; ok: boolean; from: Address; to?: Address
  action: 'lock' | 'claim' | 'refund' | 'other'; id?: bigint; token?: Address
  error?: HtlcError & { raw: Hex }
  /** the HashLock events it emitted, as text (a claim's secret is left out) */
  logs: string[]
}

type RpcTx = { from: Address; to: Address | null; input: Hex; gas: Hex; blockNumber: Hex }
type RpcReceipt = { status: Hex; logs: Parameters<typeof parseEventLogs>[0]['logs'] }

/** Replays the call at the tx's own block (block.number then matches the timeout checks); `latest` when that state is gone. */
async function replay(request: Request, call: object, block: bigint): Promise<Hex | undefined> {
  for (const at of [toHex(block), 'latest']) {
    try { await request('eth_call', [call, at]); return } catch (e: any) {
      const d = e?.data ?? e?.cause?.data ?? e?.error?.data
      if (typeof d === 'string') return d as Hex
      if (!/historical state not available/i.test(String(e?.message ?? e))) return
    }
  }
}

/** A HashLock lock/claim/refund tx's report, from the chain: what it did, or the decoded revert with its fix copy
 * (`chain`: the chain's name for "Advance {chain} n blocks", measured from its head now). */
export async function loadTxReport(request: Request, tx: Hash, chain: string): Promise<TxReport> {
  const [t, rc] = await Promise.all([request('eth_getTransactionByHash', [tx]), request('eth_getTransactionReceipt', [tx])]) as [RpcTx | null, RpcReceipt | null]
  if (!t || !rc) throw new Error('Transaction not found')
  const block = BigInt(t.blockNumber), ok = BigInt(rc.status) === 1n
  let action: TxReport['action'] = 'other', id: bigint | undefined, token: Address | undefined
  try {
    const d = decodeFunctionData({ abi: hashLockAbi, data: t.input })
    if (d.functionName === 'lock') { action = 'lock'; token = d.args[0] }
    if (d.functionName === 'claim' || d.functionName === 'refund') { action = d.functionName; id = d.args[0] }
  } catch { /* not a HashLock call */ }
  const events = parseEventLogs({ abi: hashLockAbi, logs: rc.logs })
  const locked = events.find(e => e.eventName === 'Locked')
  if (locked?.eventName === 'Locked') id = locked.args.id
  const logs = events.map(e => e.eventName === 'Locked'
    ? `Locked #${e.args.id} · {amount:${e.args.token}:${e.args.amount}} to {name:${e.args.recipient}} · timeout block ${e.args.timeoutBlock}`
    : `${e.eventName} #${(e.args as { id: bigint }).id}`)
  let error: TxReport['error']
  if (!ok) {
    const raw = await replay(request, { from: t.from, to: t.to, data: t.input, gas: t.gas }, block)
    const d = raw && decodeHtlcError(raw, { chain, head: BigInt((await request('eth_blockNumber', [])) as string), token })
    if (raw) error = { ...(d ?? { name: 'Unknown', args: {}, fix: 'The revert could not be decoded.' }), raw }
  }
  return { tx, block, ok, from: t.from, ...(t.to && { to: t.to }), action, ...(id !== undefined && { id }), ...(token && { token }), ...(error && { error }), logs }
}

export function TxReportView({ r, chainName, people, assets, back = '/xswap' }: { r: TxReport; chainName: string; people: People; assets: Asset[]; back?: string }) {
  const f = reportFmt(Object.fromEntries(people.map(p => [p.address, p.label])), assets)
  const fill = (s: string) => fillText(s, f)
  const what = r.action === 'other' ? 'Transaction' : `${cap(r.action)}${r.id !== undefined ? ` #${r.id}` : ''}`
  const title = `${what} ${r.ok ? 'succeeded' : 'failed'}`
  const fix = r.error ? fill(r.error.fix) : 'The transaction reverted and the reason could not be read back.'
  const args = r.error && Object.entries(r.error.args).map(([k, v]) => `${k}: ${String(v)}`).join(', ')
  const steps: Step[] = [{
    mark: r.ok ? 'ok' : 'fail', title: `${f.name(r.from)} sent ${r.action === 'other' ? 'a transaction' : `${r.action}`} on ${chainName}`,
    body: r.ok ? (r.logs.length ? r.logs.map(fill).join(' · ') : 'No HashLock events.') : fix,
    evidence: `block ${r.block}`, ...(r.error && { detail: `revert ${r.error.name}(${args})` }),
  }]
  return (
    <ReportView ok={r.ok} title={title} pill={r.ok ? 'Success' : `Reverted · ${r.error?.name ?? 'unknown'}`}
      summary={r.ok ? `${what} was mined in block ${r.block} on ${chainName}.` : fix}
      meta={[`${chainName} · block ${r.block}`, `From ${f.name(r.from)}`]} kpis={[]} steps={steps}
      fix={r.ok ? undefined : { text: fix, back: { label: 'Back to cross-chain swap', to: back } }}
      record={{ tx: r.tx, ok: r.ok, logs: r.logs.map(fill) }} />
  )
}

// ---------- one swap: /xswap/report?hash=&chain=&chainB= ----------

const OK = new Set(['completed', 'refunded (maker)', 'refunded (taker)', 'refunded (both)'])
const TITLE: Record<string, string> = {
  completed: 'Cross-chain swap completed', 'taker lost': 'The taker lost', 'maker lost': 'The maker lost', stuck: 'Cross-chain swap still locked',
}

/** The swap's report, built only from `swapReport`. `assets`: both chains' tokens (an address can repeat across chains). */
export function XSwapReportView({ r, chains, people, assets }: { r: SwapReport; chains: Chains; people: People; assets: Asset[] }) {
  const name = (a: string) => people.find(p => same(p.address, a))?.label ?? shortAddress(a)
  const cn = (id: string) => chainLabel(id, chains)
  const tok = (chain: string, a: string) => assets.find(t => t.chainId === chain && same(t.address, a))
  const amt = (chain: string, v: string | bigint, a: string) => { const t = tok(chain, a); return t ? `${amountText(BigInt(v), t.decimals)} ${t.symbol}` : `${v} ${shortAddress(a)}` }
  const o = r.opening, an = r.answer
  const give = amt(r.chainA, o.amount, o.token), want = an ? amt(an.chain, an.amount, an.token) : amt(o.wantChain, o.wantAmount, o.wantToken)
  const maker = name(o.sender), taker = name(o.recipient), A = cn(r.chainA), B = cn(o.wantChain)
  const summary = {
    completed: `${maker} swapped ${give} on ${A} for ${want} on ${B} with ${taker}.`,
    'refunded (maker)': `Nobody answered; ${maker} got ${give} back on ${A}.`,
    'refunded (taker)': `${taker} got ${want} back on ${B}.`,
    'refunded (both)': `Both locks timed out; ${maker} got ${give} back on ${A} and ${taker} got ${want} back on ${B}.`,
    'taker lost': `${maker} claimed ${want} on ${B} and refunded ${give} on ${A}: ${taker} locked too late or claimed too late.`,
    'maker lost': `${taker} claimed ${give} on ${A} and refunded ${want} on ${B}.`,
    stuck: r.stillLocked.map(l => `#${l.id} on ${cn(l.chain)} is claimable before, and refundable from, block ${l.timeoutBlock}.`).join(' '),
  }[r.outcome]
  const steps: Step[] = r.steps.map(s => {
    const l = s.chain === r.chainA ? o : an!
    return {
      mark: s.action === 'refund' ? 'undo' : 'ok',
      title: `${s.side === 'maker' ? maker : taker} ${s.action === 'lock' ? 'locked' : s.action === 'claim' ? 'claimed' : 'refunded'} #${s.id} on ${cn(s.chain)}`,
      body: `${amt(s.chain, l.amount, l.token)}${s.action === 'lock' ? ` · timeout block ${l.timeoutBlock}` : ''}`,
      evidence: `block ${s.block} · ${shortAddress(s.tx)}`,
    }
  })
  const delta = (v: bigint) => (v > 0n ? ['+', 'text-success'] : v < 0n ? ['−', 'text-danger'] : ['', 'text-muted'])
  return (
    <ReportView ok={OK.has(r.outcome)} title={TITLE[r.outcome] ?? 'Cross-chain swap refunded'} pill={`${r.outcome}${r.unsafe ? ' · unsafe timeouts' : ''}`}
      summary={summary} meta={[`Hash ${shortAddress(r.hash)}`, `${A} ⇄ ${B}`]}
      notice={r.unsafe ? `Unsafe timeouts: the taker’s lock did not end at least 10 blocks before the maker’s, so the maker could claim on ${B} after the taker could still claim on ${A}.` : undefined}
      kpis={[
        { label: 'Outcome', value: r.outcome, sub: r.unsafe ? 'unsafe timeouts' : 'timeouts checked', tone: OK.has(r.outcome) ? 'text-success' : 'text-danger' },
        { label: `Maker locks on ${A}`, value: give, sub: `#${o.id} · ${o.status}`, tone: 'text-text' },
        { label: `Taker locks on ${B}`, value: want, sub: an ? `#${an.id} · ${an.status}` : 'not answered', tone: 'text-text' },
        { label: 'Secret', value: r.secret ? 'revealed' : 'hidden', sub: r.secret ? `by the claim on ${B}` : 'until the maker claims', tone: 'text-text' },
      ]}
      steps={steps}
      aside={<>
        <section aria-labelledby="bc-h" className={`${card} flex flex-col gap-3 p-5`}>
          <h2 id="bc-h" className="text-[15px] font-semibold">Balance changes</h2>
          {r.balanceChanges.map(b => {
            const v = BigInt(b.delta), [sign, tone] = delta(v), t = tok(b.chain, b.token)
            const holder = same(b.holder, b.chain === r.chainA ? o.address : an?.address) ? 'HashLock' : name(b.holder)
            return (
              <div key={b.chain + b.holder + b.token} className="flex justify-between gap-2.5 text-[13px]">
                <span>{cn(b.chain)} · {holder} · {t?.symbol ?? shortAddress(b.token)}</span>
                <span className={`font-mono ${tone}`}>{sign}{t ? amountText(v < 0n ? -v : v, t.decimals) : String(v < 0n ? -v : v)}</span>
              </div>
            )
          })}
          {!r.balanceChanges.length && <span className="text-xs text-muted">Every lock was refunded: no balance changed.</span>}
        </section>
        {r.secret && (
          <section aria-labelledby="sc-h" className={`${card} flex flex-col gap-2 p-5`}>
            <h2 id="sc-h" className="text-[15px] font-semibold">Secret</h2>
            <span className="break-all font-mono text-xs text-text-2">{r.secret}</span>
            <span className="text-xs text-muted">Public since the claim on {B}.</span>
          </section>
        )}
      </>}
    />
  )
}

/** Both chains' handles and tokens for a swap report; chain B is opened when this browser has it. */
async function loadSwap(a: ChainHandle, bId: string | null, hash: Hex): Promise<{ report: SwapReport; assets: Asset[] }> {
  const b = bId && bId !== a.info.id && (await registry.list()).some(c => c.id === bId) ? await registry.open(bId) : undefined
  const sides = await sidesFor(a, b, hash)
  if (!sides.a) throw new Error('no HashLock on this chain')
  const at = await answers.get(hash)
  const report = await swapReport(sides.a, sides.b, hash, at ? { headAAtAnswer: BigInt(at) } : {})
  return { report, assets: [...await assetRegistry.list(a.info.id), ...(b ? await assetRegistry.list(b.info.id) : [])] }
}

/** Where the "Cross-chain swap" crumb goes: a tx report's `back` (the swap, its chain B and hash, as the fix link), else the swap by hash. */
export function crumbTo(params: URLSearchParams): string {
  const back = params.get('tx') ? safeBack(params.get('back')) : undefined
  const hash = params.get('hash'), chainB = params.get('chainB')
  return back ?? (hash ? `/xswap?hash=${hash}${chainB ? `&chainB=${chainB}` : ''}` : '/xswap')
}

type Got = { tx: TxReport; assets: Asset[] } | { swap: SwapReport; assets: Asset[] } | { error: string }

/** `/xswap/report?tx=&chain=` (one transaction) or `?hash=&chain=&chainB=` (the swap), read from the chains each time. */
export function XSwapReport() {
  const { chain, chains } = useApp()
  const [params] = useSearchParams()
  const tx = params.get('tx') as Hash | null, hash = params.get('hash') as Hex | null, chainB = params.get('chainB')
  const people = accountStore.list()
  const [got, setGot] = useState<Got>()
  useEffect(() => {
    setGot(undefined)
    if (!chain || (!tx && !hash)) return
    let live = true
    const load: Promise<Got> = tx
      ? Promise.all([loadTxReport(chain.request, tx, chain.info.name), assetRegistry.list(chain.info.id)]).then(([t, assets]) => ({ tx: t, assets }))
      : loadSwap(chain, chainB, hash!).then(s => ({ swap: s.report, assets: s.assets }))
    load.then(g => live && setGot(g), e => live && setGot({ error: msg(e) }))
    return () => { live = false }
  }, [chain, tx, hash, chainB])

  const leaf = tx ? 'Transaction report' : 'Swap report'
  useAppBar({
    title: leaf,
    crumbs: [{ label: 'Cross-chain swap', to: crumbTo(params) }, { label: leaf }],
    actions: got && 'swap' in got ? [{
      kind: 'button', id: 'json', label: 'Download JSON', text: true, icon: <DownloadIcon />,
      onClick: () => downloadJson(`xswap-report-${got.swap.hash.slice(0, 10)}.json`, JSON.stringify(got.swap, null, 2)),
    }] : undefined,
  })

  if (!chain) return <p className="text-sm text-muted">Select a chain first.</p>
  if (!tx && !hash) return <Notice>No transaction or swap given.</Notice>
  if (!got) return <p className="text-sm text-muted">Reading the report from {chain.info.name}…</p>
  if ('error' in got) return <Notice tone="danger">{`No report for ${shortAddress((tx ?? hash)!)} on ${chain.info.name}: ${got.error}.`}</Notice>
  return 'tx' in got
    ? <TxReportView r={got.tx} chainName={chain.info.name} people={people} assets={got.assets} back={safeBack(params.get('back'))} />
    : <XSwapReportView r={got.swap} chains={chains} people={people} assets={got.assets} />
}

