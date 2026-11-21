import { erc20Abi, formatUnits, isAddressEqual, parseEventLogs, type Address, type Hex } from 'viem'
import { approveCall, transferCall, type Asset } from '@evmb/assets'
import { addLiquidityCall, orient, poolAbi, quoteAdd, quoteRemove, quoteSwap, readPool, removeLiquidityCall, swapCall } from '@evmb/pool'
import { makeOfferCall, readOffer, swapAbi, takeCall, takeReport } from '@evmb/swap'
import { parsePrice, type PlaceResult, type Store } from '@evmb/orderbook'
import type { createChainRegistry } from '../chain/registry'
import type { ChainHandle } from '../chain/handle'
import type { Account } from '../store/accounts'
import { parseAmount } from '../assets/ui'
import { exactText } from '../swap/ui'
import { launchToken } from '../assets/launch'
import { deploySwap } from '../swap/locate'
import { readContract, signAndSend } from '../tx/send'
import { deployVenue, venueAt } from '../orderbook/locate'
import { deployPool } from '../pool/locate'
import { DEFAULT_SLIPPAGE, minAt, percentOf } from '../pool/form'
import { bookStore } from '../orderbook/store'
import { walletOf } from '../orderbook/wallet'
import { amount, ref, uniqueName } from './resolve'
import type { Check, KeyDef, Outputs, Run, Step, StepType, Walkthrough } from './types'

export type ChainRegistry = ReturnType<typeof createChainRegistry>
/** `book`: the order-book store (default the app's `bookStore`); off-chain orders live only there. */
export type Env = { accounts: { list(): Account[]; create(label: string): Account }; registry: ChainRegistry; book?: Store }
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
    case 'placeOrder': {
      const { asset, raw } = amount(run, arg(step, 'amount'), step.id)
      return { 'order.side': arg(step, 'side'), 'order.type': arg(step, 'type'), 'order.price': arg(step, 'price') ?? '', 'order.amount': formatUnits(raw, asset.decimals) }
    }
    case 'cancelOrder': return { 'cancel.order': (ref(run, arg(step, 'order'), step.id) as Outputs['placeOrder']).orderId ?? '' }
    case 'approve': return initialInputs(w, w.steps.find(s => s.id === arg(step, 'before'))!, run, taken)
    case 'transfer': {
      const { asset, raw } = amount(run, arg(step, 'amount'), step.id)
      return { 'send.to': addr(run, arg(step, 'to'), step.id), 'send.amount': formatUnits(raw, asset.decimals) }
    }
    case 'addLiquidity': {
      // the page shows the pair as deployed: its base field takes the deploy's base asset
      const [b, q] = [arg(step, 'base'), arg(step, 'quote')].map(t => amount(run, t, step.id))
      const flip = keyName(arg(step, 'base')) !== keyName(arg(deployOf(w, arg(step, 'pool')), 'base'))
      const [pb, pq] = flip ? [q!, b!] : [b!, q!]
      return { 'pool.tab': 'add', 'add.base': formatUnits(pb.raw, pb.asset.decimals), 'add.quote': formatUnits(pq.raw, pq.asset.decimals) }
    }
    case 'removeLiquidity': return { 'pool.tab': 'remove', 'remove.percent': String(step.args?.percent) }
    case 'poolSwap': {
      const { asset, raw } = amount(run, arg(step, 'pay'), step.id)
      return { 'pool.tab': 'swap', 'swap.pay': asset.address, 'swap.amount': formatUnits(raw, asset.decimals), 'swap.slippage': String(step.args?.slippageBps) }
    }
    default: return {}
  }
}

