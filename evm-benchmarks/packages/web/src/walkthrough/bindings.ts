import { assetId } from '@evmb/assets'
import type { Address } from 'viem'
import type { Outputs, Run, Step, Walkthrough } from './types'
import { chainKeyOf, chainsAB, keyName, openingOf } from './resolve'

export type Binding = { path(run: Run): string; fields: string[]; actions: string[]; areas: string[]; report: string }

const keyOf = (ref: unknown) => /\$(\w+)/.exec(String(ref))?.[1] // "1000 $GBP" or "$GBP" → GBP

/**
 * The pair's asset keys for a step, from its own args: an offer's sell asset is the base, its `for` asset the
 * quote; a take uses the offer it takes, an approve its `before` step, a deploy the first offer, a report its take.
 */
function pairKeys(step: Step | undefined, w: Walkthrough): (string | undefined)[] {
  const a = step?.args ?? {}
  const find = (p: (s: Step) => boolean) => w.steps.find(p)
  switch (step?.do) {
    case 'makeOffer': return [keyOf(a.sell), keyOf(a.for)]
    case 'take': return pairKeys(find(s => s.do === 'makeOffer' && s.key === keyOf(a.offer)), w)
    case 'approve': return pairKeys(find(s => s.id === a.before), w)
    case 'deploySwap': return pairKeys(find(s => s.do === 'makeOffer'), w)
    case 'placeOrder': return [keyOf(a.amount), keyOf(a.quote)]
    case 'cancelOrder': return pairKeys(find(s => s.do === 'placeOrder' && s.key === keyOf(a.order)), w)
    case 'deployVenue': return pairKeys(find(s => s.do === 'placeOrder' && keyOf(s.args?.venue) === step.key), w)
    case 'deployPool': return [keyOf(a.base), keyOf(a.quote)]
    case 'addLiquidity': case 'removeLiquidity': case 'poolSwap': return pairKeys(find(s => s.do === 'deployPool' && s.key === keyOf(a.pool)), w)
    case 'view':
      if (a.page === 'pool') return pairKeys(find(s => s.do === 'deployPool' && s.key === keyOf(a.pool)), w)
      return a.page === 'report' ? pairKeys(find(s => s.id === a.step), w) : [keyOf(a.base), keyOf(a.quote)]
    default: return []
  }
}
/** `base=&quote=` from the run's actual asset addresses; empty until both exist. */
function pair(step: Step, w: Walkthrough, run: Run) {
  const [base, quote] = pairKeys(step, w).map(k => k && (run.values[k] as { address?: string } | undefined)?.address)
  return base && quote ? `base=${base}&quote=${quote}` : ''
}
const at = (path: string) => () => path

/** The order-book venue key a Trade step acts on: its own (deploy), its args' (order, view), its order's or before step's. */
function venueKey(step: Step | undefined, w: Walkthrough): string | undefined {
  const a = step?.args ?? {}
  switch (step?.do) {
    case 'deployVenue': return step.key
    case 'placeOrder': case 'view': return keyOf(a.venue)
    case 'cancelOrder': return venueKey(w.steps.find(s => s.do === 'placeOrder' && s.key === keyOf(a.order)), w)
    case 'approve': return venueKey(w.steps.find(s => s.id === a.before), w)
  }
}
/** `/trade?venue=<kind>&base=&quote=`: the kind as deployed, else the key's initial. */
function tradePath(step: Step, w: Walkthrough) {
  return (run: Run) => {
    const k = venueKey(step, w)!
    const kind = (run.values[k] as Outputs['deployVenue'] | undefined)?.venue ?? (w.keys[k] as { venue?: { venue: string } } | undefined)?.venue?.venue
    const q = pair(step, w, run)
    return `/trade?venue=${kind}${q && `&${q}`}`
  }
}

