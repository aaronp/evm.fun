import type {Abi, Hex} from 'viem'
import MintableTokenJson from './artifacts/MintableToken.json'
import AtomicSwapJson from './artifacts/AtomicSwap.json'

export type Contract = {abi: Abi; bytecode: Hex}
export const MintableToken = MintableTokenJson as Contract
export const AtomicSwap = AtomicSwapJson as Contract
