import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { registry } from './chain/revm'
import type { ChainHandle, ChainInfo } from './chain/registry'
import { accounts } from './store/accounts'

const SEL = 'evmb.selectedChain'
const read = () => { try { return localStorage.getItem(SEL) } catch { return null } }
const write = (id: string | null) => { try { id ? localStorage.setItem(SEL, id) : localStorage.removeItem(SEL) } catch {} }
/** `?chain=` of the address the app was opened with (`#/swap?chain=…`): it wins over the remembered chain. */
const linked = () => { try { return new URLSearchParams(location.hash.split('?')[1] ?? '').get('chain') } catch { return null } }

type State = {
  chains: ChainInfo[]
  chain?: ChainHandle // selected, open chain
  error?: string
  selectChain(id: string | undefined): Promise<void>
  refresh(): Promise<void>
  /** selected account address */
  account?: string
  selectAccount(address: string | undefined): void
  /** bumped after every send so balance displays re-read */
  balanceTick: number
  bumpBalance(): void
  /** a page has a tx in flight on the selected chain: the chain switcher is disabled until it lands */
  busy: boolean
  setBusy(b: boolean): void
  /** the chain list (on first load) or a chain is loading: the URL sync waits */
  loading: boolean
}

const Ctx = createContext<State>(undefined as never)
export const useApp = () => useContext(Ctx)

export function AppState({ children }: { children: ReactNode }) {
  const [chains, setChains] = useState<ChainInfo[]>([])
  const [chain, setChain] = useState<ChainHandle>()
  const [error, setError] = useState<string>()
  const [balanceTick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(1) // the first load's restore
  const bumpBalance = useCallback(() => setTick(t => t + 1), [])
  const [account, setAccount] = useState<string | undefined>(() => accounts.list()[0]?.address)

  const refresh = useCallback(async () => setChains(await registry.list()), [])
  const selectChain = useCallback(async (id: string | undefined) => {
    setError(undefined)
    setPending(n => n + 1)
    try {
      setChain(id ? await registry.open(id) : undefined)
      write(id ?? null)
    } catch (e) {
      setChain(undefined)
      setError(e instanceof Error ? e.message : String(e))
    } finally { setPending(n => n - 1) }
  }, [])

  // keep the persisted height of the selected chain current (after each send, via balanceTick)
  useEffect(() => { if (chain) registry.recordHeight(chain.info.id).catch(() => {}) }, [chain, balanceTick])

  useEffect(() => {
    registry.pruneSnapshots().catch(() => {}) // once per page load, before any ephemeral chain exists
    const link = linked() // now: a navigation while the list loads must not lose it
    refresh().then(async () => {
      const ids = (await registry.list()).map(c => c.id)
      const id = [link, read()].find(x => x && ids.includes(x))
      if (id) await selectChain(id)
    }).finally(() => setPending(n => n - 1))
  }, [refresh, selectChain])

  return <Ctx.Provider value={{ chains, chain, error, selectChain, refresh, account, selectAccount: setAccount, balanceTick, bumpBalance, busy, setBusy, loading: pending > 0 }}>{children}</Ctx.Provider>
}