const LAUNCH = ['launch.name', 'launch.symbol', 'launch.decimals', 'launch.supply', 'launch.issuer']
const OFFER = ['offer.side', 'offer.amount', 'offer.price']
const ORDER = ['order.side', 'order.type', 'order.price', 'order.amount']
const POOL: Partial<Record<Step['do'], string[]>> = {
  addLiquidity: ['pool.tab', 'add.base', 'add.quote'], removeLiquidity: ['pool.tab', 'remove.percent'],
  poolSwap: ['pool.tab', 'swap.pay', 'swap.amount', 'swap.slippage'],
}
const XMAKE = ['xswap.amount', 'xswap.want', 'xswap.taker', 'xswap.timeout']
/** The page's column for the step's chain: A or B. */
const side = (step: Step, w: Walkthrough) => (chainKeyOf(w, step) === chainsAB(w)[0] ? 'A' : 'B')
const ACT: Partial<Record<Step['do'], string>> = { addLiquidity: 'pool.add', removeLiquidity: 'pool.remove', poolSwap: 'pool.swap' }

/** `/assets?asset=<id>` for a transfer's asset on the run's chain, once both exist. */
const assetPath = (step: Step, w: Walkthrough) => (run: Run) => {
  const chainKey = chainKeyOf(w, step)
  const chain = chainKey && (run.values[chainKey] as Outputs['chain'] | undefined)?.id
  const token = (run.values[keyOf(step.args?.amount) ?? ''] as { address?: Address } | undefined)?.address
  return chain && token ? `/assets?asset=${encodeURIComponent(assetId(chain, token))}` : '/assets'
}

const XSWAP = ['deployHashLock', 'lockFunds', 'claimLock', 'refundLock', 'advanceBlocks']
/** The step runs on the Cross-chain swap page: an xswap step, or an approve before a lock. */
export const onXSwap = (step: Step, w: Walkthrough) =>
  XSWAP.includes(step.do) || (step.do === 'approve' && w.steps.find(s => s.id === step.args?.before)?.do === 'lockFunds')

/** The chain the app selects for a step (the wizard switches to it): chain A on /xswap, whichever chain the step acts on; else the step's own. */
export function pageChain(w: Walkthrough, step: Step, run: Run): string | undefined {
  const k = onXSwap(step, w) ? chainsAB(w)[0] : chainKeyOf(w, step)
  return k ? (run.values[k] as Outputs['chain'] | undefined)?.id : undefined
}

/** `/xswap?chain=<A>&chainB=<B>&as=<who acts>&base=&quote=&hash=`: from the run's actual chains, accounts, tokens and swap. */
function xswapPath(step: Step, w: Walkthrough) {
  const i = w.steps.indexOf(step)
  // who the page acts as: the step's `from`, else the nearest earlier step's (Advance blocks is nobody's)
  const from = w.steps.slice(0, i + 1).reverse().find(s => s.args?.from)?.args?.from
  const open = openingOf(w, step.do === 'lockFunds' && !step.args?.swap ? step.id : (step.args?.swap as string | undefined))
    ?? openingOf(w, w.steps.find(s => s.id === step.args?.before)?.id) ?? openingOf(w)
  return (run: Run) => {
    const v = (k?: string) => (k ? run.values[k] as { id?: string; address?: string } | undefined : undefined)
    const [kA, kB] = chainsAB(w)
    const hash = open && (run.steps[open.id]?.outputs as Outputs['lockFunds'] | undefined)?.hash
    const q = Object.entries({
      chain: v(kA)?.id, chainB: v(kB)?.id, as: v(keyName(from))?.address,
      base: v(keyName(open?.args?.amount))?.address, quote: v(keyName(open?.args?.for))?.address, hash,
    }).filter(([, x]) => x)
    return q.length ? `/xswap?${new URLSearchParams(q as [string, string][])}` : '/xswap'
  }
}

/**
 * How a step maps onto its page: the field ids it fills, the action ids Next may press (an opener first, the
 * dialog's submit last), the marked areas, and the id the page reports under when the action completes.
 */
