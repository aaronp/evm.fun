import { parseAmount } from '../assets/ui'
import type { Outputs, Run, Step, Walkthrough } from './types'

/** The actual value behind `$name`; `stepId` only names the step in the error. */
export function ref(run: Run, name: string, stepId = '?'): Outputs[keyof Outputs] {
  const key = name.replace(/^\$/, '')
  const v = run.values[key]
  if (!v) throw new Error(`Step ${stepId}: $${key} has no value yet`)
  return v
}

/** `"1000 $GBP"` → the asset as launched and the raw amount at its actual decimals. */
export function amount(run: Run, text: string, stepId = '?'): { asset: Outputs['launchAsset']; raw: bigint } {
  const m = /^(\S+)\s+\$(\w+)$/.exec(text.trim())
  if (!m) throw new Error(`Step ${stepId}: "${text}" is not "<amount> $KEY"`)
  const asset = ref(run, m[2], stepId) as Outputs['launchAsset']
  const p = parseAmount(m[1], asset.decimals)
  if ('error' in p) throw new Error(`Step ${stepId}: ${text}: ${p.error}`)
  return { asset, raw: p.ok }
}

/** `Example` → `Example 2` → `Example 3`… first name not in `taken`. */
export function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name
  for (let n = 2; ; n++) if (!taken.includes(`${name} ${n}`)) return `${name} ${n}`
}

/** `"1000 $GBP"` or `"$GBP"` → `GBP`. */
export const keyName = (ref: unknown) => /\$(\w+)/.exec(String(ref ?? ''))?.[1]
const chainKeys = (w: Walkthrough) => Object.keys(w.keys).filter(k => 'chain' in w.keys[k]!)

/**
 * The chain key a step acts on: its `args.chain`; a chain step its own key; an approve its `before` step's; else
 * the walkthrough's only (first) chain key. A walkthrough with two chains names it on every chain-bound step (validated).
 */
export function chainKeyOf(w: Walkthrough, step: Step | undefined): string | undefined {
  if (!step) return chainKeys(w)[0]
  if (step.args?.chain) return keyName(step.args.chain)
  if (step.do === 'chain') return step.key
  if (step.do === 'approve') return chainKeyOf(w, w.steps.find(s => s.id === step.args?.before))
  return chainKeys(w)[0]
}
/** The chain key an asset was launched on. */
export const assetChainKey = (w: Walkthrough, asset: string | undefined) => chainKeyOf(w, w.steps.find(s => s.do === 'launchAsset' && s.key === asset))

/** The lockFunds step that opens a swap (has terms, no `swap`); `id`: by its step id, else the first. */
export const openingOf = (w: Walkthrough, id?: string) =>
  w.steps.find(s => s.do === 'lockFunds' && !s.args?.swap && (id === undefined || s.id === id))
/** The lockFunds step that answers swap `id`. */
export const answerOf = (w: Walkthrough, id: string) => w.steps.find(s => s.do === 'lockFunds' && s.args?.swap === id)
/** A swap's chain keys: A where the opening lock is, B where its `for` asset lives (else the first two chain keys). */
export function chainsAB(w: Walkthrough): [string | undefined, string | undefined] {
  const o = openingOf(w), [k0, k1] = chainKeys(w)
  if (!o) return [k0, k1]
  return [chainKeyOf(w, o), assetChainKey(w, keyName(o.args?.for))]
}
