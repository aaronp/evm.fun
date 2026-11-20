import type { Outputs, Run, Step, Walkthrough } from './types'

export type Binding = { path(run: Run): string; fields: string[]; actions: string[]; areas: string[]; report: string }

// The run's launched assets in launch order: the first is the pair's base, the second its quote.
const pair = (run: Run) => {
  const [base, quote] = Object.values(run.values).filter((v): v is Outputs['launchAsset'] => 'decimals' in v)
  return base && quote ? `base=${base.address}&quote=${quote.address}` : ''
}
const addrOf = (run: Run, ref: unknown) => (run.values[String(ref).replace(/^\$/, '')] as { address?: string } | undefined)?.address ?? ''
const swapPath = (run: Run) => (q => q ? `/swap?${q}` : '/swap')(pair(run))
const at = (path: string) => () => path

const LAUNCH = ['launch.name', 'launch.symbol', 'launch.decimals', 'launch.supply', 'launch.issuer']
const OFFER = ['offer.side', 'offer.amount', 'offer.price']

/**
 * How a step maps onto its page: the field ids it fills, the action ids Next may press (an opener first, the
 * dialog's submit last), the marked areas, and the id the page reports under when the action completes.
 */
export function binding(step: Step, w: Walkthrough): Binding {
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
          return `/swap/report?tx=${t}${(q => q && `&${q}`)(pair(run))}`
        }, [], [], 'view')
      }
      return b(run => `/swap?base=${addrOf(run, args.base)}&quote=${addrOf(run, args.quote)}`, [], [], 'view')
    }
  }
}

/** The action Next presses now: the last of the step's actions that a mounted page has registered. */
export const lastRegistered = (actions: string[], registered: { has(id: string): boolean }) =>
  [...actions].reverse().find(id => registered.has(id))