export function binding(step: Step, w: Walkthrough): Binding {
  const swapPath = (run: Run) => (q => q ? `/swap?${q}` : '/swap')(pair(step, w, run))
  const b = (path: Binding['path'], fields: string[], actions: string[], card?: string): Binding =>
    ({ path, fields, actions, areas: [...(card ? [card] : []), ...fields, ...actions], report: actions.at(-1) ?? step.do })
  const poolPath = (run: Run) => (q => q ? `/pool?${q}` : '/pool')(pair(step, w, run))
  switch (step.do) {
    case 'transfer': return b(assetPath(step, w), ['send.to', 'send.amount'], ['assets.send', 'send.submit'])
    case 'deployPool': return b(poolPath, [], ['pool.deploy'])
    case 'addLiquidity': case 'removeLiquidity': case 'poolSwap': return b(poolPath, POOL[step.do]!, [ACT[step.do]!], 'pool.card')
    case 'account': return b(at('/accounts'), ['account.label'], ['account.create'], 'account.card')
    case 'chain': return b(at('/chains'), ['chain.name'], ['chains.new', 'chain.create'])
    case 'launchAsset': return b(at('/assets'), LAUNCH, ['assets.launch', 'launch.submit'])
    case 'deploySwap': return b(swapPath, [], ['swap.deploy'])
    case 'makeOffer': return b(swapPath, OFFER, ['offer.create'], 'offer.card')
    case 'take': return b(swapPath, ['take.offer'], ['take.submit'], 'take.card')
    case 'deployVenue': return b(tradePath(step, w), [], ['trade.deploy'])
    case 'placeOrder': return b(tradePath(step, w), ORDER, ['order.submit'], 'order.card')
    case 'cancelOrder': return b(tradePath(step, w), ['cancel.order'], ['order.cancel'], 'orders.card')
    case 'deployHashLock': return b(xswapPath(step, w), [], [`xswap.deploy${side(step, w)}`])
    case 'advanceBlocks': return b(xswapPath(step, w), [`xswap.blocks${side(step, w)}`], [`xswap.advance${side(step, w)}`])
    case 'lockFunds': return step.args?.swap
      ? b(xswapPath(step, w), ['xswap.answerTimeout'], ['xswap.accept'], 'xswap.acceptCard')
      : b(xswapPath(step, w), XMAKE, ['xswap.lock'], 'xswap.make')
    case 'claimLock': return b(xswapPath(step, w), [], [`xswap.claim${side(step, w)}`], 'xswap.claims')
    case 'refundLock': return b(xswapPath(step, w), [], [`xswap.refund${side(step, w)}`], 'xswap.claims')
    case 'approve': {
      const before = w.steps.find(s => s.id === step.args?.before)
      if (before?.do === 'lockFunds') return before.args?.swap
        ? b(xswapPath(step, w), ['xswap.answerTimeout'], ['xswap.acceptApprove'], 'xswap.acceptCard')
        : b(xswapPath(step, w), XMAKE, ['xswap.approve'], 'xswap.make')
      if (before?.do === 'placeOrder') return b(tradePath(step, w), ORDER, ['order.approve'], 'order.card')
      if (before?.do === 'addLiquidity' || before?.do === 'poolSwap') return b(poolPath, POOL[before.do]!, ['pool.approve'], 'pool.card')
      const side = before?.do === 'take' ? 'take' : 'offer'
      return b(swapPath, binding(before ?? { ...step, do: 'makeOffer' }, w).fields, [`${side}.approve`], `${side}.card`)
    }
    case 'view': {
      const args = step.args ?? {}
      if (args.page === 'report') {
        return b(run => {
          const t = (run.steps[String(args.step)]?.outputs as Outputs['take'] | undefined)?.tx ?? ''
          return `/swap/report?tx=${t}${(q => q && `&${q}`)(pair(step, w, run))}`
        }, [], [], 'view')
      }
      return b(args.page === 'trade' ? tradePath(step, w) : args.page === 'pool' ? poolPath : swapPath, [], [], 'view')
    }
  }
}

/** The action Next presses now: the last of the step's actions that a mounted page has registered. */
export const lastRegistered = (actions: string[], registered: { has(id: string): boolean }) =>
  [...actions].reverse().find(id => registered.has(id))
