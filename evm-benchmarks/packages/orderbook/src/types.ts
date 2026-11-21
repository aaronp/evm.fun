import type { Address, Hex, TransactionReceipt, TypedDataDefinition } from 'viem'

export type Side = 'buy' | 'sell' // of the base asset
export type Market = { base: Address; quote: Address } // ERC-20s on one chain
/** `slippageBps`: market orders only, how far past the furthest level needed the worst price may go (default 100). */
export type OrderInput = { market: Market; side: Side; type: 'limit' | 'market'; price?: bigint; amount: bigint; slippageBps?: number }
export type Order = {
  id: string; venue: 'onchain' | 'offchain'; owner: Address; market: Market; side: Side; price: bigint
  amount: bigint; filled: bigint; status: 'open' | 'partial' | 'filled' | 'cancelled' | 'failed' | 'unfunded'
  placedAt: { block?: bigint; time: string }
  /** failed only: the decoded revert error name, when the venue replayed it (e.g. 'ERC20InsufficientAllowance') */
  reason?: string
}
export type Level = { price: bigint; size: bigint; total: bigint; orders: number }
export type Trade = { price: bigint; amount: bigint; maker: Address; taker: Address; takerSide: Side; tx: Hex; block: bigint }
export type PlaceResult = { order?: Order; fills: Trade[]; tx?: Hex; reverted?: { error: string; args: unknown[] } }
export type Wallet = {
  address: Address
  sendTransaction(tx: { to?: Address; data: Hex }): Promise<TransactionReceipt>
  signTypedData(td: TypedDataDefinition): Promise<Hex>
}
export type OrderReport = {
  order: Order; fills: Trade[]
  cancelled?: { tx?: Hex; block?: bigint }
  failure?: { tx: Hex; error: string; args: unknown[]; fix?: string }
}
/** A resting order as the matcher sees it: `remaining` is what can still fill (off-chain: the covered size). */
export type Resting = { id: string; owner: Address; side: Side; price: bigint; remaining: bigint; seq: number }
