import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { registry } from './chain/revm'
import type { ChainHandle, ChainInfo } from './chain/registry'
import { accounts } from './store/accounts'

const SEL = 'evmb.selectedChain'
const read = () => { try { return localStorage.getItem(SEL) } catch { return null } }
const write = (id: string | null) => { try { id ? localStorage.setItem(SEL, id) : localStorage.removeItem(SEL) } catch {} }

type State = {
  chains: ChainInfo[]
  chain?: ChainHandle // selected, open chain
  error?: string
  selectChain(id: string | undefined): Promise<void>
  refresh(): Promise<void>
  /** selected account address */
  account?: string
  selectAccount(address: string | undefined): void
}

const Ctx = createContext<State>(undefined as never)
export const useApp = () => useContext(Ctx)

export function AppState({ children }: { children: ReactNode }) {
  const [chains, setChains] = useState<ChainInfo[]>([])
  const [chain, setChain] = useState<ChainHandle>()
  const [error, setError] = useState<string>()
  const [account, setAccount] = useState<string | undefined>(() => accounts.list()[0]?.address)

  const refresh = useCallback(async () => setChains(await registry.list()), [])
  const selectChain = useCallback(async (id: string | undefined) => {
    setError(undefined)
    try {
      setChain(id ? await registry.open(id) : undefined)
      write(id ?? null)
    } catch (e) {
      setChain(undefined)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refresh().then(async () => {
      const id = read()
      if (id && (await registry.list()).some(c => c.id === id)) await selectChain(id)
    })
  }, [refresh, selectChain])

  return <Ctx.Provider value={{ chains, chain, error, selectChain, refresh, account, selectAccount: setAccount }}>{children}</Ctx.Provider>
}
