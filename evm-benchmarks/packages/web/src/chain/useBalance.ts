import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import type { ChainHandle } from './handle'
import { useApp } from '../state'

const WEI = 10n ** 18n

/** wei -> "1,000 ETH" / "1.2346 ETH" (4 dp, trailing zeros trimmed); "—" when unknown. */
export function formatEth(wei?: bigint): string {
  if (wei === undefined) return '—'
  const scaled = (wei * 10_000n + WEI / 2n) / WEI
  const frac = (scaled % 10_000n).toString().padStart(4, '0').replace(/0+$/, '')
  return `${(scaled / 10_000n).toLocaleString('en-US')}${frac && `.${frac}`} ETH`
}

/** Balance of `address`, re-read on chain/account change and after any send (balanceTick). */
export function useBalance(handle?: ChainHandle, address?: Address): bigint | undefined {
  const { balanceTick } = useApp()
  const [bal, setBal] = useState<bigint>()
  useEffect(() => setBal(undefined), [handle, address]) // a tick refresh keeps the old value until the new one lands
  useEffect(() => {
    let live = true
    if (handle && address) {
      handle.request('eth_getBalance', [address, 'latest']).then(
        v => live && setBal(BigInt(v as string)),
        () => {},
      )
    }
    return () => { live = false }
  }, [handle, address, balanceTick])
  return bal
}
