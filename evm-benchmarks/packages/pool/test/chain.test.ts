import { expect, test } from 'bun:test'
import { encodeErrorResult, getAddress, type Address } from 'viem'
import { Pool } from '@evmb/contracts'
import {
  activity, addLiquidityCall, decodePoolError, findPool, orient, poolPrice, position, quoteAdd, quoteRemove, quoteSwap,
  readPool, removeLiquidityCall, swapCall,
} from '../src'
import { lp, trader, withChain } from './chain'

const ev = (r: { events: { eventName: string; args: any }[] }, name: string) => r.events.find(e => e.eventName === name)!.args

// Review Focus 1 + 2: every quote equals what the contract then does, to the raw unit.
for (const pair of ['2/6', '18/18'] as const) {
  test(`quotes equal the contract to the unit (${pair} dp): first add, unbalanced adds, swaps both ways, removes`, () =>
    withChain(async ({ request, gbp, usd, a18, b18, deployPool, send }) => {
      const [base, quote] = pair === '2/6' ? [gbp, usd] : [a18, b18]
      const u = pair === '2/6' ? [100n, 10n ** 6n] : [10n ** 18n, 10n ** 18n] // one whole base, one whole quote
      const pool = await deployPool(base, quote)

      const add = async (who: typeof lp, b: bigint, q: bigint) => {
        const want = quoteAdd(await readPool(request, pool), b, q)
        const r = await send(who, addLiquidityCall(pool, b, q, want.shares))
        expect(r.status).toBe('success')
        expect(ev(r, 'LiquidityAdded')).toEqual({ provider: who.address, base: want.baseUsed, quote: want.quoteUsed, shares: want.shares })
      }
      const swap = async (tokenIn: Address, amountIn: bigint) => {
        const before = await readPool(request, pool)
        const want = quoteSwap(before, tokenIn, amountIn, 50)
        const r = await send(trader, swapCall(pool, tokenIn, amountIn, want.out)) // minOut = out: must not revert
        expect(r.status).toBe('success')
        expect(ev(r, 'Swapped').amountOut).toBe(want.out)
        expect(poolPrice(await readPool(request, pool))).toBe(want.priceAfter)
      }
      const remove = async (who: typeof lp, shares: bigint) => {
        const want = quoteRemove(await readPool(request, pool), shares)
        const r = await send(who, removeLiquidityCall(pool, shares, want.base, want.quote))
        expect(r.status).toBe('success')
        expect(ev(r, 'LiquidityRemoved')).toEqual({ provider: who.address, base: want.base, quote: want.quote, shares })
      }

      await add(lp, 50_000n * u[0]! + 7n, 63_500n * u[1]! + 3n) // first deposit (odd raw amounts)
      await add(trader, 1_000n * u[0]!, 5_000n * u[1]!) // unbalanced: quote-heavy, the surplus stays with the trader
      await add(trader, 333n * u[0]! + 1n, 1n * u[1]!) // unbalanced: base-heavy
      await add(lp, 1_234n * u[0]! + 5n, 1_567n * u[1]! + 9n)
      for (const [t, amt] of [[base, 1_000n * u[0]!], [quote, 777n * u[1]! + 13n], [base, 3n], [quote, 12_345n * u[1]!], [base, 99_999n]] as const)
        await swap(t, amt)
      const pos = await position(request, await readPool(request, pool), trader.address)
      expect(pos.shares > 0n).toBe(true)
      expect(quoteRemove(await readPool(request, pool), pos.shares)).toEqual({ base: pos.base, quote: pos.quote })
      await remove(trader, pos.shares / 3n)
      await remove(trader, pos.shares - pos.shares / 3n)
      expect((await position(request, await readPool(request, pool), trader.address)).shares).toBe(0n)
      await swap(quote, 50n * u[1]!)
      await remove(lp, (await position(request, await readPool(request, pool), lp.address)).shares)
      const s = await readPool(request, pool)
      expect(s.totalShares).toBe(1000n) // only the locked shares remain
    }), 120_000)
}

test('readPool and position read the chain', () =>
  withChain(async ({ request, gbp, usd, deployPool, send }) => {
    const pool = await deployPool(gbp, usd)
    expect(await readPool(request, pool)).toEqual({ address: pool, base: gbp, quote: usd, baseDecimals: 2, quoteDecimals: 6, reserveBase: 0n, reserveQuote: 0n, totalShares: 0n })
    await send(lp, addLiquidityCall(pool, 5_000_000n, 63_500_000_000n, 0n))
    const s = await readPool(request, pool)
    expect([s.reserveBase, s.reserveQuote]).toEqual([5_000_000n, 63_500_000_000n])
    const p = await position(request, s, lp.address)
    expect(p.shares).toBe(s.totalShares - 1000n)
    expect(p.shareBps).toBeCloseTo(10000, 1) // all but the 1000 locked raw shares
    expect([p.base, p.quote]).toEqual([p.shares * s.reserveBase / s.totalShares, p.shares * s.reserveQuote / s.totalShares])
    expect(await position(request, s, trader.address)).toEqual({ shares: 0n, shareBps: 0, base: 0n, quote: 0n })
  }), 60_000)

