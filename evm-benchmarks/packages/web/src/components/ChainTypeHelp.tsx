export const CHAIN_TYPE_BLURB = {
  plain: 'one tx per block, signature checked as it arrives; simple, lower throughput.',
  sequencer: 'parallel signature checks, ordered batches, many txs per block; higher throughput, higher latency, unmined txs lost on reload.',
} as const

export function ChainTypeHelp() {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">What's the difference?</summary>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {(Object.keys(CHAIN_TYPE_BLURB) as (keyof typeof CHAIN_TYPE_BLURB)[]).map(t => <li key={t}><b>{t}</b>: {CHAIN_TYPE_BLURB[t]}</li>)}
        <li>Both are real EVMs running unmodified Solidity bytecode (revm here). Details in the README and REPORT.md.</li>
      </ul>
    </details>
  )
}
