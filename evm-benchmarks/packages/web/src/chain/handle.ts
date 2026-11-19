import { keccak256 } from 'viem'
import type { Approach, Hex, Receipt } from '@evmb/core'

export type ChainType = 'plain' | 'sequencer' // plain -> approach 01, sequencer -> approach 02
export interface ChainInfo { id: string; name: string; type: ChainType; createdAt: string; ephemeral?: boolean }
export interface ChainHandle {
  info: ChainInfo
  send(raw: Hex): Promise<Receipt>
  request(m: string, p?: unknown[]): Promise<unknown>
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
    dispose: () => approach.dispose(),
  }
}
