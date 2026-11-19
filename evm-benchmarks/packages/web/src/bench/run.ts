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
