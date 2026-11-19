import type { RunResult } from '@evmb/core'
import type { ChainHandle, ChainType } from '../chain/handle'

export interface Run { result: RunResult; handle: ChainHandle; type: ChainType; name: string }

// Module-level so runs survive navigating away from the Benchmark page (lives for the page session).
const runs: Run[] = []
let counter = 0

export const sessionRuns = () => [...runs]

/** Names the handle `bench <scenario> <type> #k` with a never-resetting k and records the run. */
export function addRun(result: RunResult, handle: ChainHandle, type: ChainType, scenario: string): Run {
  const name = `bench ${scenario} ${type} #${++counter}`
  handle.info.name = name
  const run = { result, handle, type, name }
  runs.push(run)
  return run
}
