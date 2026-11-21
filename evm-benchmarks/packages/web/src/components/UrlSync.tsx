import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../state'
import { accounts } from '../store/accounts'
import { syncDecision, withParams, type Last } from '../links'
import { pushNotice, takeNotice } from '../notice'
import { Notice } from '../ui/notice'

/** Keeps `?chain=&as=` and the selected chain and account in step, both ways (see `syncDecision`). */
export function UrlSync() {
  const { chains, chain, selectChain, account, selectAccount, loading, busy } = useApp()
  const { pathname, search } = useLocation()
  const nav = useNavigate()
  const last = useRef<Last>({})
  const people = accounts.list()
  const peopleKey = people.map(p => `${p.label}\0${p.address}`).join('\n') // a new or renamed label may change how `as` is written
  useEffect(() => {
    const sp = new URLSearchParams(search)
    const d = syncDecision({ chain: sp.get('chain'), as: sp.get('as') }, // busy: never switch under an in-flight tx
      { chain: chain?.info.id, account, loading: loading || busy }, last.current, { chains: chains.map(c => c.id), accounts: people })
    last.current = d.last
    if (d.notices.length) pushNotice(d.notices.join(' · '))
    if (d.account) selectAccount(d.account)
    if (d.chain) void selectChain(d.chain)
    if (d.url) nav(withParams(pathname + search, d.url), { replace: true })
  }, [pathname, search, chains, chain, account, loading, busy, peopleKey, selectChain, selectAccount, nav]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/** The one-shot notice (`pushNotice`), under the app bar until dismissed or another page opens. */
export function ShellNotice() {
  const { pathname, key } = useLocation()
  const [n, setN] = useState<ReturnType<typeof takeNotice>>()
  useEffect(() => setN(undefined), [pathname])
  useEffect(() => { const t = takeNotice(); if (t) setN(t) }, [key])
  return n ? <Notice tone={n.tone} onDismiss={() => setN(undefined)}>{n.text}</Notice> : null
}
