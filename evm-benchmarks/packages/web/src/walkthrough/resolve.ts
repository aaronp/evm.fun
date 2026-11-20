import { parseAmount } from '../assets/ui'
import type { Outputs, Run } from './types'

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
