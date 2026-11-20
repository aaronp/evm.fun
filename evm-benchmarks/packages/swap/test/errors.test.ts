import { expect, test } from 'bun:test'
import { AssetToken, Swap } from '@evmb/contracts'
import { encodeErrorResult } from 'viem'
import { cancelCall, decodeSwapError, makeOfferCall, statusName, takeCall } from '../src'
import { maker, taker, withSwap } from './chain'

test('decodeSwapError decodes real revert data for each error', () =>
  withSwap(async ({ swap, gbp, usd, send, revertData }) => {
    const erc = AssetToken.abi
    expect(decodeSwapError(await revertData(maker, swap, makeOfferCall(swap, gbp, 0n, usd, 1n).data))).toEqual({ name: 'BadOffer', args: {} })
    await send(maker, gbp, erc, 'approve', [swap, 100_000n])
    await send(maker, swap, Swap.abi, 'makeOffer', [gbp, 100_000n, usd, 127_000_000n])
    expect(decodeSwapError(await revertData(taker, swap, cancelCall(swap, 1n).data))).toEqual({ name: 'NotMaker', args: { id: 1n } })
    // short allowance, then short balance
    await send(taker, usd, erc, 'approve', [swap, 126_999_999n])
    expect(decodeSwapError(await revertData(taker, swap, takeCall(swap, 1n).data))).toEqual({
      name: 'ERC20InsufficientAllowance', args: { spender: swap, allowance: 126_999_999n, needed: 127_000_000n },
    })
    await send(maker, swap, Swap.abi, 'cancel', [1n])
    expect(decodeSwapError(await revertData(taker, swap, takeCall(swap, 1n).data))).toEqual({
      name: 'OfferNotOpen', args: { id: 1n, status: 3 },
    })
    // balance: taker holds 5,000 USD but the offer asks 6,000
    await send(maker, gbp, erc, 'approve', [swap, 100n])
    await send(maker, swap, Swap.abi, 'makeOffer', [gbp, 100n, usd, 6_000_000_000n])
    await send(taker, usd, erc, 'approve', [swap, 10n ** 10n])
    expect(decodeSwapError(await revertData(taker, swap, takeCall(swap, 2n).data))).toEqual({
      name: 'ERC20InsufficientBalance', args: { sender: taker.address, balance: 5_000_000_000n, needed: 6_000_000_000n },
    })
  }), 60_000)

test('decodeSwapError returns undefined for unknown data', () => {
  expect(decodeSwapError('0x')).toBeUndefined()
  expect(decodeSwapError('0xdeadbeef')).toBeUndefined()
})

test('decodeSwapError decodes Error(string) and Panic(uint256)', () => {
  const abi = [
    { type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] },
    { type: 'error', name: 'Panic', inputs: [{ name: 'code', type: 'uint256' }] },
  ] as const
  expect(decodeSwapError(encodeErrorResult({ abi, errorName: 'Error', args: ['nope'] }))).toEqual({ name: 'Error', args: { message: 'nope' } })
  expect(decodeSwapError(encodeErrorResult({ abi, errorName: 'Panic', args: [0x11n] }))).toEqual({ name: 'Panic', args: { code: 0x11n } })
})

test('statusName maps the contract Status enum', () => {
  expect([0, 1, 2, 3n].map(statusName)).toEqual(['none', 'open', 'filled', 'cancelled'])
})
