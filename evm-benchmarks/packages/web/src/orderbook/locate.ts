import { useEffect, useState } from 'react'
import { getAddress, type Abi, type Address } from 'viem'
import { OrderBook, Settlement } from '@evmb/contracts'
import { offchainVenue, onchainVenue, type Store, type Venue } from '@evmb/orderbook'
import type { ChainHandle } from '../chain/handle'
import { contractsRegistry } from '../contracts/registry'
import type { Account } from '../store/accounts'
import { deployContract, inDeployOrder } from '../swap/locate'
import { bookStore } from './store'

export type VenueKind = 'onchain' | 'offchain'

const KINDS = {
  onchain: { name: 'OrderBook', contract: OrderBook, fns: ['place', 'cancel', 'best', 'level', 'orders', 'ordersOf'] },
  offchain: { name: 'Settlement', contract: Settlement, fns: ['settle', 'cancel', 'filled', 'cancelled', 'hashOrder'] },
} as const

/** The contract a venue kind deploys: "OrderBook" / "Settlement". */
export const venueName = (kind: VenueKind) => KINDS[kind].name

const fits = (abi: Abi, fns: readonly string[]) => fns.every(f => abi.some(e => e.type === 'function' && e.name === f))

/** The newest-deployed record of the venue contract, with its deploy block. */
async function newest(chain: ChainHandle, kind: VenueKind) {
  const k = KINDS[kind]
  const recs = (await contractsRegistry.list(chain.info.id)).filter(r => r.name === k.name && fits(r.abi as Abi, k.fns))
  return (await inDeployOrder(chain, recs)).at(-1)
}

/** This chain's OrderBook (`onchain`) or Settlement (`offchain`). */
export const venueFor = async (chain: ChainHandle, kind: VenueKind): Promise<Address | undefined> => (await newest(chain, kind))?.address

/** Deploy the venue contract from `from` and save its record. Refused on benchmark chains. */
export const deployVenue = (chain: ChainHandle, kind: VenueKind, from: Account, onSent?: () => void): Promise<Address> =>
  deployContract(chain, from, KINDS[kind].name, KINDS[kind].contract, onSent)

/** A venue with its contract's address (what the give asset is approved to). */
export type TradeVenue = Venue & { address: Address }

/** The chain's venue of `kind`, scoped by the playground chain id (unique per fork); undefined when none is deployed. */
export async function openVenue(chain: ChainHandle, kind: VenueKind, store: Store = bookStore): Promise<TradeVenue | undefined> {
  const rec = await newest(chain, kind)
  if (!rec) return
  const base = { request: (m: string, p: unknown[]) => chain.request(m, p), scope: chain.info.id, address: getAddress(rec.address), store }
  const v = kind === 'onchain'
    ? onchainVenue({ ...base, fromBlock: rec.block < 0n ? 0n : rec.block })
    : offchainVenue({ ...base, chainId: Number(BigInt((await chain.request('eth_chainId', [])) as string)) })
  return { ...v, address: base.address }
}

/** null while looking (and after a failed lookup, reported to `onError`: never "none", which would offer a second deploy),
 * undefined when the chain has none; `nonce` re-looks (e.g. after a deploy). */
export function useVenue(chain: ChainHandle | undefined, kind: VenueKind, nonce = 0, onError?: (e: string) => void): TradeVenue | undefined | null {
  // keyed, so a result found for another chain, kind or nonce never shows (not even for the render before the effect)
  const key = `${chain?.info.id}:${kind}:${nonce}`
  const [got, setGot] = useState<{ key: string; v: TradeVenue | undefined }>()
  useEffect(() => {
    if (!chain) return
    let live = true
    openVenue(chain, kind).then(v => live && setGot({ key, v }), e => live && onError?.(e instanceof Error ? e.message : String(e)))
    return () => { live = false }
  }, [chain, kind, nonce]) // eslint-disable-line react-hooks/exhaustive-deps
  return got?.key === key ? got.v : null
}
