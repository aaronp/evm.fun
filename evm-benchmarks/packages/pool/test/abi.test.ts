import { expect, test } from 'bun:test'
import { decodeFunctionData, erc20Abi, type Address } from 'viem'
import { Pool, Swap } from '@evmb/contracts'
import { addLiquidityCall, isPoolAbi, poolAbi, removeLiquidityCall, swapCall } from '../src'

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address

test('embedded poolAbi equals the contracts package Pool.abi', () => {
  expect(poolAbi as unknown).toEqual(Pool.abi)
})
test('isPoolAbi', () => {
  expect(isPoolAbi(Pool.abi)).toBe(true)
  expect(isPoolAbi(erc20Abi)).toBe(false)
  expect(isPoolAbi(Swap.abi)).toBe(false)
})
test('calls decode back', () => {
  const add = addLiquidityCall(a(1), 5n, 7n, 3n)
  expect(add.to).toBe(a(1))
  expect(decodeFunctionData({ abi: poolAbi, data: add.data })).toEqual({ functionName: 'addLiquidity', args: [5n, 7n, 3n] })
  expect(decodeFunctionData({ abi: poolAbi, data: removeLiquidityCall(a(1), 4n, 1n, 2n).data })).toEqual({ functionName: 'removeLiquidity', args: [4n, 1n, 2n] })
  expect(decodeFunctionData({ abi: poolAbi, data: swapCall(a(1), a(2), 9n, 8n).data })).toEqual({ functionName: 'swap', args: [a(2), 9n, 8n] })
})
