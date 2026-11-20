import type { Address, Hex } from 'viem'

export type KeyDef =
  | { account: { label: string } }
  | { chain: { name: string } }
  | { asset: { symbol: string; name: string; decimals: number } }
  | { swap: Record<string, never> }
  | { offer: Record<string, never> }

export type StepType = 'account' | 'chain' | 'launchAsset' | 'deploySwap' | 'approve' | 'makeOffer' | 'take' | 'view'

export type Check =
  | { balance: string; has: string }
  | { escrowed: string }
  | { offer: string; status: 'Open' | 'Filled' | 'Cancelled' }
  | { outcome: 'taken' | 'reverted'; error?: string }

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
}

export type StepRecord = { inputs: Record<string, string>; outputs: Outputs[StepType]; at: string }

export type Run = {
  walkthrough: string
  started: string
  edited: boolean
  values: Record<string, Outputs[StepType]>
  steps: Record<string, StepRecord>
}
