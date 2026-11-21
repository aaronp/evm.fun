import type { ReactElement, ReactNode } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { StorageNotice } from './ui/notice'
import { ShellNotice, UrlSync } from './components/UrlSync'
import { AppState } from './state'
import { AppBarProvider } from './state/appBar'
import { TopBar } from './components/TopBar'
import { useWorkspaceDialogs } from './components/WorkspaceDialogs'
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
import { ThemeSwitcher } from './components/ThemeSwitcher'
import { ENGINE } from './chain/revm'
import { AccountsIcon, BenchmarkIcon, ChainsIcon, StudioIcon, TransactIcon, AssetsIcon, SwapIcon, PoolIcon, TradeIcon, FlagIcon } from './ui/icons'
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
    <main data-wz-focus={wz?.w && wz.focus ? '' : undefined} className={`min-w-0 flex-1 space-y-4 p-3 sm:overflow-y-auto sm:p-6 ${vertical ? 'sm:flex sm:items-start sm:gap-6 sm:space-y-0' : ''}`}>
      <Ribbon />
      <div className="min-w-0 flex-1 space-y-4">{children}</div>
    </main>
  )
}

/** The bar on top; below it the navigation sidebar and the page. From `sm` the shell fills the screen and the page scrolls in place, so the bar stays. */
export function Shell() {
  const ws = useWorkspaceDialogs()
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text sm:h-dvh">
      <TopBar file={ws.actions} />
      {ws.dialogs}
      <div className="flex flex-1 flex-col sm:min-h-0 sm:flex-row">
        <aside className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel p-3 sm:w-60 sm:flex-col sm:flex-nowrap sm:items-stretch sm:gap-5 sm:overflow-y-auto sm:border-r sm:border-b-0 sm:p-4">
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
          <div className="ml-auto flex items-center gap-3 sm:mt-auto sm:ml-0 sm:flex-col sm:items-start sm:px-2">
            <ThemeSwitcher />
            <span className="hidden font-mono text-[11px] text-muted sm:block">{ENGINE}</span>
          </div>
        </aside>
        <Main>
          <UrlSync />
          <ShellNotice />
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
    </div>
  )
}

export function App() {
  return (
    <AppState>
    <AppBarProvider>
    <HashRouter>
    <WizardProvider>
      <Shell />
    </WizardProvider>
    </HashRouter>
    </AppBarProvider>
    </AppState>
  )
}
