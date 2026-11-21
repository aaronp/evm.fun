import { decodeFunctionResult, encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem'
import type { Request } from '@evmb/assets'
import { poolAbi } from './abi'
import type { PoolState } from './maths'

const abi = [...poolAbi, ...erc20Abi]
export async function call(request: Request, to: Address, functionName: string, args: unknown[] = []): Promise<any> {
  const data = encodeFunctionData({ abi, functionName, args } as any)
  const out = (await request('eth_call', [{ to, data }, 'latest'])) as Hex
  return decodeFunctionResult({ abi, functionName, data: out } as any)
}

/** The pool's tokens, decimals, reserves and LP supply, read live. */
export async function readPool(request: Request, pool: Address): Promise<PoolState> {
  const [base, quote, [reserveBase, reserveQuote], totalShares] = await Promise.all(
    (['base', 'quote', 'reserves', 'totalSupply'] as const).map(f => call(request, pool, f)))
  const [baseDecimals, quoteDecimals] = await Promise.all([base, quote].map(t => call(request, t, 'decimals')))
  return { address: pool, base, quote, baseDecimals, quoteDecimals, reserveBase, reserveQuote, totalShares }
}

/** `owner`'s LP shares, their share of the pool (bps, 2 dp of a bp) and what removing them all would pay. */
export async function position(request: Request, state: PoolState, owner: Address) {
  const shares = (await call(request, state.address, 'balanceOf', [owner])) as bigint
  const S = state.totalShares
  if (S === 0n || shares === 0n) return { shares, shareBps: 0, base: 0n, quote: 0n }
  return { shares, shareBps: Number(shares * 1_000_000n / S) / 100, base: shares * state.reserveBase / S, quote: shares * state.reserveQuote / S }
}
