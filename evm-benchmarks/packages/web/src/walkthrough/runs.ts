import { kv } from '../store/kv'
import type { Run } from './types'

// One saved run per walkthrough, keyed by walkthrough id, so the ribbon resumes after a reload.
const STORE = 'walkthroughRuns'
const ACTIVE = 'evmb.walkthrough.active'

export const loadRun = (id: string) => kv.get<Run>(STORE, id)
export const saveRun = (run: Run) => kv.set(STORE, run.walkthrough, run)
export const clearRun = (id: string) => kv.del(STORE, id)

/** The walkthrough in progress in this browser, if any. */
export function activeId(): string | undefined {
  try { return localStorage.getItem(ACTIVE) ?? undefined } catch { return undefined }
}
export function setActiveId(id: string | undefined) {
  try { id === undefined ? localStorage.removeItem(ACTIVE) : localStorage.setItem(ACTIVE, id) } catch { /* storage blocked: not remembered */ }
}
