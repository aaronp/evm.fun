import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Address } from 'viem'
import { balances, nativeAsset, type Asset } from '@evmb/assets'
import { useApp } from '../state'
import { accounts } from '../store/accounts'
import { gasFix, requestFix, type Fix } from '../fix'
import { gasShortfall } from '../tx/send'
import type { ChainHandle } from '../chain/handle'
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

/** `requestFix` for the acting account on the selected chain (or `on`, coming back to the selected one), back to this page; reads the issuer's balance (no
 *  shortfall: `need <= have`, nothing read). The last reading stays across balance refreshes, so the button doesn't flicker. */
export function useRequestFix(asset: Asset | undefined, need: bigint, have: bigint, on?: ChainHandle): Fix | undefined {
  const app = useApp(), { account, balanceTick } = app, chain = on ?? app.chain
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
  return requestFix({ chainId: chain!.info.id, asset: asset!, issuer, recipient: account, need, have, issuerHas, back: pathname + search, accounts: people, backChain: app.chain?.info.id })
}

/** `gasFix` for an error that is a gas shortfall (`gasShortfall`): reads every local account's ETH on the selected
 *  chain, back to this page. Nothing for any other error. Tolerates no app (a walkthrough provider in a test). */
export function useGasFix(error: string | undefined, on?: ChainHandle): Fix | undefined {
  const app = useApp() as ReturnType<typeof useApp> | undefined
  const { pathname, search } = useLocation()
  const [read, setRead] = useState<{ key: string; bals: Map<string, bigint> }>()
  const chain = on ?? app?.chain, g = gasShortfall(error), people = accounts.list()
  const key = chain && g ? [chain.info.id, g.address, g.need, ...people.map(p => p.address)].join('\0') : ''
  useEffect(() => {
    if (!key) return
    let live = true
    balances(chain!.request, nativeAsset(chain!.info.id), people.map(p => p.address as Address)).then(m => live && setRead({ key, bals: m }), () => {})
    return () => { live = false }
  }, [key, app?.balanceTick]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!key || read?.key !== key) return
  return gasFix({ chainId: chain!.info.id, shortfall: g!, balances: read.bals, back: pathname + search, accounts: people, backChain: app?.chain?.info.id })
}

/** Next to a send error: "Request {amount} ETH from {account}" when the error is a gas shortfall, else nothing.
 *  `onClick`: e.g. close the dialog the error is in. */
export function GasFix({ error, onClick, on }: { error?: string; onClick?: () => void; on?: ChainHandle }) {
  const fix = useGasFix(error, on)
  return fix ? <Link to={fix.href} onClick={onClick} className={`self-start ${buttonClass('outline', 'chip')}`}>{fix.label}</Link> : null
}
