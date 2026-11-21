import { encodeFunctionData, type Address, type Hex } from 'viem'
import { poolAbi } from './abi'

type Call = { to: Address; data: Hex }

// Amounts are in the pool's on-chain (base, quote) order, not an oriented state's.
export const addLiquidityCall = (pool: Address, baseIn: bigint, quoteIn: bigint, minShares: bigint): Call =>
  ({ to: pool, data: encodeFunctionData({ abi: poolAbi, functionName: 'addLiquidity', args: [baseIn, quoteIn, minShares] }) })
export const removeLiquidityCall = (pool: Address, shares: bigint, minBase: bigint, minQuote: bigint): Call =>
  ({ to: pool, data: encodeFunctionData({ abi: poolAbi, functionName: 'removeLiquidity', args: [shares, minBase, minQuote] }) })
export const swapCall = (pool: Address, tokenIn: Address, amountIn: bigint, minOut: bigint): Call =>
  ({ to: pool, data: encodeFunctionData({ abi: poolAbi, functionName: 'swap', args: [tokenIn, amountIn, minOut] }) })
