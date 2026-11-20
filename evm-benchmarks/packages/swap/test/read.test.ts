import { expect, test } from 'bun:test'
import { AssetToken, Swap } from '@evmb/contracts'
import { readOffers, takerOf } from '../src'
import { maker, taker, withSwap } from './chain'

test('readOffers returns made, taken and cancelled offers with statuses', () =>
  withSwap(async ({ request, swap, gbp, usd, send }) => {
    expect(await readOffers(request, swap)).toEqual([])
    await send(maker, gbp, AssetToken.abi, 'approve', [swap, 300n])
    for (const g of [100n, 100n, 100n]) await send(maker, swap, Swap.abi, 'makeOffer', [gbp, g, usd, g * 12_700n])
    await send(taker, usd, AssetToken.abi, 'approve', [swap, 10n ** 9n])
    expect(await send(taker, swap, Swap.abi, 'take', [1n])).toBe('success')
    const filledAt = BigInt(await request('eth_blockNumber', []) as string)
    expect(await send(maker, swap, Swap.abi, 'cancel', [2n])).toBe('success')
    const cancelledAt = BigInt(await request('eth_blockNumber', []) as string)
    const offers = await readOffers(request, swap)
    expect(offers.map(o => [o.id, o.status])).toEqual([[1n, 'filled'], [2n, 'cancelled'], [3n, 'open']])
    expect(offers[2]).toEqual({ id: 3n, maker: maker.address, giveToken: gbp, giveAmt: 100n, getToken: usd, getAmt: 1_270_000n, status: 'open' })
    expect(offers[0]).toMatchObject({ taker: taker.address, closedBlock: filledAt })
    expect(takerOf(offers[0]!)).toBe(taker.address)
    expect(takerOf(offers[1]!)).toBeUndefined()
    expect(offers[1]!.closedBlock).toBe(cancelledAt) // cancel stores its block too
    expect('taker' in offers[1]!).toBe(false)
  }), 60_000)
