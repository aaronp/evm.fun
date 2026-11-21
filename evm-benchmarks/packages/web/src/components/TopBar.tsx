import { BrandIcon } from '../ui/icons'
import { useWizard } from '../walkthrough/wizard'
import { AppBar } from './AppBar'
import { ChainPicker } from './ChainPicker'
import { Menu } from './Menu'
import { ProfileMenu } from './ProfileMenu'

type FileItem = 'new' | 'open' | 'save' | 'importChain' | 'exportChain'
/** File menu handlers; an item without one shows disabled. `reasons`: why an item is disabled, shown beside it (and disables it). */
export type FileActions = Partial<Record<FileItem, () => void>> & { reasons?: Partial<Record<FileItem, string>> }

export function FileMenu({ actions = {}, defaultOpen }: { actions?: FileActions; defaultOpen?: boolean }) {
  const item = (id: FileItem, text: string, separated?: boolean) => {
    const why = actions.reasons?.[id]
    return { key: id, separated, label: why ? <>{text}<span className="ml-auto pl-3 text-[11px] text-muted">{why}</span></> : text, onSelect: why ? undefined : actions[id] }
  }
  return (
    <Menu label="File" trigger="File" defaultOpen={defaultOpen} items={[
      item('new', 'New'), item('open', 'Open…'), item('save', 'Save'), item('importChain', 'Import chain…', true), item('exportChain', 'Export chain'),
    ]} />
  )
}

/** The permanent bar: brand, File, the page's title/crumbs/actions (from `useAppBar`), chain picker, profile.
 *  Below `sm` the page part wraps onto its own row. In walkthrough focus mode it dims like the page (index.css). */
export function TopBar({ file }: { file?: FileActions }) {
  const wz = useWizard()
  return ( // sticky: on phone the window scrolls; from sm the shell is screen-high and only main scrolls
    <header data-wz-focus={wz?.w && wz.focus ? '' : undefined} className="sticky top-0 z-30 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-3 py-2 sm:px-4">
      <span className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent"><BrandIcon width={17} height={17} /></span>
        <span className="sr-only font-display text-[15px] font-semibold leading-tight sm:not-sr-only">EVM Playground</span>
      </span>
      <FileMenu actions={file} />
      <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1"><AppBar /></div>
      <div className="ml-auto flex min-w-0 items-center gap-2"><ChainPicker /><ProfileMenu /></div>
    </header>
  )
}