test('findPool matches either order, newest wins, skips foreign records; orient flips the price', () =>
  withChain(async ({ request, gbp, usd, a18, b18, deployPool, send }) => {
    const old = await deployPool(usd, gbp)
    const other = await deployPool(a18, b18)
    const pool = await deployPool(usd, gbp) // (USD, GBP)
    const rec = (address: Address, name = 'Pool', abi: any = Pool.abi) => ({ name, address, abi })
    const records = [rec(old), rec(other), rec(pool), rec(gbp, 'Pool', [{ type: 'function', name: 'x', inputs: [], outputs: [] }]), rec(a18, 'Token')]
    expect(await findPool(request, records, gbp, usd)).toBe(pool)
    expect(await findPool(request, records, usd, gbp)).toBe(pool)
    expect(await findPool(request, records, b18, a18)).toBe(other)
    expect(await findPool(request, records, gbp, a18)).toBeUndefined()
    expect(await findPool(request, [rec(getAddress('0x00000000000000000000000000000000000000ff'))], gbp, usd)).toBeUndefined() // no code
    // 127,000 USD / 100,000 GBP: the pool's price is 0.787… GBP per USD; the GBP/USD page sees 1.27 USD per GBP
    await send(lp, addLiquidityCall(pool, 127_000_000_000n, 10_000_000n, 0n))
    const s = await readPool(request, pool)
    expect(poolPrice(s)).toBe(78n)
    const o = orient(s, gbp, usd)
    expect([o.base, o.reserveBase, o.baseDecimals, o.reserveQuote, o.quoteDecimals]).toEqual([gbp, 10_000_000n, 2, 127_000_000_000n, 6])
    expect(poolPrice(o)).toBe(1_270_000n)
    expect(quoteSwap(o, gbp, 100_000n, 50).price).toBe(1_253_690n)
  }), 60_000)

test('activity lists add, swaps and remove newest first; swaps carry post-swap reserves', () =>
  withChain(async ({ request, gbp, usd, deployPool, send }) => {
    const pool = await deployPool(gbp, usd)
    const from = BigInt((await request('eth_blockNumber', [])) as string)
    const a = await send(lp, addLiquidityCall(pool, 10_000_000n, 127_000_000_000n, 0n))
    const s1 = await send(trader, swapCall(pool, gbp, 100_000n, 0n))
    const s2 = await send(trader, swapCall(pool, usd, 5_000_000n, 0n))
    const shares = ev(a, 'LiquidityAdded').shares as bigint
    const r = await send(lp, removeLiquidityCall(pool, shares / 2n, 0n, 0n))
    const items = await activity(request, pool, from)
    expect(items.map(i => [i.kind, i.tx])).toEqual([['remove', r.hash], ['swap', s2.hash], ['swap', s1.hash], ['add', a.hash]])
    expect(items[3]).toMatchObject({ who: lp.address, base: 10_000_000n, quote: 127_000_000_000n, shares })
    const sw = ev(s1, 'Swapped')
    expect(items[2]).toMatchObject({ who: trader.address, tokenIn: gbp, amountIn: 100_000n, amountOut: sw.amountOut, base: 10_100_000n, quote: 127_000_000_000n - sw.amountOut })
    expect(items[1]).toMatchObject({ tokenIn: usd, amountIn: 5_000_000n })
    expect(items[0]).toMatchObject({ who: lp.address, shares: shares / 2n, base: ev(r, 'LiquidityRemoved').base })
    expect(items[0]!.block > items[3]!.block).toBe(true)
    expect(await activity(request, pool, items[0]!.block + 1n)).toEqual([])
  }), 60_000)

test('decodePoolError decodes all four Pool errors from real reverts', () =>
  withChain(async ({ request, gbp, usd, a18, deployPool, send, revertData }) => {
    const pool = await deployPool(gbp, usd)
    expect(decodePoolError(await revertData(trader, swapCall(pool, gbp, 100n, 0n)))).toEqual({ name: 'NoLiquidity', args: {} })
    await send(lp, addLiquidityCall(pool, 10_000_000n, 127_000_000_000n, 0n))
    expect(decodePoolError(await revertData(lp, addLiquidityCall(pool, 1n, 0n, 0n)))).toEqual({ name: 'BadAmount', args: {} })
    expect(decodePoolError(await revertData(trader, swapCall(pool, a18, 100n, 0n)))).toEqual({ name: 'BadToken', args: {} })
    const out = quoteSwap(await readPool(request, pool), gbp, 100n, 0).out
    expect(decodePoolError(await revertData(trader, swapCall(pool, gbp, 100n, out + 1n)))).toEqual({ name: 'Slippage', args: { out, min: out + 1n } })
  }), 60_000)

test('decodePoolError: ERC-20 errors, Error/Panic, unknown data', () => {
  expect(decodePoolError('0x')).toBeUndefined()
  expect(decodePoolError('0xdeadbeef')).toBeUndefined()
  const abi = [{ type: 'error', name: 'Panic', inputs: [{ name: 'code', type: 'uint256' }] }] as const
  expect(decodePoolError(encodeErrorResult({ abi, errorName: 'Panic', args: [0x11n] }))).toEqual({ name: 'Panic', args: { code: 0x11n } })
  const ins = encodeErrorResult({ abi: Pool.abi, errorName: 'ERC20InsufficientBalance', args: [lp.address, 1n, 2n] })
  expect(decodePoolError(ins)).toEqual({ name: 'ERC20InsufficientBalance', args: { sender: lp.address, balance: 1n, needed: 2n } })
})

test('findPool: a record that is not a pool is skipped; a transport error propagates (no duplicate deploy offered)', () =>
  withChain(async ({ request, gbp, usd, deployPool }) => {
    const pool = await deployPool(gbp, usd)
    const rec = (address: Address) => ({ name: 'Pool', address, abi: Pool.abi as any })
    expect(await findPool(request, [rec(pool), rec(gbp)], gbp, usd)).toBe(pool) // gbp reverts base(): skipped
    const down = (async (m: string, p?: unknown[]) => { if (m === 'eth_call') throw new Error('fetch failed'); return request(m, p as any) }) as typeof request
    await expect(findPool(down, [rec(pool)], gbp, usd)).rejects.toThrow('fetch failed')
  }), 60_000)
