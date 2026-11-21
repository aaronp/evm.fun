import type {Address, Hex} from 'viem';
import type {Approach} from '../types.ts';
import {ethTransfer} from './eth-transfer.ts';
import {erc20Disjoint, erc20Hot, erc20Mint} from './erc20.ts';
import {atomicSwap} from './atomic-swap.ts';
import {offerFill} from './offer-fill.ts';
import {ammSwap} from './amm-swap.ts';
import {bookMatchOffchain, bookMatchOnchain} from './book-match.ts';

export interface ScenarioParams {
  n: number;
  senders: number;
  seed: string;
}

export interface Scenario {
  id: 'eth-transfer' | 'erc20-disjoint' | 'erc20-hot' | 'erc20-mint' | 'atomic-swap' | 'offer-fill' | 'amm-swap' | 'book-match-onchain' | 'book-match-offchain';
  prefund(p: ScenarioParams): Record<Address, bigint>;
  /** untimed: deploys/mints/approves; throws if any receipt is not success */
  setup(approach: Approach, p: ScenarioParams): Promise<void>;
  /** the N timed txs */
  generate(p: ScenarioParams, onSigned?: (done: number) => void): Promise<Hex[]>;
  verify(approach: Approach, p: ScenarioParams): Promise<{ok: boolean; detail: string}>;
}

/** factory: fresh (stateful) instance per run */
export const scenarios: Record<Scenario['id'], () => Scenario> = {
  'eth-transfer': ethTransfer,
  'erc20-disjoint': erc20Disjoint,
  'erc20-hot': erc20Hot,
  'erc20-mint': erc20Mint,
  'atomic-swap': atomicSwap,
  'offer-fill': offerFill,
  'amm-swap': ammSwap,
  'book-match-onchain': bookMatchOnchain,
  'book-match-offchain': bookMatchOffchain,
};
