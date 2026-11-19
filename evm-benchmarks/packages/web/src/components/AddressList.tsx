import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { accounts } from '../store/accounts'
import { contractsRegistry } from '../contracts/registry'
import { useApp } from '../state'
import { addressSuggestions, type Suggestion } from '../abi/suggest'

/** Inputs for address params set list={ADDRESS_LIST}; the datalist is rendered once, in App. */
export const ADDRESS_LIST = 'evmb-addresses'

export function AddressList() {
  const { chain } = useApp()
  const { key } = useLocation() // re-read after navigation (new accounts / deploys)
  const [items, setItems] = useState<Suggestion[]>([])
  useEffect(() => {
    let live = true
    const mine = accounts.list()
    if (!chain) setItems(addressSuggestions(mine, []))
    else contractsRegistry.list(chain.info.id).then(cs => live && setItems(addressSuggestions(mine, cs)), () => {})
    return () => { live = false }
  }, [chain, key])
  return <datalist id={ADDRESS_LIST}>{items.map(s => <option key={s.value} value={s.value} label={s.label} />)}</datalist>
}
