import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'

export type AppBarAction =
  | { kind: 'button'; id: string; label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; /** tooltip; defaults to label (use it for the reason when disabled) */ title?: string }
  | { kind: 'toggle'; id: string; label: string; value: string; options: { value: string; label: string; icon: ReactNode }[]; onChange: (v: string) => void }
export interface AppBarConfig { title: string; crumbs?: { label: string; to?: string }[]; actions?: AppBarAction[] }

// Two contexts so pages (setter only) don't re-render when the bar's config changes.
const Value = createContext<AppBarConfig | undefined>(undefined)
const Setter = createContext<(c: AppBarConfig | undefined) => void>(() => {})

export const AppBarProvider = ({ children }: { children: ReactNode }) => {
  const [config, set] = useState<AppBarConfig>()
  return <Setter.Provider value={set}><Value.Provider value={config}>{children}</Value.Provider></Setter.Provider>
}
export const useAppBarConfig = () => useContext(Value)

/** Registers the bar's content while the calling page is mounted, then clears it. */
export function useAppBar(config: AppBarConfig) {
  const set = useContext(Setter)
  useLayoutEffect(() => { set(config) }) // every render: actions close over fresh page state
  useLayoutEffect(() => () => set(undefined), [set])
}

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`

/** Breadcrumb trail for a router pathname; the chain name is optional. */
export function crumbsFor(pathname: string, chainName?: string): { label: string; to?: string }[] {
  const [root, kind, id] = pathname.split('/').filter(Boolean)
  if (!root) return []
  const page = root[0]!.toUpperCase() + root.slice(1)
  const leaf = id && { block: `Block #${id}`, tx: `Tx ${short(id)}`, address: `Address ${short(id)}` }[kind!]
  if (root !== 'chains' || !leaf) return [{ label: page }]
  return [{ label: page, to: '/chains' }, ...(chainName ? [{ label: chainName, to: '/chains' }] : []), { label: leaf }]
}
