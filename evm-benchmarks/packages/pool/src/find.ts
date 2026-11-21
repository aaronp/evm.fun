import { isAddressEqual, type Abi, type Address } from 'viem'
import type { Request } from '@evmb/assets'
import { isPoolAbi } from './abi'
import { call } from './read'

/** No code (empty result), undecodable data or a revert: this record isn't a pool. Anything else (transport, RPC) propagates. */
const notAPool = (e: any): undefined => {
  const name = String(e?.name ?? '')
  if (name.startsWith('AbiDecoding') || typeof (e?.data ?? e?.cause?.data) === 'string' || /revert/i.test(String(e?.message))) return
  throw e
}

/** The newest record named `Pool` (records in deploy order, newest last) whose on-chain base/quote are {a, b} in either order. */
export async function findPool(request: Request, records: { name: string; address: Address; abi: Abi }[], a: Address, b: Address): Promise<Address | undefined> {
  for (const r of records.filter(r => r.name === 'Pool' && isPoolAbi(r.abi)).reverse()) {
    const pair = await Promise.all([call(request, r.address, 'base'), call(request, r.address, 'quote')]).catch(notAPool)
    if (pair && ((isAddressEqual(pair[0], a) && isAddressEqual(pair[1], b)) || (isAddressEqual(pair[0], b) && isAddressEqual(pair[1], a)))) return r.address
  }
}
