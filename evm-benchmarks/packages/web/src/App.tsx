import type { ReactElement } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { StorageNotice } from './ui/notice'
import { AppState } from './state'
import { Accounts } from './pages/Accounts'
import { Chains } from './pages/Chains'
import { Studio } from './pages/Studio'
import { Transact } from './pages/Transact'
import { Explorer } from './pages/Explorer'

const pages = ['Accounts', 'Chains', 'Studio', 'Transact', 'Explorer', 'Benchmark']

const real: Record<string, ReactElement> = { Accounts: <Accounts />, Chains: <Chains />, Studio: <Studio />, Transact: <Transact />, Explorer: <Explorer /> }
const Stub = ({ name }: { name: string }) => <h1 className="text-xl font-semibold">{name}</h1>

export function App() {
  return (
    <AppState>
    <HashRouter>
      <div className="flex min-h-screen bg-slate-50 text-slate-900">
        <nav className="w-44 shrink-0 border-r border-slate-200 bg-white p-3">
          <div className="mb-4 font-bold">EVM Playground</div>
          {pages.map(p => (
            <NavLink
              key={p}
              to={`/${p.toLowerCase()}`}
              className={({ isActive }) =>
                `block rounded px-2 py-1.5 text-sm ${isActive ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'}`
              }
            >
              {p}
            </NavLink>
          ))}
        </nav>
        <main className="flex-1 space-y-4 p-6">
          <StorageNotice />
          <Routes>
            {pages.map(p => (
              <Route key={p} path={p === 'Explorer' ? '/explorer/*' : `/${p.toLowerCase()}`} element={real[p] ?? <Stub name={p} />} />
            ))}
            <Route path="*" element={<Navigate to="/accounts" replace />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
    </AppState>
  )
}
