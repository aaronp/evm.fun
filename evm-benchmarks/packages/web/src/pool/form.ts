import { ceilDiv, type PoolState } from '@evmb/pool'
import { exactText } from '../swap/ui'
import { shareText } from './ui'

type Tok = { symbol: string; decimals: number }

/** Slippage tolerances in bps: 0.1% / 0.5% / 1%; 0.5% is the default. */
export const SLIPPAGES = [[10, '0.1%'], [50, '0.5%'], [100, '1%']] as const
export const DEFAULT_SLIPPAGE = 50

/** `v` less the tolerance (floor), as Swap's minOut, Add's minShares and Remove's minimums. */
export const minAt = (v: bigint, bps: number) => v * BigInt(10000 - bps) / 10000n

/** What to approve: approve() sets the allowance, so the whole need when it falls short; 0 when covered or not read yet. */
export const approveFor = (need: bigint, allowance?: bigint) => (allowance !== undefined && allowance < need ? need : 0n)

/** The other side of a deposit at the pool's ratio, rounded so `quoteAdd` pulls exactly it (the pool has liquidity). */
export function fillOther(s: PoolState, typed: 'base' | 'quote', v: bigint): bigint {
  const S = s.totalShares
  const [rTyped, rOther] = typed === 'base' ? [s.reserveBase, s.reserveQuote] : [s.reserveQuote, s.reserveBase]
  return ceilDiv(v * S / rTyped * rOther, S)
}

/** 25 / 50 / 75 / 100 percent of `shares` (floor; 100 is all of them). */
export const percentOf = (shares: bigint, pct: number) => shares * BigInt(pct) / 100n

/** Your share after minting `add` on top of `mine`; a first deposit also mints 1000 to dEaD. */
export const newShareText = (s: PoolState, mine: bigint, add: bigint) => shareText(mine + add, (s.totalShares || 1000n) + add)

/** Reserves after paying `amountIn` of base (or quote) and taking `out` of the other. */
export const swapAfter = (s: Pick<PoolState, 'reserveBase' | 'reserveQuote'>, payBase: boolean, amountIn: bigint, out: bigint) =>
  payBase ? { reserveBase: s.reserveBase + amountIn, reserveQuote: s.reserveQuote - out }
    : { reserveBase: s.reserveBase - out, reserveQuote: s.reserveQuote + amountIn }

/** A decoded revert as a sentence; `unit(out, min)` is the token a Slippage(out, min) is counted in. */
export function revertText(e: { error: string; args: unknown[] }, unit: (out: bigint, min: bigint) => Tok) {
  if (e.error === 'Slippage') {
    const [out, min] = e.args as [bigint, bigint], t = unit(out, min)
    return `Slippage — you would get ${exactText(out, t.decimals)} ${t.symbol}, below your minimum ${exactText(min, t.decimals)} ${t.symbol}.`
  }
  return e.args.length ? `${e.error}(${e.args.map(String).join(', ')})` : e.error
}
