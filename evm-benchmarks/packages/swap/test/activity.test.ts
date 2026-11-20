import { expect, test } from 'bun:test'
import { AssetToken, Swap } from '@evmb/contracts'
import { toFunctionSelector } from 'viem'
import { activity } from '../src'
import { maker, other, taker, withSwap } from './chain'

const erc = AssetToken.abi

test('activity lists offered, approved, taken, cancelled and reverted, newest first', () =>
  withSwap(async ({ request, swap, gbp, usd, send, tx }) => {
    const approveGbp = await tx(maker, gbp, erc, 'approve', [swap, 200n])
    await send(maker, gbp, erc, 'approve', [other.address, 5n]) // other spender: ignored
    const make1 = await tx(maker, swap, Swap.abi, 'makeOffer', [gbp, 100n, usd, 1_270_000n])
    const make2 = await tx(maker, swap, Swap.abi, 'makeOffer', [gbp, 100n, usd, 1_280_000n])
    const approveUsd = await tx(taker, usd, erc, 'approve', [swap, 10n ** 9n])
    const take1 = await tx(taker, swap, Swap.abi, 'take', [1n])
    const cancel2 = await tx(maker, swap, Swap.abi, 'cancel', [2n])
    const take2 = await tx(taker, swap, Swap.abi, 'take', [2n]) // reverts: cancelled

    const items = await activity(request, swap, [gbp, usd])
    expect(items.map(i => [i.kind, i.tx])).toEqual([
      ['reverted', take2], ['cancelled', cancel2], ['taken', take1], ['approved', approveUsd],
      ['offered', make2], ['offered', make1], ['approved', approveGbp],
    ])
    expect(items[0]).toMatchObject({ id: 2n, actor: taker.address, reason: 'cancelled', txIndex: 0 })
    expect(items[1]).toMatchObject({ id: 2n, actor: maker.address })
    expect(items[2]).toMatchObject({ id: 1n, actor: taker.address })
    expect(items[3]).toMatchObject({ actor: taker.address, token: usd, amount: 10n ** 9n })
    expect(items[4]).toMatchObject({ id: 2n, actor: maker.address, token: gbp, amount: 100n })
    expect(items[6]).toMatchObject({ actor: maker.address, token: gbp, amount: 200n })
    expect(items[0]!.block).toBeGreaterThan(items[1]!.block)

    // approvals of tokens outside the pair are left out
    expect((await activity(request, swap, [gbp])).map(i => i.tx)).not.toContain(approveUsd)
  }), 60_000)

test('a reverted tx to Swap with the take selector but undecodable input is skipped, not fatal', () =>
  withSwap(async ({ request, swap, gbp, usd, send, sendData }) => {
    await send(maker, gbp, erc, 'approve', [swap, 100n])
    await send(maker, swap, Swap.abi, 'makeOffer', [gbp, 100n, usd, 1_270_000n])
    const bad = await sendData(taker, swap, toFunctionSelector('take(uint256)')) // no argument: the Swap reverts
    expect(((await request('eth_getTransactionReceipt', [bad])) as { status: string }).status).toBe('0x0')
    const items = await activity(request, swap, [gbp, usd])
    expect(items.map(i => i.kind)).toEqual(['offered', 'approved'])
  }), 60_000)
