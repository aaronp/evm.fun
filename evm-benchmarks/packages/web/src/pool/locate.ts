import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { Pool } from '@evmb/contracts'
import { findPool, orient, readPool, type PoolState } from '@evmb/pool'
import type { ChainHandle } from '../chain/handle'
import { contractsRegistry } from '../contracts/registry'
import type { Account } from '../store/accounts'
import { deployContract, inDeployOrder, NO_RECORDS } from '../swap/locate'

/** The newest-deployed Pool for {base, quote} in either order, with its deploy block (0 when unknown). */
async function poolRecord(chain: ChainHandle, base: Address, quote: Address): Promise<{ address: Address; block: bigint } | undefined> {
  const recs = await inDeployOrder(chain, (await contractsRegistry.list(chain.info.id)).filter(r => r.name === 'Pool'))
  const address = await findPool(chain.request, recs, base, quote)
  const block = recs.find(r => r.address === address)?.block ?? 0n
  return address && { address, block: block < 0n ? 0n : block }
}

/** This chain's pool for the unordered pair {base, quote}. */
export const poolFor = async (chain: ChainHandle, base: Address, quote: Address) => (await poolRecord(chain, base, quote))?.address

/** Deploy Pool.sol(base, quote) from `from` and save its record. Refused on benchmark chains and when the pair has a pool in either order. */
export async function deployPool(chain: ChainHandle, from: Account, base: Address, quote: Address, onSent?: () => void): Promise<Address> {
  if (chain.info.ephemeral) throw new Error(NO_RECORDS)
  const at = await poolFor(chain, base, quote)
  if (at) throw new Error(`This chain already has a pool for this pair at ${at}`)
  return deployContract(chain, from, 'Pool', Pool, onSent, [base, quote])
}

export type PoolView = {
  /** null: still looking; undefined: no pool for the pair */
  address?: Address | null
  /** seen from the page's base/quote */
  state?: PoolState
  /** the pool's on-chain order: calls take it */
  raw?: PoolState
  block?: bigint
  error?: string
}

/** The pair's pool, read live on every `tick` (never cached); a tick keeps the old values until the new ones land. */
export function usePool(chain: ChainHandle | undefined, base: Address | undefined, quote: Address | undefined, tick: number): PoolView {
  const [v, setV] = useState<PoolView>({ address: null })
  useEffect(() => { setV({ address: null }) }, [chain, base, quote])
  useEffect(() => {
    if (!chain || !base || !quote) return
    let live = true
    poolRecord(chain, base, quote).then(async r => {
      if (!r) return { address: undefined }
      const raw = await readPool(chain.request, r.address)
      return { address: r.address, block: r.block, raw, state: orient(raw, base, quote) }
    }).then(n => live && setV(n), e => live && setV(o => ({ ...o, error: e instanceof Error ? e.message : String(e) })))
    return () => { live = false }
  }, [chain, base, quote, tick])
  return v
}
