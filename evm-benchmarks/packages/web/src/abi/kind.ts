import type { AbiFunction } from 'viem'

/** 'read' = view/pure (eth_call, never signed); everything else changes state. */
export const fnKind = (f: Pick<AbiFunction, 'stateMutability'>): 'write' | 'read' =>
  f.stateMutability === 'view' || f.stateMutability === 'pure' ? 'read' : 'write'

export const fnSig = (f: AbiFunction) => `${f.name}(${f.inputs.map(p => `${p.type}${p.name ? ' ' + p.name : ''}`).join(', ')})`
