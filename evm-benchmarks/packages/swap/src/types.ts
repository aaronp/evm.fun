import type { Address } from 'viem'

export type OfferStatus = 'none' | 'open' | 'filled' | 'cancelled'
export type Offer = {
  id: bigint; maker: Address; giveToken: Address; giveAmt: bigint; getToken: Address; getAmt: bigint; status: OfferStatus
  /** who took it and in which block; set by the contract's `take`, so only on `filled` offers */
  taker?: Address; filledBlock?: bigint
}

/** Who took the offer: stored by the contract in `take`, so this is O(1) from `offers(id)`, no log search. */
export const takerOf = (o: Offer): Address | undefined => o.taker
