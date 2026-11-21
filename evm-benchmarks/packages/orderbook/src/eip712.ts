import { hashTypedData, type Address, type Hex, type TypedDataDomain } from 'viem'
import type { Wallet } from './types'

/** Settlement.sol's `Order`. `side` is the maker's, 0 = buy, 1 = sell (of the base asset); `expiry` in unix seconds. */
export type SignedOrder = {
  maker: Address; base: Address; quote: Address; side: number
  price: bigint; amount: bigint; nonce: bigint; expiry: bigint
}

export const orderTypes = {
  Order: [
    { name: 'maker', type: 'address' }, { name: 'base', type: 'address' }, { name: 'quote', type: 'address' },
    { name: 'side', type: 'uint8' }, { name: 'price', type: 'uint256' }, { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' }, { name: 'expiry', type: 'uint256' },
  ],
} as const

export const domainOf = (chainId: number, settlement: Address): TypedDataDomain =>
  ({ name: 'EVMB Settlement', version: '1', chainId, verifyingContract: settlement })

/** The order's id: its EIP-712 hash, equal to Settlement.hashOrder. */
export const hashOrder = (o: SignedOrder, domain: TypedDataDomain): Hex =>
  hashTypedData({ domain, types: orderTypes, primaryType: 'Order', message: o })

export const signOrder = (wallet: Wallet, o: SignedOrder, domain: TypedDataDomain): Promise<Hex> =>
  wallet.signTypedData({ domain, types: orderTypes, primaryType: 'Order', message: o })
