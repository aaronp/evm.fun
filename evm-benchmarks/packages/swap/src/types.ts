import type { Address } from 'viem'

export type OfferStatus = 'none' | 'open' | 'filled' | 'cancelled'
export type Offer = {
  id: bigint; maker: Address; giveToken: Address; giveAmt: bigint; getToken: Address; getAmt: bigint; status: OfferStatus
}
