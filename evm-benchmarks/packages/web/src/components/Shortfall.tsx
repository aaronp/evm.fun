import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Address } from 'viem'
import { balances, type Asset } from '@evmb/assets'
import { useApp } from '../state'
import { accounts } from '../store/accounts'
import { requestFix, type Fix } from '../fix'
import { buttonClass } from '../ui/button'

/** A balance shortfall's message (the form's own copy) plus "Request {amount} {SYM} from {issuer}" when the issuer can
 *  send it (`requestFix`); `fix` overrides the computed one. */
export function Shortfall({ asset, need, have, fix, children }: { asset: Asset; need: bigint; have: bigint; fix?: Fix; children?: ReactNode }) {
  const f = useRequestFix(asset, need, have)
  const link = fix ?? f
  return (
    <div className="flex flex-col items-start gap-1.5">
      {children}
      {link && <Link to={link.href} className={buttonClass('outline', 'chip')}>{link.label}</Link>}
    </div>
  )
}

/** `requestFix` for the acting account on the selected chain, back to this page; reads the issuer's balance. */
export function useRequestFix(asset: Asset, need: bigint, have: bigint): Fix | undefined {
  const { chain, account, balanceTick } = useApp()
  const { pathname, search } = useLocation()
  const [issuerHas, setHas] = useState<bigint>()
  const people = accounts.list()
  const issuer = asset.issuer && people.find(p => p.address.toLowerCase() === asset.issuer!.toLowerCase())?.address
  const wanted = !!chain && !!issuer && need > have
  useEffect(() => {
    setHas(undefined)
    if (!wanted) return
    let live = true
    balances(chain!.request, asset, [issuer as Address]).then(m => live && setHas([...m.values()][0]), () => {})
    return () => { live = false }
  }, [wanted, chain, asset.id, issuer, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!wanted || !account) return
  return requestFix({ chainId: chain!.info.id, asset, issuer, recipient: account, need, have, issuerHas, back: pathname + search, accounts: people })
}
