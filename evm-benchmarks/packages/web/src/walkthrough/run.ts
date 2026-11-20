import { erc20Abi, formatUnits, parseEventLogs, type Address } from 'viem'
import { approveCall, type Asset } from '@evmb/assets'
import { makeOfferCall, readOffer, swapAbi, takeCall, takeReport } from '@evmb/swap'
import type { createChainRegistry } from '../chain/registry'
import type { ChainHandle } from '../chain/handle'
import type { Account } from '../store/accounts'
import { parseAmount } from '../assets/ui'
import { exactText } from '../swap/ui'
import { launchToken } from '../assets/launch'
import { deploySwap } from '../swap/locate'
import { readContract, signAndSend } from '../tx/send'
import { amount, ref, uniqueName } from './resolve'
import type { Check, KeyDef, Outputs, Run, Step, StepType, Walkthrough } from './types'

export type ChainRegistry = ReturnType<typeof createChainRegistry>
export type Env = { accounts: { list(): Account[]; create(label: string): Account }; registry: ChainRegistry }
type Out = Outputs[StepType]

export const newRun = (w: Walkthrough): Run => ({ walkthrough: w.id, started: new Date().toISOString(), edited: false, values: {}, steps: {} })

/**
 * A new run with the step's outputs as its key's actual value and the step's entry. `edited` turns on when an input
 * differs from `initial` (default `initialInputs(w, step, run)`; the ribbon passes the values it actually filled).
 */
export function record(
  w: Walkthrough, run: Run, step: Step, outputs: Out, inputs?: Record<string, string>, initial = initialInputs(w, step, run),
): Run {
  const edited = run.edited || (!!inputs && Object.keys(inputs).some(k => inputs[k] !== initial[k]))
  return {
    ...run, edited,
    values: step.key ? { ...run.values, [step.key]: outputs } : run.values,
    steps: { ...run.steps, [step.id]: { inputs: inputs ?? initial, outputs, at: new Date().toISOString() } },
  }
}

const def = <K extends string>(w: Walkthrough, key: string | undefined, kind: K) => (w.keys[key!] as Record<K, any>)[kind]
const arg = (step: Step, name: string) => step.args?.[name] as string
const addr = (run: Run, name: string, stepId: string) => (ref(run, name, stepId) as { address: Address }).address

/**
 * The field values a step starts with, by namespaced field id. `taken`: chain names already in use, so the chain
 * name comes suffixed ("Example 2").
 */
export function initialInputs(w: Walkthrough, step: Step, run: Run, taken: string[] = []): Record<string, string> {
  switch (step.do) {
    case 'account': return { 'account.label': def(w, step.key, 'account').label }
    case 'chain': return { 'chain.name': uniqueName(def(w, step.key, 'chain').name, taken) }
    case 'launchAsset': {
      const a = def(w, step.key, 'asset') as Extract<KeyDef, { asset: unknown }>['asset']
      return { 'launch.name': a.name, 'launch.symbol': a.symbol, 'launch.decimals': String(a.decimals), 'launch.supply': arg(step, 'supply'), 'launch.issuer': addr(run, arg(step, 'issuer'), step.id) }
    }
    case 'makeOffer': {
      const sell = amount(run, arg(step, 'sell'), step.id), get = amount(run, arg(step, 'for'), step.id)
      // price = for/sell at the `for` asset's decimals (exact: the validator checks it)
      const price = (get.raw * 10n ** BigInt(sell.asset.decimals)) / sell.raw
      return { 'offer.side': 'ask', 'offer.amount': formatUnits(sell.raw, sell.asset.decimals), 'offer.price': formatUnits(price, get.asset.decimals) }
    }
    case 'take': return { 'take.offer': (ref(run, arg(step, 'offer'), step.id) as Outputs['makeOffer']).offerId }
    case 'approve': return initialInputs(w, w.steps.find(s => s.id === arg(step, 'before'))!, run, taken)
    default: return {}
  }
}

const keyOfKind = (w: Walkthrough, kind: string) => Object.keys(w.keys).find(k => kind in w.keys[k]!)!
const chainFor = (w: Walkthrough, env: Env, run: Run, stepId: string) =>
  env.registry.open((ref(run, keyOfKind(w, 'chain'), stepId) as Outputs['chain']).id)
