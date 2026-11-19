import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, erc20Abi } from 'viem'
import { AssetToken, AtomicSwap } from '@evmb/contracts'
import { MAX_UINT256, approveCall, assetId, isErc20Abi, isMintable, mintCall, nativeAsset, transferCall, type Asset } from '../src'

const ADDR = '0x00000000000000000000000000000000000000aa' as const
const TO = '0x00000000000000000000000000000000000000bb' as const
const token: Asset = {
  id: assetId('c1', ADDR), chainId: 'c1', kind: 'erc20', address: ADDR, symbol: 'T', name: 'T',
  decimals: 18, origin: 'launched', mintable: true, addedAt: '2026-01-01',
}

describe('abi detection', () => {
  test('isErc20Abi', () => {
    expect(isErc20Abi(erc20Abi)).toBe(true)
    expect(isErc20Abi(AssetToken.abi)).toBe(true)
    expect(isErc20Abi(AtomicSwap.abi)).toBe(false)
  })
  test('isMintable', () => {
    expect(isMintable(AssetToken.abi)).toBe(true)
    expect(isMintable(erc20Abi)).toBe(false)
  })
})

describe('calldata', () => {
  test('approve unlimited decodes back', () => {
    const c = approveCall(token, TO, MAX_UINT256)
    expect(c.to).toBe(ADDR)
    const d = decodeFunctionData({ abi: erc20Abi, data: c.data })
    expect(d.functionName).toBe('approve')
    expect(d.args).toEqual([TO, MAX_UINT256])
  })
  test('transfer and mint', () => {
    expect(decodeFunctionData({ abi: erc20Abi, data: transferCall(token, TO, 5n).data }).args).toEqual([TO, 5n])
    expect(decodeFunctionData({ abi: AssetToken.abi, data: mintCall(token, TO, 7n).data }).functionName).toBe('mint')
  })
  test('native has no contract', () => {
    const n = nativeAsset('c1')
    for (const f of [transferCall, approveCall, mintCall]) expect(() => f(n, TO, 1n)).toThrow('Native asset has no contract')
  })
})
