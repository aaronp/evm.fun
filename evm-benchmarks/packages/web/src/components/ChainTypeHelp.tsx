import type { ChainType } from '../chain/handle'

export const CHAIN_TYPE_BLURB = {
  plain: 'one tx per block, signature checked as it arrives; simple, lower throughput.',
  sequencer: 'parallel signature checks, ordered batches, many txs per block; higher throughput, higher latency, unmined txs lost on reload.',
} as const

export function ChainTypeHelp() {
  return (
    <details className="text-sm text-muted">
      <summary className="cursor-pointer text-text">What's the difference?</summary>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {(Object.keys(CHAIN_TYPE_BLURB) as (keyof typeof CHAIN_TYPE_BLURB)[]).map(t => <li key={t}><b>{t}</b>: {CHAIN_TYPE_BLURB[t]}</li>)}
        <li>Both are real EVMs running unmodified Solidity bytecode (revm here). Details in the README and REPORT.md.</li>
      </ul>
    </details>
  )
}

/** Radio cards for the chain type, grouped under a screen-reader legend. */
export function ChainTypePicker({ type, onChange }: { type: ChainType; onChange(t: ChainType): void }) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="sr-only">Chain type</legend>
      {(['plain', 'sequencer'] as const).map(t => (
        <label key={t} className={`block cursor-pointer rounded-lg border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${type === t ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface hover:bg-surface-hover'}`}>
          <input className="mr-2 accent-accent" type="radio" name="type" checked={type === t} onChange={() => onChange(t)} />
          <b>{t}</b>
          <span className="mt-1 block text-muted">{CHAIN_TYPE_BLURB[t]}</span>
        </label>
      ))}
    </fieldset>
  )
}
