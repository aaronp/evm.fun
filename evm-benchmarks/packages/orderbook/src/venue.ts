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
  /** what happened to one order; `tx:<hash>` for a failed attempt */
  report(id: string): Promise<OrderReport>
}
