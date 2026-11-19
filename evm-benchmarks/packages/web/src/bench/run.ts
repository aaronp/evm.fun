import { runBenchmark, scenarios, type ApproachHost, type RunOptions, type RunResult } from '@evmb/core'
import plain from '@evmb/approach-01-webevm-baseline'
import sequencer from '@evmb/approach-02-seq-memory'
import { makeHandle, type ChainHandle, type ChainType } from '../chain/handle'

const factories = { plain, sequencer }

export interface BenchParams {
  type: ChainType
  scenario: keyof typeof scenarios
  n: number
  senders: number
  /** engine host; callers pass revm WITHOUT persistence so TPS is not distorted */
  host: ApproachHost
}

export const MAX_N = 50_000

/** Validate the Benchmark form's N / senders text inputs. */
export function parseBenchSize(n: string, senders: string): { n: number; senders: number } | { error: string } {
  const int = (v: string) => (/^\s*\d+\s*$/.test(v) ? Number(v) : NaN)
  const N = int(n), S = int(senders)
  if (!(N >= 1 && N <= MAX_N)) return { error: `N must be a whole number from 1 to ${MAX_N.toLocaleString('en-US')}` }
  if (!(S >= 1 && S <= N)) return { error: `senders must be a whole number from 1 to N (${N})` }
  return { n: N, senders: S }
}

export async function runInBrowser(
  { type, scenario, n, senders, host }: BenchParams,
  onProgress?: RunOptions['onProgress'],
): Promise<{ result: RunResult; handle: ChainHandle }> {
  const approach = factories[type]({}, host)
  let result: RunResult
  try {
    result = await runBenchmark({ approach, scenario: scenarios[scenario](), n, senders, seed: 'playground', onProgress })
  } catch (e) {
    await approach.dispose().catch(() => {}) // don't leak the engine of a failed run
    throw e
  }
  const info = { id: crypto.randomUUID(), name: `bench ${scenario} ${type}`, type, createdAt: new Date().toISOString() }
  return { result, handle: makeHandle(info, approach) }
}
