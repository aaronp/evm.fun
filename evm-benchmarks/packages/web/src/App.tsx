import type { ReactElement, ReactNode } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { StorageNotice } from './ui/notice'
import { AppState } from './state'
import { AppBarProvider } from './state/appBar'
import { AppBar } from './components/AppBar'
import { Accounts } from './pages/Accounts'
import { Chains } from './pages/ChainsPage'
import { legacyRoute } from './routes'
import { Studio } from './pages/Studio'
import { Transact } from './pages/Transact'
import { Benchmark } from './pages/Benchmark'
import { Assets } from './pages/Assets'
import { GetStarted } from './pages/GetStarted'
import { Swap } from './pages/Swap'
import { SwapReport } from './pages/SwapReport'
import { Pool } from './pages/Pool'
import { Trade } from './pages/Trade'
import { TradeReport } from './pages/TradeReport'
import { ContextBox, ContextStrip } from './components/ContextBox'
import { ThemeSwitcher } from './components/ThemeSwitcher'
import { ENGINE } from './chain/revm'
import { AccountsIcon, BenchmarkIcon, BrandIcon, ChainsIcon, StudioIcon, TransactIcon, AssetsIcon, SwapIcon, PoolIcon, TradeIcon, FlagIcon } from './ui/icons'
import { AddressList } from './components/AddressList'
import { Ribbon } from './components/Ribbon'
import { WizardProvider, useWizard } from './walkthrough/wizard'

export const groups = [
  { label: 'Setup', items: [['Get started', FlagIcon], ['Accounts', AccountsIcon], ['Chains', ChainsIcon]] },
  { label: 'Build & run', items: [['Studio', StudioIcon], ['Transact', TransactIcon], ['Benchmark', BenchmarkIcon]] },
  { label: 'Markets', items: [['Assets', AssetsIcon], ['Swap', SwapIcon], ['Pool', PoolIcon], ['Trade', TradeIcon]] },
] as const
const pages = groups.flatMap(g => g.items.map(([n]) => n))

const slug = (p: string) => p.toLowerCase().replaceAll(' ', '-')
export const real: Record<string, ReactElement> = { 'Get started': <GetStarted />, Accounts: <Accounts />, Chains: <Chains />, Studio: <Studio />, Transact: <Transact />, Benchmark: <Benchmark />, Assets: <Assets />, Swap: <Swap />, Pool: <Pool />, Trade: <Trade /> }
const LegacyRedirect = () => <Navigate to={legacyRoute(useLocation().pathname) ?? '/chains'} replace />
const Stub = ({ name }: { name: string }) => <h1 className="text-xl font-semibold">{name}</h1>

/** The page area; while a walkthrough runs, its ribbon sits above the page, or beside it (from `sm`) in vertical layout. */
function Main({ children }: { children: ReactNode }) {
  const wz = useWizard()
  const vertical = !!wz?.w && wz.layout === 'vertical'
  return (
    <main data-wz-focus={wz?.w && wz.focus ? '' : undefined} className={`min-w-0 flex-1 space-y-4 p-3 sm:p-6 ${vertical ? 'sm:flex sm:items-start sm:gap-6 sm:space-y-0' : ''}`}>
      <Ribbon />
      <div className="min-w-0 flex-1 space-y-4">{children}</div>
    </main>
  )
}

export function App() {
  return (
    <AppState>
    <AppBarProvider>
    <HashRouter>
    <WizardProvider>
      <div className="flex min-h-screen flex-col bg-bg text-text sm:flex-row">
        <aside className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel p-3 sm:sticky sm:top-0 sm:h-screen sm:w-60 sm:flex-col sm:flex-nowrap sm:items-stretch sm:gap-5 sm:overflow-y-auto sm:border-r sm:border-b-0 sm:p-4">
          <div className="flex items-center gap-2.5 sm:px-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent"><BrandIcon width={17} height={17} /></span>
            <div className="flex flex-col">
              <span className="font-display text-[15px] font-semibold leading-tight">EVM Playground</span>
              <span className="hidden font-mono text-[11px] text-muted sm:block">{ENGINE}</span>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-1 sm:flex-col sm:items-stretch sm:gap-5">
            {groups.map(g => (
              <div key={g.label} className="flex flex-wrap gap-1 sm:flex-col sm:gap-0.5">
                <span className="hidden px-2.5 pb-1.5 text-[11px] uppercase tracking-widest text-muted sm:block">{g.label}</span>
                {g.items.map(([p, Icon]) => (
                  <NavLink
                    key={p}
                    to={`/${slug(p)}`}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent ${isActive ? 'bg-selected text-text' : 'text-text-2 hover:bg-surface-hover'}`
                    }
                  >
                    <Icon />
                    {p}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="ml-auto sm:ml-0 sm:order-last"><ThemeSwitcher /></div>
          <div className="hidden sm:mt-auto sm:block"><ContextBox /></div>
          <div className="w-full sm:hidden"><ContextStrip /></div>
        </aside>
        <Main>
          <AppBar />
          <StorageNotice />
          <AddressList />
          <Routes>
            {pages.map(p => (
              <Route key={p} path={p === 'Chains' ? '/chains/*' : `/${slug(p)}`} element={real[p] ?? <Stub name={p} />} />
            ))}
            <Route path="/swap/report" element={<SwapReport />} />
            <Route path="/trade/report" element={<TradeReport />} />
            <Route path="/explorer/*" element={<LegacyRedirect />} />
            <Route path="*" element={<Navigate to="/accounts" replace />} />
          </Routes>
        </Main>
      </div>
    </WizardProvider>
    </HashRouter>
    </AppBarProvider>
    </AppState>
  )
}
