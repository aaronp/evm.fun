import { decodeEventLog, decodeFunctionData, encodeEventTopics, getAddress, isAddress, parseAbi, toHex, type Address, type Hash, type Hex } from 'viem'
import type { Request } from '@evmb/assets'
import { swapAbi } from './abi'
import { decodeSwapError } from './errors'
import { readOffer, statusName } from './read'
import type { Offer } from './types'

/**
 * Report copy is data: names, symbols and amounts stay as placeholders for the page to fill (see `fillText`):
 * `{name:<address>}`, `{symbol:<token>}`, `{amount:<token>:<raw>}`, `{price:<giveToken>:<giveAmt>:<getToken>:<getAmt>}`
 * (the price is getAmt per giveAmt, i.e. "{getSym} per {giveSym}").
 */
export type ReportStep = { title: string; body: string; evidence: string; ok: boolean; mark: 'ok' | 'fail' | 'skip' | 'undo'; detail?: string }
export type Reason = 'allowance' | 'balance' | 'filled' | 'cancelled' | 'other'
export type TakeReport = {
  outcome: 'taken' | 'reverted'; tx: Hash; block: bigint; txIndex: number; gasUsed: bigint; swap: Address; offer: Offer; taker: Address
  error?: { name: string; args: Record<string, unknown>; raw?: Hex }
  reason?: Reason
  winner?: { taker?: Address; block: bigint; tx: Hash; sameBlock: boolean }
  title: string; pill: string; summary: string; kpis: { label: string; value: string; sub: string }[]
  steps: ReportStep[]; fix?: { text: string; label?: string }
  balanceChanges: { holder: Address; token: Address; delta: bigint }[]; balanceNote: string
  logs: string[]; reconstructedNow?: boolean
}
export type Fmt = {
  name(a: Address): string; symbol(token: Address): string; amount(raw: bigint, token: Address): string
  price(giveToken: Address, giveAmt: bigint, getToken: Address, getAmt: bigint): string
}

/** Replaces the report's placeholders with the page's names and formatted amounts. */
export const fillText = (text: string, f: Fmt) =>
  text.replace(/\{(name|symbol|amount|price):([^}]+)\}/g, (_, k: string, a: string) => {
    const p = a.split(':')
    if (k === 'name') return f.name(p[0] as Address)
    if (k === 'symbol') return f.symbol(p[0] as Address)
    if (k === 'amount') return f.amount(BigInt(p[1]!), p[0] as Address)
    return f.price(p[0] as Address, BigInt(p[1]!), p[2] as Address, BigInt(p[3]!))
  })

type At = { block: bigint; txIndex: number }
/** a was ordered before b on chain */
export const precedes = (a: At, b: At) => a.block < b.block || (a.block === b.block && a.txIndex < b.txIndex)

export type RpcLog = { address: Address; topics: [Hex, ...Hex[]]; data: Hex; blockNumber: Hex; transactionHash: Hash; transactionIndex: Hex; logIndex: Hex }
export const erc20Events = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
])
export const logAt = (l: RpcLog): At => ({ block: BigInt(l.blockNumber), txIndex: Number(l.transactionIndex) })

const N = (a: Address) => `{name:${a}}`
const S = (t: Address) => `{symbol:${t}}`
const A = (t: Address, v: bigint) => `{amount:${t}:${v}}`
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

/** Revert data of `tx` replayed at `block`; undefined when it doesn't revert; 'unsupported' when the node refuses. */
async function replay(request: Request, call: object, block: string): Promise<Hex | undefined | 'unsupported'> {
  try {
    await request('eth_call', [call, block])
    return undefined
  } catch (e: any) {
    const d = e?.data ?? e?.cause?.data ?? e?.error?.data
    return typeof d === 'string' ? (d as Hex) : 'unsupported'
  }
}

