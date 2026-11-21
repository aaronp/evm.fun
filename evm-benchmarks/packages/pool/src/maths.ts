import { isAddressEqual, type Address } from 'viem'

/** A pool as read from the chain (`readPool`), or as seen from a page's (base, quote) (`orient`). */
export type PoolState = {
  address: Address; base: Address; quote: Address; baseDecimals: number; quoteDecimals: number
  reserveBase: bigint; reserveQuote: bigint; totalShares: bigint
}

const pow10 = (n: number) => 10n ** BigInt(n)
const div = (a: bigint, b: bigint) => (b === 0n ? 0n : a / b)
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b
/** bps of `a / b` as a number with 2 decimals of a bp, e.g. 99.0099 → 99.0 */
const bps = (a: bigint, b: bigint) => Number(div(a * 1_000_000n, b)) / 100

/** Floor square root, equal to OpenZeppelin `Math.sqrt` for every uint256. */
export const isqrt = (n: bigint): bigint => {
  if (n < 2n) return n
  let x = n, y = (n + 1n) / 2n
  while (y < x) [x, y] = [y, (y + n / y) / 2n]
  return x
}

/** Pool.sol `swap` output: 30 bps fee on input, floored. 0 when the pool is empty. */
export const amountOut = (amountIn: bigint, rIn: bigint, rOut: bigint): bigint =>
  div(amountIn * 9970n * rOut, rIn * 10000n + amountIn * 9970n)

/** Pool price: quote raw units per one whole base (as @evmb/orderbook), floored; 0 when empty. */
export const poolPrice = (s: PoolState): bigint => div(s.reserveQuote * pow10(s.baseDecimals), s.reserveBase)

/**
 * What `swap(tokenIn, amountIn, minOut)` would do now. Prices are quote raw per whole base in the state's orientation:
 * `price` is the execution price, `priceNow`/`priceAfter` the pool price before/after. `impactBps` is the price impact
 * excluding the fee (no-fee execution price vs `priceNow`: amountIn / (rIn + amountIn)). `fee` is in the input token.
 */
export function quoteSwap(s: PoolState, tokenIn: Address, amountIn: bigint, slippageBps: number) {
  const baseIn = isAddressEqual(tokenIn, s.base)
  const [rIn, rOut] = baseIn ? [s.reserveBase, s.reserveQuote] : [s.reserveQuote, s.reserveBase]
  const out = amountOut(amountIn, rIn, rOut)
  const one = pow10(s.baseDecimals)
  const price = baseIn ? div(out * one, amountIn) : div(amountIn * one, out)
  const after = out === 0n ? s
    : baseIn ? { ...s, reserveBase: s.reserveBase + amountIn, reserveQuote: s.reserveQuote - out }
    : { ...s, reserveBase: s.reserveBase - out, reserveQuote: s.reserveQuote + amountIn }
  return {
    out, fee: amountIn * 30n / 10000n, price, priceNow: poolPrice(s), priceAfter: poolPrice(after),
    impactBps: out === 0n ? 0 : bps(amountIn, rIn + amountIn),
    minOut: out * BigInt(10000 - slippageBps) / 10000n,
  }
}

/** What `addLiquidity(baseIn, quoteIn, _)` would mint and pull. `shares` 0 means the contract reverts `BadAmount`. */
export function quoteAdd(s: PoolState, baseIn: bigint, quoteIn: bigint) {
  const S = s.totalShares
  if (S === 0n) {
    const root = isqrt(baseIn * pow10(18 - s.baseDecimals) * quoteIn * pow10(18 - s.quoteDecimals))
    return root <= 1000n ? { shares: 0n, baseUsed: 0n, quoteUsed: 0n } : { shares: root - 1000n, baseUsed: baseIn, quoteUsed: quoteIn }
  }
  const a = baseIn * S / s.reserveBase, b = quoteIn * S / s.reserveQuote
  const shares = a < b ? a : b
  return { shares, baseUsed: ceilDiv(shares * s.reserveBase, S), quoteUsed: ceilDiv(shares * s.reserveQuote, S) }
}

/** What `removeLiquidity(shares, _, _)` would pay out (floor). */
export const quoteRemove = (s: PoolState, shares: bigint) =>
  ({ base: div(shares * s.reserveBase, s.totalShares), quote: div(shares * s.reserveQuote, s.totalShares) })

/** `s` seen from the page's (base, quote): fields swap when the pool's base is the page's quote. Calls still take the pool's order. */
export function orient(s: PoolState, base: Address, quote: Address): PoolState {
  if (isAddressEqual(s.base, base) && isAddressEqual(s.quote, quote)) return s
  if (!isAddressEqual(s.base, quote) || !isAddressEqual(s.quote, base)) throw new Error('Pool is not for this pair')
  return { ...s, base: s.quote, quote: s.base, baseDecimals: s.quoteDecimals, quoteDecimals: s.baseDecimals, reserveBase: s.reserveQuote, reserveQuote: s.reserveBase }
}
