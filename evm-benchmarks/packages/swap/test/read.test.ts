import { expect, test } from 'bun:test'
import { AssetToken, Swap } from '@evmb/contracts'
import { readOffers } from '../src'
import { maker, taker, withSwap } from './chain'

test('readOffers returns made, taken and cancelled offers with statuses', () =>
  withSwap(async ({ request, swap, gbp, usd, send }) => {
    expect(await readOffers(request, swap)).toEqual([])
    await send(maker, gbp, AssetToken.abi, 'approve', [swap, 300n])
    for (const g of [100n, 100n, 100n]) await send(maker, swap, Swap.abi, 'makeOffer', [gbp, g, usd, g * 12_700n])
    await send(taker, usd, AssetToken.abi, 'approve', [swap, 10n ** 9n])
    expect(await send(taker, swap, Swap.abi, 'take', [1n])).toBe('success')
    expect(await send(maker, swap, Swap.abi, 'cancel', [2n])).toBe('success')
    const offers = await readOffers(request, swap)
    expect(offers.map(o => [o.id, o.status])).toEqual([[1n, 'filled'], [2n, 'cancelled'], [3n, 'open']])
    expect(offers[2]).toEqual({ id: 3n, maker: maker.address, giveToken: gbp, giveAmt: 100n, getToken: usd, getAmt: 1_270_000n, status: 'open' })
  }), 60_000)
