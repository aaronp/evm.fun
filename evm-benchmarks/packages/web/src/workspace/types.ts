import type { Address } from '@evmb/core'
import type { ChainFile } from '../chain/chainFile'
import type { Snapshot } from '../chain/snapshots'
import type { Run, Walkthrough } from '../walkthrough/types'
import type { Account } from '../store/accounts'

/** The whole playground in one file (spec: 2026-11-21-workspace-appbar-design). Per-browser settings are not in it. */
export type WorkspaceFile = {
  format: 'evm.fun/workspace'; version: 1; savedAt: string; engine: string
  accounts: Account[]
  /** each exactly today's chain export, plus the chain's id (kept on Open so links, runs and order-book scopes stay valid) */
  chains: (ChainFile & { id: string })[]
  selection?: { chain?: string; account?: Address }
  snapshots: Snapshot[]
  walkthroughs: { edits: Walkthrough[]; runs: Run[] }
  activeWalkthrough?: string
  /** every row of the off-chain order-book store */
  orderbook: { table: string; key: string; value: unknown }[]
}
