import type { Address } from 'viem'
import type { Level, Market, Order, OrderInput, OrderReport, PlaceResult, Trade, Wallet } from './types'

/** JSON-RPC `request` (as `@evmb/assets`'s `Request`). */
export type Request = (method: string, params: unknown[]) => Promise<unknown>

/** One trading venue: the page talks only to this, whichever design is behind it. */
export interface Venue {
  kind: 'onchain' | 'offchain'
  /** best first; `depth` price levels per side (default 10) */
  book(m: Market, depth?: number): Promise<{ bids: Level[]; asks: Level[] }>
  /** fills now and rests the remainder (limit); throws, sending nothing, when the order can't go (thin book, funds) */
  place(wallet: Wallet, o: OrderInput): Promise<PlaceResult>
  cancel(wallet: Wallet, id: string): Promise<void>
  orders(q: { owner?: Address; market?: Market; status?: Order['status'][] }): Promise<Order[]>
  /** newest first */
  trades(m: Market, limit?: number): Promise<Trade[]>
  /** What `owner`'s live orders here still claim of `asset` from their balance and allowance. Off-chain: the remaining
   * give of their open, partial and unfunded orders (all of them share one balance and one allowance to Settlement);
   * on-chain 0 (an order escrows its give when placed). A new order needs its own give plus this. */
  committed(owner: Address, asset: Address): Promise<bigint>
  /** what happened to one order; `tx:<hash>` for a failed attempt */
  report(id: string): Promise<OrderReport>
}
