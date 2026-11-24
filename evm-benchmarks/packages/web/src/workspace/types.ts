import type { Address, Hex } from '@evmb/core'
import type { ChainFile, ContractRecord } from '../chain/chainFile'
import type { Asset } from '@evmb/assets'
import type { Snapshot } from '../chain/snapshots'
import type { Run, Walkthrough } from '../walkthrough/types'
import type { Account } from '../store/accounts'
import type { ChainInfo, Deployed } from '../chain/handle'

/** The whole playground in one file (spec: 2026-11-21-workspace-appbar-design). Per-browser settings are not in it. */
export type WorkspaceFile = {
  format: 'evm.fun/workspace'; version: 1; savedAt: string; engine: string
  accounts: Account[]
  /** each exactly today's chain export, plus the chain's id (kept on Open so links, runs and order-book scopes stay valid) */
  chains: (ChainFile & { id: string; /** missing in older files: Open orders those by file position */ createdAt?: string; /** where it was deployed (missing = never) */ deployed?: Deployed })[]
  /** follower chains (chain type 'follower') as pointers plus their records (no state; their snapshots are in `snapshots`): they sync when opened; missing in older files = none */
  followers?: (Pick<ChainInfo, 'id' | 'name' | 'createdAt'> & { follows: NonNullable<ChainInfo['follows']>; contracts: ContractRecord[]; assets: Asset[] })[]
  /** `chain` is a chain's or a follower's id */
  selection?: { chain?: string; account?: Address }
  snapshots: Snapshot[]
  walkthroughs: { edits: Walkthrough[]; runs: Run[] }
  activeWalkthrough?: string
  /** every row of the off-chain order-book store */
  orderbook: { table: string; key: string; value: unknown }[]
  /** the maker's cross-chain swap secrets (kv `secrets`); missing in older files = none */
  secrets: { hash: Hex; secret: Hex; chain: string; lockId: string }[]
  /** chain A's head (decimal) when the taker answered, by hash (kv `xswapAnswers`); missing in older files = none */
  answers: { hash: Hex; headA: string }[]
}
