import { expect, test } from 'bun:test'
import { decodeFunctionData, erc20Abi, type Address } from 'viem'
import { AtomicSwap, Swap } from '@evmb/contracts'
import { cancelCall, findSwap, isSwapAbi, makeOfferCall, swapAbi, takeCall } from '../src'

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address

test('embedded swapAbi equals the contracts package Swap.abi', () => {
  expect(swapAbi as unknown).toEqual(Swap.abi)
})
test('isSwapAbi', () => {
  expect(isSwapAbi(Swap.abi as any)).toBe(true)
  expect(isSwapAbi(erc20Abi)).toBe(false)
  expect(isSwapAbi(AtomicSwap.abi as any)).toBe(false)
  // an older/foreign Swap whose offers(id) has another layout is not ours
  const older = Swap.abi.map(e => (e.type === 'function' && e.name === 'offers' ? { ...e, outputs: e.outputs.slice(0, 6) } : e))
  expect(isSwapAbi(older as any)).toBe(false)
})
test('findSwap picks the last Swap record and ignores a Swap-named non-Swap ABI', () => {
  const r = (name: string, address: Address, abi: any) => ({ name, address, abi })
  expect(findSwap([])).toBeUndefined()
  expect(findSwap([r('Swap', a(1), Swap.abi), r('Swap', a(2), Swap.abi), r('Other', a(3), Swap.abi)])).toBe(a(2))
  expect(findSwap([r('Swap', a(1), Swap.abi), r('Swap', a(2), erc20Abi)])).toBe(a(1))
  expect(findSwap([r('Swap', a(2), erc20Abi)])).toBeUndefined()
})
test('calls decode back', () => {
  const m = makeOfferCall(a(1), a(2), 5n, a(3), 7n)
  expect(m.to).toBe(a(1))
  expect(decodeFunctionData({ abi: swapAbi, data: m.data })).toEqual({ functionName: 'makeOffer', args: [a(2), 5n, a(3), 7n] })
  expect(decodeFunctionData({ abi: swapAbi, data: takeCall(a(1), 4n).data })).toEqual({ functionName: 'take', args: [4n] })
  expect(decodeFunctionData({ abi: swapAbi, data: cancelCall(a(1), 9n).data })).toEqual({ functionName: 'cancel', args: [9n] })
})
