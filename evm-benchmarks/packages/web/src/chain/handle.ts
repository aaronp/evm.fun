import { keccak256 } from 'viem'
import type { ChainSource } from './chainFile'
import type { Approach, Hex, Receipt } from '@evmb/core'

export type ChainType = 'plain' | 'sequencer' // plain -> approach 01, sequencer -> approach 02
export interface ChainInfo { id: string; name: string; type: ChainType; createdAt: string; ephemeral?: boolean; lastHeight?: number; source?: ChainSource }
export interface ChainHandle {
  info: ChainInfo
  send(raw: Hex): Promise<Receipt>
  request(m: string, p?: unknown[]): Promise<unknown>
  /** mine `n` empty blocks; the new head */
  mine(n: number): Promise<bigint>
  approach: Approach
  dispose(): Promise<void>
}

export function makeHandle(info: ChainInfo, approach: Approach): ChainHandle {
  return {
    info,
    approach,
    async send(raw) {
      await approach.submit([raw])
      return (await approach.awaitSettled([keccak256(raw)]))[0]!
    },
    request: (m, p) => approach.request!(m, p),
    async mine(n) {
      if (!approach.mine) throw new Error("This chain can't advance blocks")
      for (let i = 0; i < n; i++) await approach.mine()
      return BigInt((await approach.request!('eth_blockNumber', [])) as string)
    },
    dispose: () => approach.dispose(),
  }
}
