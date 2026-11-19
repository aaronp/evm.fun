import { createContext, useContext, type ReactNode } from 'react'
import { Segmented } from '../ui/segmented'
import { ChainLinkIcon, LensIcon, TableIcon, TimelineIcon } from '../ui/icons'

export type ExplorerView = 'table' | 'chain' | 'timeline' | 'fisheye'
export const VIEWS: ExplorerView[] = ['table', 'chain', 'timeline', 'fisheye']
const icons: Record<ExplorerView, ReactNode> = { table: <TableIcon />, chain: <ChainLinkIcon />, timeline: <TimelineIcon />, fisheye: <LensIcon /> }
const VIEW_KEY = 'evmb.explorerView'
export const readView = (): ExplorerView => {
  try { const v = localStorage.getItem(VIEW_KEY); if (VIEWS.includes(v as ExplorerView)) return v as ExplorerView } catch {}
  return 'table'
}

export const viewTitle: Record<ExplorerView, string> = { table: 'Table', chain: 'Chain', timeline: 'Timeline', fisheye: 'Fisheye' }

/** Set by Explorer. Browse renders one Panel (stable type/position) holding <ViewToggle />, so focus survives a switch. */
export const ViewCtx = createContext<{ view: ExplorerView; set(v: ExplorerView): void }>({ view: 'table', set() {} })

export function ViewToggle() {
  const { view, set } = useContext(ViewCtx)
  return (
    <Segmented label="View" name="explorer-view" value={view} className="flex gap-1"
      itemClassName="flex size-8 items-center justify-center"
      onChange={v => { set(v); try { localStorage.setItem(VIEW_KEY, v) } catch {} }}
      options={VIEWS.map(v => { const t = v[0]!.toUpperCase() + v.slice(1); return { value: v, title: t, content: <>{icons[v]}<span className="sr-only">{t}</span></> } })} />
  )
}