const keyName = (ref: string) => /\$(\w+)/.exec(ref)?.[1]
/** The deployPool step that filled `$pool`. */
const deployOf = (w: Walkthrough, pool: string) => w.steps.find(s => s.do === 'deployPool' && s.key === keyName(pool))!
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
/** The order-book venue a deployVenue recorded, on chain `c`. */
export const venueOf = (c: ChainHandle, v: Outputs['deployVenue'], store: Store = bookStore) => venueAt(c, v.venue, v.address, store)
/** What a placeOrder step records from the venue's result (the Trade page reports the same). */
export const placedOutputs = (r: PlaceResult): Outputs['placeOrder'] => ({
  ...(r.order && { orderId: r.order.id }), ...(r.tx && { tx: r.tx }), filled: String(r.fills.reduce((n, f) => n + f.amount, 0n)),
})
/** A placeOrder step's venue, owner and market, through the run's actual values. */
async function placed(w: Walkthrough, env: Env, run: Run, place: Step, c: ChainHandle) {
  const id = place.id
  return {
    venue: await venueOf(c, ref(run, arg(place, 'venue'), id) as Outputs['deployVenue'], env.book),
    owner: addr(run, arg(place, 'from'), id),
    market: { base: amount(run, arg(place, 'amount'), id).asset.address, quote: addr(run, arg(place, 'quote'), id) },
  }
}
const placeStepOf = (w: Walkthrough, orderRef: string) => w.steps.find(s => s.do === 'placeOrder' && s.key === orderRef.replace(/^\$/, ''))!
/** Order `id` of a placeOrder step as its venue lists it now (undefined when the venue has no such order). */
async function orderNow(w: Walkthrough, env: Env, run: Run, place: Step, id: string | undefined, c: ChainHandle) {
  if (id === undefined) return
  const { venue, owner, market } = await placed(w, env, run, place, c)
  return (await venue.orders({ owner, market })).find(o => o.id === id)
}
/** `$key` of an order: its placeOrder step and recorded id. */
const orderRef = (w: Walkthrough, run: Run, name: string, stepId: string) =>
  [placeStepOf(w, name), (ref(run, name, stepId) as Outputs['placeOrder']).orderId] as const
/** Who an approve is for: the venue of a placeOrder it comes before, the pool of a pool step, else the Swap. */
const spenderOf = (w: Walkthrough, run: Run, step: Step) => {
  const before = w.steps.find(s => s.id === arg(step, 'before'))
  return before?.do === 'placeOrder' ? addr(run, arg(before, 'venue'), step.id)
    : before?.do === 'addLiquidity' || before?.do === 'poolSwap' ? addr(run, arg(before, 'pool'), step.id)
    : swapOf(w, run, step.id)
}

type PoolStep = 'addLiquidity' | 'removeLiquidity' | 'poolSwap'
/**
 * What a pool step records, from its receipt's event (the Pool page reports the same): the add's shares and `k`, the
 * reserves product read right after it (the kGrew baseline); the remove's payout (pool order); the swap's output.
 */