/** The execution report of a `take(id)` tx, success or revert, derived from the chain only. */
export async function takeReport(request: Request, txHash: Hash): Promise<TakeReport> {
  const tx = (await request('eth_getTransactionByHash', [txHash])) as { from: Address; to: Address | null; input: Hex; gas: Hex } | null
  if (!tx) throw new Error('Transaction not found')
  let id: bigint
  try {
    const d = decodeFunctionData({ abi: swapAbi, data: tx.input })
    if (d.functionName !== 'take' || !tx.to) throw 0
    id = d.args[0]
  } catch {
    throw new Error('Not a Swap take')
  }
  const rc = (await request('eth_getTransactionReceipt', [txHash])) as
    { status: Hex; blockNumber: Hex; transactionIndex: Hex; gasUsed: Hex; logs: RpcLog[] } | null
  if (!rc) throw new Error('Transaction not mined yet')
  const swap = getAddress(tx.to!), taker = getAddress(tx.from)
  const at = { block: BigInt(rc.blockNumber), txIndex: Number(rc.transactionIndex) }
  const offer = await readOffer(request, swap, id)
  const base = { tx: txHash, ...at, gasUsed: BigInt(rc.gasUsed), swap, offer, taker }
  const { maker, giveToken, giveAmt, getToken, getAmt } = offer
  const give = A(giveToken, giveAmt), get = A(getToken, getAmt), getSym = S(getToken), gas = String(base.gasUsed)
  const step = (mark: ReportStep['mark'], title: string, evidence: string, body: string, detail?: string): ReportStep =>
    ({ title, body, evidence, ok: mark === 'ok', mark, ...(detail !== undefined && { detail }) })
  const made = step('ok', `Offer #${id} made`, 'earlier · OfferMade', `${N(maker)} escrowed ${give} in Swap; asks ${get}.`)
  const sent = (body: string) => step('ok', `take(${id}) sent by ${N(taker)}`, `block ${at.block}`, body)

  if (rc.status === '0x1') {
    const balanceChanges: TakeReport['balanceChanges'] = []
    const bump = (holder: Address, token: Address, delta: bigint) => {
      const b = balanceChanges.find(x => x.holder === holder && x.token === token)
      b ? (b.delta += delta) : balanceChanges.push({ holder, token, delta })
    }
    const logs = rc.logs.map(l => {
      try {
        const e = decodeEventLog({ abi: erc20Events, ...l })
        if (e.eventName === 'Transfer') {
          const token = getAddress(l.address)
          bump(getAddress(e.args.from), token, -e.args.value)
          bump(getAddress(e.args.to), token, e.args.value)
          return `Transfer ${N(getAddress(e.args.from))} → ${N(getAddress(e.args.to))} ${A(token, e.args.value)}`
        }
      } catch {}
      try {
        const e = decodeEventLog({ abi: swapAbi, ...l })
        if (e.eventName === 'OfferTaken') return `OfferTaken(id: ${e.args.id}, taker: ${N(getAddress(e.args.taker))})`
      } catch {}
      return `log ${l.address} ${l.topics[0]}`
    })
    return {
      ...base, outcome: 'taken',
      title: `Offer #${id} taken`, pill: 'Settled · 1 transaction',
      summary: `${N(taker)} paid ${get} and received ${give} from escrow, atomically in one transaction.`,
      kpis: [
        { label: 'You paid', value: get, sub: `to ${N(maker)}` },
        { label: 'You received', value: give, sub: 'from escrow' },
        { label: 'Price', value: `{price:${giveToken}:${giveAmt}:${getToken}:${getAmt}}`, sub: `${getSym} per ${S(giveToken)}` },
        { label: 'Gas', value: gas, sub: 'one transaction' },
      ],
      steps: [made, sent('Swap checks the offer is still open.'),
        step('ok', `Pay leg · ${get}`, 'transferFrom', `${N(taker)} → ${N(maker)}, using ${N(taker)}’s ${getSym} allowance to Swap.`),
        step('ok', `Deliver leg · ${give}`, 'transfer', `Swap escrow → ${N(taker)}.`),
        step('ok', 'Offer closed', 'OfferTaken', `Offer #${id} marked filled in the same transaction.`)],
      balanceChanges, balanceNote: `${N(maker)}’s ${give} left their wallet when the offer was made, not now.`, logs,
    }
  }

  // Reverted. Status changes come from logs (they see same-block ordering); otherwise replay the call.
  let error: TakeReport['error'], winner: TakeReport['winner'], reconstructedNow: true | undefined
  const [taken, cancelled] = (['OfferTaken', 'OfferCancelled'] as const).map(eventName => encodeEventTopics({ abi: swapAbi, eventName })[0]!)
  const status = (await request('eth_getLogs', [{
    address: swap, fromBlock: '0x0', toBlock: toHex(at.block), topics: [[taken, cancelled], toHex(id, { size: 32 })],
  }])) as RpcLog[]
  const prior = status.find(l => precedes(logAt(l), at))
  if (prior) {
    const wasTaken = prior.topics[0] === taken
    error = { name: 'OfferNotOpen', args: { id, status: wasTaken ? 2 : 3 } }
    winner = {
      ...(wasTaken && { taker: getAddress(`0x${prior.topics[2]!.slice(26)}`) }),
      block: BigInt(prior.blockNumber), tx: prior.transactionHash, sameBlock: BigInt(prior.blockNumber) === at.block,
    }
  } else {
    const call = { from: tx.from, to: tx.to, data: tx.input, gas: tx.gas }
    let raw = await replay(request, call, toHex(at.block - 1n))
    if (raw === 'unsupported') {
      reconstructedNow = true
      raw = await replay(request, call, 'latest')
      if (raw === 'unsupported') raw = undefined
    }
    if (raw !== undefined) error = { ...(decodeSwapError(raw) ?? { name: 'Unknown', args: {} }), raw }
  }
  const reason: Reason =
    error?.name === 'ERC20InsufficientAllowance' ? 'allowance'
    : error?.name === 'ERC20InsufficientBalance' ? 'balance'
    : error?.name === 'OfferNotOpen' && ['filled', 'cancelled'].includes(statusName(error.args.status as number))
      ? (statusName(error.args.status as number) as 'filled' | 'cancelled')
    : 'other'

  const val = (k: string, v: unknown) =>
    k === 'status' && error?.name === 'OfferNotOpen' ? cap(statusName(v as number))
    : typeof v === 'string' && isAddress(v) ? N(getAddress(v))
    : typeof v === 'bigint' && ['allowance', 'balance', 'needed'].includes(k) ? A(getToken, v)
    : String(v)
  const detail = error && (error.name === 'Unknown' ? error.raw! : (() => {
    const ks = Object.keys(error.args), w = Math.max(0, ...ks.map(k => k.length)) + 2
    return ks.length ? `${error.name}(\n${ks.map(k => `  ${`${k}:`.padEnd(w)}${val(k, error!.args[k])}`).join(',\n')}\n)` : `${error.name}()`
  })())
  const needed = A(getToken, (error?.args.needed as bigint | undefined) ?? getAmt)
  const paid = { label: 'Paid', value: A(getToken, 0n), sub: 'reverted' }, gasK = { label: 'Gas', value: gas, sub: 'spent on revert' }
  const rolled = (body: string) => step('undo', 'Rolled back', 'status 0', body)
  const wb = winner && (winner.sameBlock ? `earlier in block ${winner.block}` : `block ${winner.block}`)
  const when = winner ? (winner.sameBlock ? ' earlier in the same block' : ` in block ${winner.block}`) : ''
  const failedTake = step('fail', `take(${id}) by ${N(taker)} reverted`, `block ${at.block}`, 'Swap rejects offers that are no longer open.', detail)
  const notOpenTail = [step('skip', 'Pay & deliver legs', 'not attempted', 'Checked before any tokens move.'),
    rolled(`${N(taker)}’s balances are unchanged; only gas was spent.`)]
  const another = { text: 'Offers fill whole and only once. Pick another offer from the book, or make your own at this price.', label: 'Choose another offer' }

  const copy: Pick<TakeReport, 'pill' | 'summary' | 'kpis' | 'steps' | 'fix'> =
    reason === 'allowance' || reason === 'balance' ? {
      pill: `Reverted · ${reason}`,
      summary: reason === 'allowance'
        ? `Swap wasn’t allowed to spend ${N(taker)}’s ${getSym}, so the whole transaction rolled back. The offer is still there to take.`
        : `${N(taker)} didn’t hold enough ${getSym}, so the whole transaction rolled back. The offer is still there to take.`,
      kpis: [paid, reason === 'allowance'
        ? { label: 'Allowance', value: A(getToken, error!.args.allowance as bigint), sub: 'Swap may spend' }
        : { label: 'Balance', value: A(getToken, error!.args.balance as bigint), sub: `${N(taker)} holds` },
        { label: 'Needed', value: needed, sub: `to take #${id}` }, gasK],
      steps: [made, sent('Offer is open.'),
        step('fail', 'Pay leg reverted', 'transferFrom', `Swap could not pull ${getSym} from ${N(taker)}.`, detail),
        step('skip', 'Deliver leg', 'not attempted', 'Execution stopped at the revert.'),
        rolled(`Nothing moved. Offer #${id} is still open and the ${give} is still in escrow.`)],
      fix: reason === 'allowance'
        ? { text: `Approve Swap to spend at least ${needed} from ${N(taker)}, then take the offer again. It is still open at the same price.`, label: `Approve ${needed}` }
        : { text: `Get at least ${needed} into ${N(taker)}’s wallet, then take the offer again. It is still open at the same price.` },
    }
    : reason === 'filled' ? {
      pill: 'Reverted · already taken',
      summary: `Another taker filled offer #${id}${when}. Swap checked first, so nothing moved.`,
      kpis: [paid, { label: `Offer #${id}`, value: 'Filled', sub: 'by another taker' }, { label: 'Checked', value: 'before transfer', sub: 'no tokens touched' }, gasK],
      steps: [made, ...(winner ? [step('ok', `Someone else took #${id} first`, wb!, `Another take(${id}) was ordered ahead of this one.`)] : []), failedTake, ...notOpenTail],
      fix: another,
    }
    : reason === 'cancelled' ? {
      pill: 'Reverted · cancelled',
      summary: `The maker cancelled offer #${id}${when}. Swap checked first, so nothing moved.`,
      kpis: [paid, { label: `Offer #${id}`, value: 'Cancelled', sub: 'by the maker' }, { label: 'Checked', value: 'before transfer', sub: 'no tokens touched' }, gasK],
      steps: [made, ...(winner ? [step('ok', `${N(maker)} cancelled #${id}`, wb!, `OfferCancelled(${id}) was ordered ahead of this take.`)] : []), failedTake, ...notOpenTail],
      fix: { ...another, text: 'The maker withdrew this offer. Pick another offer from the book, or make your own at this price.' },
    }
    : {
      pill: 'Reverted',
      summary: 'The transaction reverted, so nothing moved.',
      kpis: [paid, { label: 'Error', value: error?.name ?? 'none', sub: error ? 'see On-chain record' : 'no revert data' }, gasK],
      steps: [made, step('fail', `take(${id}) by ${N(taker)} reverted`, `block ${at.block}`, 'Swap reverted the transaction.', detail),
        rolled('Nothing moved; only gas was spent.')],
    }
  const revertLine = !error ? 'revert (no data)'
    : error.name === 'OfferNotOpen' ? `revert OfferNotOpen(${id}, ${cap(statusName(error.args.status as number))})`
    : error.name === 'Unknown' ? `revert ${error.raw}` : `revert ${error.name}`
  return {
    ...base, outcome: 'reverted', title: `Take #${id} failed`, ...copy,
    ...(error && { error }), reason, ...(winner && { winner }), ...(reconstructedNow && { reconstructedNow }),
    balanceChanges: [], balanceNote: 'A revert undoes every change in the transaction.',
    logs: [revertLine, '(no events — tx reverted)'],
  }
}
