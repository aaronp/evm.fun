import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Address } from 'viem'
import { balances, type Asset } from '@evmb/assets'
import { useApp } from '../state'
import { accounts } from '../store/accounts'
import { requestFix, type Fix } from '../fix'
import { buttonClass } from '../ui/button'

/** A balance shortfall's message (the form's own copy) plus its fix ("Request {amount} {SYM} from {issuer}", from
 *  `useRequestFix`) when there is one. */
export function Shortfall({ fix, children }: { fix?: Fix; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      {children}
      {fix && <Link to={fix.href} className={buttonClass('outline', 'chip')}>{fix.label}</Link>}
    </div>
  )
}

/** `requestFix` for the acting account on the selected chain, back to this page; reads the issuer's balance (no
 *  shortfall: `need <= have`, nothing read). The last reading stays across balance refreshes, so the button doesn't flicker. */
export function useRequestFix(asset: Asset | undefined, need: bigint, have: bigint): Fix | undefined {
  const { chain, account, balanceTick } = useApp()
  const { pathname, search } = useLocation()
  const [read, setRead] = useState<{ key: string; has: bigint }>()
  const people = accounts.list()
  const issuer = asset?.issuer && people.find(p => p.address.toLowerCase() === asset.issuer!.toLowerCase())?.address
  const wanted = !!chain && !!asset && !!issuer && need > have
  const key = wanted ? `${chain!.info.id}\0${asset!.id}\0${issuer}\0${need - have}` : ''
  useEffect(() => {
    if (!wanted) return
    let live = true
    balances(chain!.request, asset!, [issuer as Address]).then(m => live && setRead({ key, has: [...m.values()][0]! }), () => {})
    return () => { live = false }
  }, [key, balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!wanted || !account) return
  const issuerHas = read?.key === key ? read.has : undefined
  return requestFix({ chainId: chain!.info.id, asset: asset!, issuer, recipient: account, need, have, issuerHas, back: pathname + search, accounts: people })
}