const swapOf = (w: Walkthrough, run: Run, stepId: string) => addr(run, keyOfKind(w, 'swap'), stepId)
const request = (c: ChainHandle) => (m: string, p: unknown[]) => c.request(m, p)
const token = (address: Address) => ({ kind: 'erc20', address }) as Asset
function signer(env: Env, run: Run, name: string, stepId: string): Account {
  const a = addr(run, name, stepId)
  const acc = env.accounts.list().find(x => x.address.toLowerCase() === a.toLowerCase())
  if (!acc) throw new Error(`Step ${stepId}: no account ${a}`)
  return acc
}
const sent = async (c: ChainHandle, from: Account, tx: { to: Address; data: `0x${string}` }) => {
  const r = await signAndSend(c, from, tx)
  if (r.status !== 'success') throw new Error(`Transaction ${r.status}${r.error ? `: ${r.error}` : ''}`)
  return r.hash
}
const balanceOf = async (c: ChainHandle, tok: Address, holder: Address) => (await readContract(c, tok, erc20Abi, 'balanceOf', [holder])) as bigint

/** Performs one step headless, with the same helpers the pages use. */
export async function perform(w: Walkthrough, step: Step, env: Env, run: Run): Promise<Out> {
  const id = step.id
  switch (step.do) {
    case 'account': {
      const label = def(w, step.key, 'account').label as string
      const a = env.accounts.list().find(x => x.label === label) ?? env.accounts.create(label)
      return { label: a.label, address: a.address }
    }
    case 'chain': {
      const prefund = (step.args!.prefund as string[]).map(p => addr(run, p, id))
      const name = initialInputs(w, step, run, (await env.registry.list()).map(c => c.name))['chain.name']!
      const h = await env.registry.create(name, 'plain', prefund)
      return { id: h.info.id, name }
    }
    case 'launchAsset': {
      const i = initialInputs(w, step, run), decimals = Number(i['launch.decimals'])
      const supply = parseAmount(i['launch.supply']!, decimals)
      if ('error' in supply) throw new Error(`Step ${id}: supply: ${supply.error}`)
      const a = await launchToken(await chainFor(w, env, run, id), signer(env, run, arg(step, 'issuer'), id),
        { name: i['launch.name']!, symbol: i['launch.symbol']!, decimals, supply: supply.ok })
      return { address: a.address!, symbol: a.symbol, name: a.name, decimals: a.decimals }
    }
    case 'deploySwap':
      return { address: await deploySwap(await chainFor(w, env, run, id), signer(env, run, arg(step, 'from'), id)) }
    case 'approve': {
      const { asset, raw } = amount(run, arg(step, 'amount'), id)
      const c = await chainFor(w, env, run, id)
      return { tx: await sent(c, signer(env, run, arg(step, 'from'), id), approveCall(token(asset.address), swapOf(w, run, id), raw)) }
    }
    case 'makeOffer': {
      const sell = amount(run, arg(step, 'sell'), id), get = amount(run, arg(step, 'for'), id)
      const c = await chainFor(w, env, run, id), swap = swapOf(w, run, id)
      const tx = await sent(c, signer(env, run, arg(step, 'from'), id), makeOfferCall(swap, sell.asset.address, sell.raw, get.asset.address, get.raw))
      const rc = (await c.request('eth_getTransactionReceipt', [tx])) as { logs: Parameters<typeof parseEventLogs>[0]['logs'] }
      const made = parseEventLogs({ abi: swapAbi, eventName: 'OfferMade', logs: rc.logs })[0]
      if (!made) throw new Error(`Step ${id}: no OfferMade event in ${tx}`)
      return { offerId: String(made.args.id), tx }
    }
    case 'take': {
      const offer = ref(run, arg(step, 'offer'), id) as Outputs['makeOffer']
      const c = await chainFor(w, env, run, id)
      const r = await signAndSend(c, signer(env, run, arg(step, 'from'), id), takeCall(swapOf(w, run, id), BigInt(offer.offerId)))
      if (r.status === 'success') return { tx: r.hash, reverted: false }
      if (r.status !== 'reverted') throw new Error(`Transaction ${r.status}${r.error ? `: ${r.error}` : ''}`)
      const error = (await takeReport(request(c), r.hash)).error?.name
      return { tx: r.hash, reverted: true, ...(error && { error }) }
    }
    case 'view': return {}
  }
}

