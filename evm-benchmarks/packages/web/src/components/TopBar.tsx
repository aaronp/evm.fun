import { BrandIcon } from '../ui/icons'
import { useWizard } from '../walkthrough/wizard'
import { AppBar } from './AppBar'
import { ChainPicker } from './ChainPicker'
import { Menu } from './Menu'
import { ProfileMenu } from './ProfileMenu'

/** File menu handlers; an item without one shows disabled (Task 3 wires them). */
export type FileActions = Partial<Record<'new' | 'open' | 'save' | 'importChain' | 'exportChain', () => void>>

export function FileMenu({ actions = {}, defaultOpen }: { actions?: FileActions; defaultOpen?: boolean }) {
  return (
    <Menu label="File" trigger="File" defaultOpen={defaultOpen} items={[
      { key: 'new', label: 'New', onSelect: actions.new },
      { key: 'open', label: 'Open…', onSelect: actions.open },
      { key: 'save', label: 'Save', onSelect: actions.save },
      { key: 'import', label: 'Import chain…', onSelect: actions.importChain, separated: true },
      { key: 'export', label: 'Export chain', onSelect: actions.exportChain },
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
