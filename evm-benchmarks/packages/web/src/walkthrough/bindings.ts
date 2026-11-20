import type { Outputs, Run, Step, Walkthrough } from './types'

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
    case 'view': return a.page === 'report' ? pairKeys(find(s => s.id === a.step), w) : [keyOf(a.base), keyOf(a.quote)]
    default: return []
  }
}
/** `base=&quote=` from the run's actual asset addresses; empty until both exist. */
function pair(step: Step, w: Walkthrough, run: Run) {
  const [base, quote] = pairKeys(step, w).map(k => k && (run.values[k] as { address?: string } | undefined)?.address)
  return base && quote ? `base=${base}&quote=${quote}` : ''
}
const at = (path: string) => () => path

const LAUNCH = ['launch.name', 'launch.symbol', 'launch.decimals', 'launch.supply', 'launch.issuer']
const OFFER = ['offer.side', 'offer.amount', 'offer.price']

/**
 * How a step maps onto its page: the field ids it fills, the action ids Next may press (an opener first, the
 * dialog's submit last), the marked areas, and the id the page reports under when the action completes.
 */
export function binding(step: Step, w: Walkthrough): Binding {
  const swapPath = (run: Run) => (q => q ? `/swap?${q}` : '/swap')(pair(step, w, run))
  const b = (path: Binding['path'], fields: string[], actions: string[], card?: string): Binding =>
    ({ path, fields, actions, areas: [...(card ? [card] : []), ...fields, ...actions], report: actions.at(-1) ?? step.do })
  switch (step.do) {
    case 'account': return b(at('/accounts'), ['account.label'], ['account.create'], 'account.card')
    case 'chain': return b(at('/chains'), ['chain.name'], ['chains.new', 'chain.create'])
    case 'launchAsset': return b(at('/assets'), LAUNCH, ['assets.launch', 'launch.submit'])
    case 'deploySwap': return b(swapPath, [], ['swap.deploy'])
    case 'makeOffer': return b(swapPath, OFFER, ['offer.create'], 'offer.card')
    case 'take': return b(swapPath, ['take.offer'], ['take.submit'], 'take.card')
    case 'approve': {
      const before = w.steps.find(s => s.id === step.args?.before)
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
      return b(swapPath, [], [], 'view')
    }
  }
}

/** The action Next presses now: the last of the step's actions that a mounted page has registered. */
export const lastRegistered = (actions: string[], registered: { has(id: string): boolean }) =>
  [...actions].reverse().find(id => registered.has(id))
