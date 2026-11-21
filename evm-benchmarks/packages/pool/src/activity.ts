import { decodeEventLog, encodeEventTopics, getAddress, toHex, type Address, type Hash, type Hex } from 'viem'
import type { Request } from '@evmb/assets'
import { poolAbi } from './abi'

/** One pool event. `base`/`quote` are the amounts moved for add/remove, and the post-swap reserves for a swap. */
export type PoolActivity = {
  kind: 'add' | 'remove' | 'swap'; who: Address; base: bigint; quote: bigint
  shares?: bigint; tokenIn?: Address; amountIn?: bigint; amountOut?: bigint; tx: Hash; block: bigint
}
type RpcLog = { topics: [Hex, ...Hex[]]; data: Hex; blockNumber: Hex; transactionHash: Hash }

const topics = (['LiquidityAdded', 'LiquidityRemoved', 'Swapped'] as const).map(eventName => encodeEventTopics({ abi: poolAbi, eventName })[0])

/** The pool's adds, removes and swaps since `fromBlock` (its deploy block), newest first. */
export async function activity(request: Request, pool: Address, fromBlock: bigint): Promise<PoolActivity[]> {
  // ponytail: reads every event since deploy on each call, O(chain); a bounded window or an index when pools get busy (ADR-0019)
  const logs = (await request('eth_getLogs', [{ address: pool, fromBlock: toHex(fromBlock), toBlock: 'latest', topics: [topics] }])) as RpcLog[]
  return logs.map(l => {
    const at = { tx: l.transactionHash, block: BigInt(l.blockNumber) }
    const e = decodeEventLog({ abi: poolAbi, ...l })
    if (e.eventName === 'Swapped') {
      const { trader, tokenIn, amountIn, amountOut, reserveBase, reserveQuote } = e.args
      return { kind: 'swap' as const, who: getAddress(trader), base: reserveBase, quote: reserveQuote, tokenIn: getAddress(tokenIn), amountIn, amountOut, ...at }
    }
    if (e.eventName !== 'LiquidityAdded' && e.eventName !== 'LiquidityRemoved') throw new Error(`unexpected ${e.eventName}`)
    const { provider, base, quote, shares } = e.args
    return { kind: e.eventName === 'LiquidityAdded' ? 'add' as const : 'remove' as const, who: getAddress(provider), base, quote, shares, ...at }
  }).reverse() // eth_getLogs returns chain order
}
