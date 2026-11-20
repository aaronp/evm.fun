import { decodeFunctionResult, encodeFunctionData, type Address, type Hex } from 'viem'
import type { Request } from '@evmb/assets'
import { swapAbi } from './abi'
import type { Offer, OfferStatus } from './types'

const STATUS: OfferStatus[] = ['none', 'open', 'filled', 'cancelled']
/** The contract's `Status` enum value (e.g. `OfferNotOpen.args.status`) as an `OfferStatus`. */
export const statusName = (n: number | bigint): OfferStatus => STATUS[Number(n)] ?? 'none'

async function call(request: Request, to: Address, functionName: 'nextId' | 'offers', args: unknown[] = []) {
  const data = encodeFunctionData({ abi: swapAbi, functionName, args } as any)
  const out = (await request('eth_call', [{ to, data }, 'latest'])) as Hex
  return decodeFunctionResult({ abi: swapAbi, functionName, data: out } as any) as any
}

/** Every offer ever made (ids 1..nextId-1), read live from the chain. */
export async function readOffers(request: Request, swap: Address): Promise<Offer[]> {
  const next = (await call(request, swap, 'nextId')) as bigint
  const ids = Array.from({ length: Math.max(0, Number(next) - 1) }, (_, i) => BigInt(i + 1))
  return Promise.all(ids.map(id => readOffer(request, swap, id)))
}

/** One offer, read live from the chain. */
export async function readOffer(request: Request, swap: Address, id: bigint): Promise<Offer> {
  const [maker, giveToken, giveAmt, getToken, getAmt, status] = await call(request, swap, 'offers', [id])
  return { id, maker, giveToken, giveAmt, getToken, getAmt, status: statusName(status) }
}