export async function poolOutputs<K extends PoolStep>(c: ChainHandle, kind: K, tx: Hex): Promise<Outputs[K]> {
  const rc = (await c.request('eth_getTransactionReceipt', [tx])) as { blockNumber: Hex; logs: Parameters<typeof parseEventLogs>[0]['logs'] }
  const name = ({ addLiquidity: 'LiquidityAdded', removeLiquidity: 'LiquidityRemoved', poolSwap: 'Swapped' } as const)[kind]
  const ev = parseEventLogs({ abi: poolAbi, eventName: name, logs: rc.logs })[0]
  if (!ev) throw new Error(`No ${name} event in ${tx}`)
  const a = ev.args as unknown as Record<string, bigint>
  if (kind === 'poolSwap') return { tx, out: String(a.amountOut) } as Outputs[K]
  if (kind === 'removeLiquidity') return { tx, base: String(a.base), quote: String(a.quote) } as Outputs[K]
  // the reserves at the add's own block; latest where a chain keeps no history
  const at = (m: string, p: unknown[]) => c.request(m, m === 'eth_call' ? [p[0], rc.blockNumber] : p)
  const p = await readPool(at, ev.address).catch(() => readPool(request(c), ev.address))
  return { tx, shares: String(a.shares), k: String(p.reserveBase * p.reserveQuote) } as Outputs[K]
}
/** The pool a pool step names, read live. */
const poolOf = async (c: ChainHandle, run: Run, step: Step) => readPool(request(c), addr(run, arg(step, 'pool'), step.id))
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
      return { tx: await sent(c, signer(env, run, arg(step, 'from'), id), approveCall(token(asset.address), spenderOf(w, run, step), raw)) }
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
    case 'deployVenue': {
      const venue = arg(step, 'venue') as Outputs['deployVenue']['venue']
      return { address: await deployVenue(await chainFor(w, env, run, id), venue, signer(env, run, arg(step, 'from'), id)), venue }
    }
    case 'placeOrder': {
      const c = await chainFor(w, env, run, id), { venue, market } = await placed(w, env, run, step, c)
      const type = arg(step, 'type') as 'limit' | 'market', { raw } = amount(run, arg(step, 'amount'), id)
      const quote = ref(run, arg(step, 'quote'), id) as Outputs['launchAsset']
      const r = await venue.place(walletOf(c, signer(env, run, arg(step, 'from'), id)), {
        market, side: arg(step, 'side') as 'buy' | 'sell', type, amount: raw, ...(type === 'limit' && { price: parsePrice(arg(step, 'price'), quote.decimals) }),
      })
      if (r.reverted) throw new Error(`Order reverted: ${r.reverted.error}`)
      return placedOutputs(r)
    }
    case 'cancelOrder': {
      const [place, order] = orderRef(w, run, arg(step, 'order'), id)
      const c = await chainFor(w, env, run, id), { venue } = await placed(w, env, run, place, c)
      if (order === undefined) throw new Error(`Step ${id}: ${arg(step, 'order')} rested no order`)
      await venue.cancel(walletOf(c, signer(env, run, arg(step, 'from'), id)), order)
      return {}
    }
    case 'transfer': {
      const { asset, raw } = amount(run, arg(step, 'amount'), id)
      const c = await chainFor(w, env, run, id)
      return { tx: await sent(c, signer(env, run, arg(step, 'from'), id), transferCall(token(asset.address), addr(run, arg(step, 'to'), id), raw)) }
    }
    case 'deployPool': {
      const c = await chainFor(w, env, run, id)
      return { address: await deployPool(c, signer(env, run, arg(step, 'from'), id), addr(run, arg(step, 'base'), id), addr(run, arg(step, 'quote'), id)) }
    }
    case 'addLiquidity': {
      const c = await chainFor(w, env, run, id), raw = await poolOf(c, run, step)
      const b = amount(run, arg(step, 'base'), id), q = amount(run, arg(step, 'quote'), id)
      const minShares = minAt(quoteAdd(orient(raw, b.asset.address, q.asset.address), b.raw, q.raw).shares, DEFAULT_SLIPPAGE)
      const [x, y] = isAddressEqual(raw.base, b.asset.address) ? [b.raw, q.raw] : [q.raw, b.raw] // calls take the pool's order
      return poolOutputs(c, 'addLiquidity', await sent(c, signer(env, run, arg(step, 'from'), id), addLiquidityCall(raw.address, x, y, minShares)))
    }
    case 'removeLiquidity': {
      const c = await chainFor(w, env, run, id), raw = await poolOf(c, run, step), from = signer(env, run, arg(step, 'from'), id)
      const shares = percentOf(await balanceOf(c, raw.address, from.address), Number(step.args!.percent))
      const out = quoteRemove(raw, shares)
      return poolOutputs(c, 'removeLiquidity', await sent(c, from, removeLiquidityCall(raw.address, shares, minAt(out.base, DEFAULT_SLIPPAGE), minAt(out.quote, DEFAULT_SLIPPAGE))))
    }
    case 'poolSwap': {
      const c = await chainFor(w, env, run, id), raw = await poolOf(c, run, step)
      const pay = amount(run, arg(step, 'pay'), id)
      const { minOut } = quoteSwap(raw, pay.asset.address, pay.raw, Number(step.args!.slippageBps))
      return poolOutputs(c, 'poolSwap', await sent(c, signer(env, run, arg(step, 'from'), id), swapCall(raw.address, pay.asset.address, pay.raw, minOut)))
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
    case 'transfer': case 'addLiquidity': case 'removeLiquidity': case 'poolSwap':
      return !!rec && landed(c, (rec.outputs as { tx: Hex }).tx)
    case 'launchAsset': case 'deploySwap': case 'deployVenue': case 'deployPool': return !!val && hasCode(c, (val as { address: Address }).address)
    case 'approve': {
      // a spent approval (the offer or take used it) still counts once its tx landed
      if (rec && await landed(c, (rec.outputs as Outputs['approve']).tx)) return true
      const { asset, raw } = amount(run, arg(step, 'amount'), step.id)
      const owner = addr(run, arg(step, 'from'), step.id)
      return ((await readContract(c, asset.address, erc20Abi, 'allowance', [owner, spenderOf(w, run, step)])) as bigint) >= raw
    }
    case 'makeOffer': return !!val && (await readOffer(request(c), swapOf(w, run, step.id), BigInt((val as Outputs['makeOffer']).offerId))).status !== 'none'
    case 'take': {
      if (!rec) return false
      if (step.expectRevert) return (rec.outputs as Outputs['take']).reverted
      const offer = ref(run, arg(step, 'offer'), step.id) as Outputs['makeOffer']
      return (await readOffer(request(c), swapOf(w, run, step.id), BigInt(offer.offerId))).status === 'filled'
    }
    case 'placeOrder': {
      if (!rec) return false
      const out = rec.outputs as Outputs['placeOrder']
      return out.orderId === undefined ? !!out.tx && landed(c, out.tx) : !!(await orderNow(w, env, run, step, out.orderId, c))
    }
    case 'cancelOrder': return (await orderNow(w, env, run, ...orderRef(w, run, arg(step, 'order'), step.id), c))?.status === 'cancelled'
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
    if ('order' in check) {
      const o = await orderNow(w, env, run, ...orderRef(w, run, check.order, step.id), c)
      if (!o) return { check, pass: false, actual: 'no such order' }
      const want = check.filled === undefined ? undefined : amount(run, check.filled, step.id)
      const filled = want ? `, filled ${shown(o.filled, want.asset)}` : ''
      return { check, pass: o.status === check.status && (!want || o.filled === want.raw), actual: `${o.status}${filled}` }
    }
    if ('trades' in check) {
      const place = w.steps.find(s => s.do === 'placeOrder' && arg(s, 'venue') === check.trades)
      if (!place) return { check, pass: false, actual: 'no orders on this venue' }
      const { venue, market } = await placed(w, env, run, place, c)
      const n = (await venue.trades(market, check.count + 1)).length
      return { check, pass: n === check.count, actual: `${n} ${n === 1 ? 'trade' : 'trades'}` }
    }
    if ('kGrew' in check) {
      // the baseline: k right after the first recorded add on this pool
      const first = w.steps.find(s => s.do === 'addLiquidity' && keyName(arg(s, 'pool')) === keyName(check.pool) && run.steps[s.id])
      if (!first) return { check, pass: false, actual: 'no deposit recorded yet' }
      const k0 = BigInt((run.steps[first.id]!.outputs as Outputs['addLiquidity']).k)
      const p = await readPool(request(c), addr(run, check.pool, step.id))
      const k = p.reserveBase * p.reserveQuote, n = (v: bigint) => v.toLocaleString('en-US')
      return { check, pass: k > k0, actual: `k ${k > k0 ? 'grew' : 'did not grow'}: ${n(k0)} after the first deposit, ${n(k)} now` }
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
