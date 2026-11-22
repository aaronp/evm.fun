import { encodeFunctionData, zeroAddress, type Address, type Hex } from 'viem'
import { hashLockAbi } from './abi'

type Call = { to: Address; data: Hex }
/** An opening lock sets the terms (`wantChain`, `wantLock`, `wantToken`, `wantAmount`); an answer leaves them out. */
export type LockArgs = {
  token: Address; amount: bigint; recipient: Address; hash: Hex; timeoutBlock: bigint
  wantChain?: string; wantLock?: Address; wantToken?: Address; wantAmount?: bigint
}

export const lockCall = (hashLock: Address, l: LockArgs): Call => ({
  to: hashLock, data: encodeFunctionData({ abi: hashLockAbi, functionName: 'lock', args: [l.token, l.amount, l.recipient, l.hash,
    l.timeoutBlock, l.wantChain ?? '', l.wantLock ?? zeroAddress, l.wantToken ?? zeroAddress, l.wantAmount ?? 0n] }),
})
export const claimCall = (hashLock: Address, id: bigint, secret: Hex): Call =>
  ({ to: hashLock, data: encodeFunctionData({ abi: hashLockAbi, functionName: 'claim', args: [id, secret] }) })
export const refundCall = (hashLock: Address, id: bigint): Call =>
  ({ to: hashLock, data: encodeFunctionData({ abi: hashLockAbi, functionName: 'refund', args: [id] }) })
