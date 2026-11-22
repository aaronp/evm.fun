import type { Address, Hex } from 'viem'
import type { Phase, SwapOutcome } from '@evmb/htlc'

export type KeyDef =
  | { account: { label: string } }
  | { chain: { name: string } }
  | { asset: { symbol: string; name: string; decimals: number } }
  | { swap: Record<string, never> }
  | { offer: Record<string, never> }
  | { venue: { venue: 'onchain' | 'offchain' } }
  | { order: Record<string, never> }
  | { pool: Record<string, never> }
  | { hashLock: Record<string, never> }

export type StepType =
  | 'account' | 'chain' | 'launchAsset' | 'deploySwap' | 'approve' | 'makeOffer' | 'take' | 'view'
  | 'deployVenue' | 'placeOrder' | 'cancelOrder' | 'transfer' | 'deployPool' | 'addLiquidity' | 'removeLiquidity' | 'poolSwap'
  | 'deployHashLock' | 'lockFunds' | 'claimLock' | 'refundLock' | 'advanceBlocks'

export type OrderStatus = 'open' | 'partial' | 'filled' | 'cancelled' | 'failed' | 'unfunded'

export type Check =
  | { balance: string; has: string }
  | { escrowed: string }
  | { offer: string; status: 'Open' | 'Filled' | 'Cancelled' }
  | { outcome: 'taken' | 'reverted'; error?: string }
  | { order: string; status: OrderStatus; filled?: string }
  | { trades: string; count: number }
  | { pool: string; kGrew: true }
  /** `swap`/`report`: the id of the lockFunds step that opened the swap */
  | { swap: string; phase: Phase }
  | { report: string; outcome: SwapOutcome; unsafe?: boolean }

export type Step = {
  id: string
  do: StepType
  key?: string
  title: string
  text: string
  args?: Record<string, unknown>
  expect?: Check[]
  expectRevert?: true
}

export type Walkthrough = { id: string; title: string; summary: string; keys: Record<string, KeyDef>; steps: Step[] }

export type Outputs = {
  account: { label: string; address: Address }
  chain: { id: string; name: string }
  launchAsset: { address: Address; symbol: string; name: string; decimals: number }
  deploySwap: { address: Address }
  approve: { tx: Hex }
  makeOffer: { offerId: string; tx: Hex }
  take: { tx: Hex; reverted: boolean; error?: string }
  view: Record<string, never>
  deployVenue: { address: Address; venue: 'onchain' | 'offchain' }
  /** `orderId`: absent when nothing rests (a taker filled in full off-chain); `filled`: base raw units, decimal */
  placeOrder: { orderId?: string; tx?: Hex; filled: string }
  cancelOrder: { tx?: Hex }
  transfer: { tx: Hex }
  deployPool: { address: Address }
  /** raw amounts as decimal strings; `k` = reserves product right after this add */
  addLiquidity: { tx: Hex; shares: string; k: string }
  /** paid out in the pool's (deploy) order */
  removeLiquidity: { tx: Hex; base: string; quote: string }
  poolSwap: { tx: Hex; out: string }
  deployHashLock: { address: Address }
  /** `id`: the lock's id (decimal); `hash`: the swap's hash (never the secret: runs are shown and saved) */
  lockFunds: { tx: Hex; id: string; hash: Hex }
  claimLock: { tx: Hex }
  refundLock: { tx: Hex }
  /** the chain's head after advancing (decimal) */
  advanceBlocks: { head: string }
}

export type StepRecord = { inputs: Record<string, string>; outputs: Outputs[StepType]; at: string }

export type Run = {
  walkthrough: string
  started: string
  edited: boolean
  values: Record<string, Outputs[StepType]>
  steps: Record<string, StepRecord>
}
