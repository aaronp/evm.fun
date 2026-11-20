import { encodeFunctionData, type Address, type Hex } from 'viem'
import { swapAbi } from './abi'

type Call = { to: Address; data: Hex }

export const makeOfferCall = (swap: Address, giveToken: Address, giveAmt: bigint, getToken: Address, getAmt: bigint): Call =>
  ({ to: swap, data: encodeFunctionData({ abi: swapAbi, functionName: 'makeOffer', args: [giveToken, giveAmt, getToken, getAmt] }) })
export const takeCall = (swap: Address, id: bigint): Call =>
  ({ to: swap, data: encodeFunctionData({ abi: swapAbi, functionName: 'take', args: [id] }) })
export const cancelCall = (swap: Address, id: bigint): Call =>
  ({ to: swap, data: encodeFunctionData({ abi: swapAbi, functionName: 'cancel', args: [id] }) })
