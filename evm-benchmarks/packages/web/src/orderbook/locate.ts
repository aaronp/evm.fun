import { useEffect, useState } from 'react'
import { encodeDeployData, getAddress, type Abi, type Address } from 'viem'
import { OrderBook, Settlement } from '@evmb/contracts'
import { offchainVenue, onchainVenue, type Store, type Venue } from '@evmb/orderbook'
import type { ChainHandle } from '../chain/handle'
import { contractsRegistry } from '../contracts/registry'
import type { Account } from '../store/accounts'
import { signAndSend } from '../tx/send'
import { inDeployOrder, NO_RECORDS } from '../swap/locate'
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
export async function deployVenue(chain: ChainHandle, kind: VenueKind, from: Account, onSent?: () => void): Promise<Address> {
  if (chain.info.ephemeral) throw new Error(NO_RECORDS)
  const { name, contract } = KINDS[kind]
  const r = await signAndSend(chain, from, { data: encodeDeployData({ abi: contract.abi, bytecode: contract.bytecode }) }, onSent)
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`Deploy ${r.status}${r.error ? `: ${r.error}` : ''}`)
  await contractsRegistry.add(chain.info.id, { address: r.contractAddress, name, abi: contract.abi as any[], deployer: from.address, txHash: r.hash })
  return r.contractAddress
}

/** The chain's venue of `kind`, scoped by the playground chain id (unique per fork); undefined when none is deployed. */
export async function openVenue(chain: ChainHandle, kind: VenueKind, store: Store = bookStore): Promise<Venue | undefined> {
  const rec = await newest(chain, kind)
  if (!rec) return
  const base = { request: (m: string, p: unknown[]) => chain.request(m, p), scope: chain.info.id, address: getAddress(rec.address), store }
  if (kind === 'onchain') return onchainVenue({ ...base, fromBlock: rec.block < 0n ? 0n : rec.block })
  return offchainVenue({ ...base, chainId: Number(BigInt((await chain.request('eth_chainId', [])) as string)) })
}

/** null while looking (and after a failed lookup, reported to `onError`: never "none", which would offer a second deploy),
 * undefined when the chain has none; `nonce` re-looks (e.g. after a deploy). */
export function useVenue(chain: ChainHandle | undefined, kind: VenueKind, nonce = 0, onError?: (e: string) => void): Venue | undefined | null {
  const [v, setV] = useState<Venue | undefined | null>(null)
  useEffect(() => {
    setV(null)
    if (!chain) return
    let live = true
    openVenue(chain, kind).then(x => live && setV(x), e => live && onError?.(e instanceof Error ? e.message : String(e)))
    return () => { live = false }
  }, [chain, kind, nonce]) // eslint-disable-line react-hooks/exhaustive-deps
  return v
}