const landed = async (c: ChainHandle, tx: string) =>
  ((await c.request('eth_getTransactionReceipt', [tx]).catch(() => null)) as { status: string } | null)?.status === '0x1'
const hasCode = async (c: ChainHandle, a: Address) => ((await c.request('eth_getCode', [a, 'latest'])) as string) !== '0x'

/**
 * Whether the step's effect is in place, read through the run's actual values; resuming skips done steps.
 * The step's `expect` checks are not part of it (`checks()` reports them): a later step may change what they
 * read, e.g. the take empties the offer's escrow. An approve is done once its recorded tx landed (even after the
 * offer or take spent the allowance), or when the allowance already covers the amount.
 */
export async function done(w: Walkthrough, step: Step, env: Env, run: Run): Promise<boolean> {
  const rec = run.steps[step.id], val = step.key ? run.values[step.key] : undefined
  switch (step.do) {
    case 'account': return !!val && env.accounts.list().some(a => a.address === (val as Outputs['account']).address)
    case 'chain': return !!val && (await env.registry.list()).some(c => c.id === (val as Outputs['chain']).id)
    case 'view': return !!rec
  }
  const c = await chainFor(w, env, run, step.id)
  switch (step.do) {
    case 'launchAsset': case 'deploySwap': return !!val && hasCode(c, (val as { address: Address }).address)
    case 'approve': {
      // a spent approval (the offer or take used it) still counts once its tx landed
      if (rec && await landed(c, (rec.outputs as Outputs['approve']).tx)) return true
      const { asset, raw } = amount(run, arg(step, 'amount'), step.id)
      const owner = addr(run, arg(step, 'from'), step.id)
      return ((await readContract(c, asset.address, erc20Abi, 'allowance', [owner, swapOf(w, run, step.id)])) as bigint) >= raw
    }
    case 'makeOffer': return !!val && (await readOffer(request(c), swapOf(w, run, step.id), BigInt((val as Outputs['makeOffer']).offerId))).status !== 'none'
    case 'take': {
      if (!rec) return false
      if (step.expectRevert) return (rec.outputs as Outputs['take']).reverted
      const offer = ref(run, arg(step, 'offer'), step.id) as Outputs['makeOffer']
      return (await readOffer(request(c), swapOf(w, run, step.id), BigInt(offer.offerId))).status === 'filled'
    }
  }
  return false
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
const shown = (raw: bigint, a: Outputs['launchAsset']) => `${exactText(raw, a.decimals)} ${a.symbol}`

/** The step's `expect` checks against the chain now, each with what was actually found. */
export async function checks(w: Walkthrough, step: Step, env: Env, run: Run): Promise<{ check: Check; pass: boolean; actual: string }[]> {
  if (!step.expect?.length) return []
  const c = await chainFor(w, env, run, step.id)
  return Promise.all(step.expect.map(async check => {
    if ('balance' in check) {
      const { asset, raw } = amount(run, check.has, step.id)
      const has = await balanceOf(c, asset.address, addr(run, check.balance, step.id))
      return { check, pass: has >= raw, actual: shown(has, asset) }
    }
    if ('escrowed' in check) {
      const { asset, raw } = amount(run, check.escrowed, step.id)
      const held = await balanceOf(c, asset.address, swapOf(w, run, step.id))
      return { check, pass: held === raw, actual: shown(held, asset) }
    }
    if ('offer' in check) {
      const offer = ref(run, check.offer, step.id) as Outputs['makeOffer']
      const status = cap((await readOffer(request(c), swapOf(w, run, step.id), BigInt(offer.offerId))).status)
      return { check, pass: status === check.status, actual: status }
    }
    const out = run.steps[step.id]?.outputs as Outputs['take'] | undefined
    if (!out) return { check, pass: false, actual: 'not run yet' }
    const outcome = out.reverted ? 'reverted' : 'taken'
    return {
      check, pass: outcome === check.outcome && (check.error === undefined || check.error === out.error),
      actual: out.error ? `${outcome}: ${out.error}` : outcome,
    }
  }))
}
