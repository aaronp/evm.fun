import { describe, test, expect } from 'bun:test'
import { createElement as h, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { Shell } from '../src/App'
import { AppState } from '../src/state'
import { AppBarProvider, crumbsFor, type AppBarConfig } from '../src/state/appBar'
import { WizardProvider } from '../src/walkthrough/wizard'
import { menuReducer, type MenuState } from '../src/components/Menu'
import { ProfileMenu } from '../src/components/ProfileMenu'
import { FileMenu, TopBar } from '../src/components/TopBar'
import { accounts } from '../src/store/accounts'
import { readFileSync } from 'node:fs'
import { bundled } from '../walkthroughs'
import { newRun } from '../src/walkthrough/run'

const html = (el: ReactElement) => renderToString(el).replaceAll('<!-- -->', '')
const at = (path: string, el: ReactElement, initial?: AppBarConfig) =>
  html(h(MemoryRouter, { initialEntries: [path] }, h(AppState, null, h(AppBarProvider, { initial, children: h(WizardProvider, null, el) }))))

describe('menuReducer (keyboard)', () => {
  const closed: MenuState = { open: false, active: -1 }
  const key = (s: MenuState, k: string) => menuReducer(s, { type: 'key', key: k, count: 3 })
  test('ArrowDown/Up on the closed trigger open on the first/last item', () => {
    expect(key(closed, 'ArrowDown')).toEqual({ open: true, active: 0 })
    expect(key(closed, 'ArrowUp')).toEqual({ open: true, active: 2 })
  })
  test('arrows move and wrap; Home/End jump', () => {
    const s = { open: true, active: 0 }
    expect(key(s, 'ArrowDown')).toEqual({ open: true, active: 1 })
    expect(key({ open: true, active: 2 }, 'ArrowDown')).toEqual({ open: true, active: 0 })
    expect(key(s, 'ArrowUp')).toEqual({ open: true, active: 2 })
    expect(key({ open: true, active: 1 }, 'Home')).toEqual({ open: true, active: 0 })
    expect(key(s, 'End')).toEqual({ open: true, active: 2 })
  })
  test('Escape and Tab close; toggle opens without moving focus into the menu; close closes', () => {
    expect(key({ open: true, active: 1 }, 'Escape')).toEqual(closed)
    expect(key({ open: true, active: 1 }, 'Tab')).toEqual(closed)
    expect(menuReducer(closed, { type: 'toggle' })).toEqual({ open: true, active: -1 })
    expect(menuReducer({ open: true, active: 0 }, { type: 'toggle' })).toEqual(closed)
    expect(menuReducer({ open: true, active: 0 }, { type: 'close' })).toEqual(closed)
  })
  test('Enter/Space on the trigger (openFirst) open on the first item, or close an open menu', () => {
    expect(menuReducer(closed, { type: 'openFirst' })).toEqual({ open: true, active: 0 })
    expect(menuReducer({ open: true, active: 1 }, { type: 'openFirst' })).toEqual(closed)
  })
  test('other keys change nothing', () => {
    const s = { open: true, active: 1 }
    expect(key(s, 'x')).toBe(s)
    expect(key(closed, 'Escape')).toBe(closed)
  })
})

describe('top bar', () => {
  const swapBar: AppBarConfig = {
    title: 'Swap', crumbs: [{ label: 'dave', to: '/chains' }, { label: 'Swap' }], chip: 'Swap.sol 0x1234…abcd',
    actions: [{ kind: 'choice', id: 'acting', label: 'Acting as', value: '', options: [{ value: '0x1', label: 'bob' }], onChange() {} }],
  }

  test('the shell shows brand, File, the page title from useAppBar, the chain picker and the profile trigger; no Active context card', () => {
    const out = at('/accounts', h(Shell), swapBar)
    expect(out).toContain('EVM Playground')
    expect(out).toMatch(/aria-haspopup="menu"[^>]*>File/)
    expect(out).toContain('<h1')
    expect(out).toContain('>Swap</h1>')
    expect(out).toContain('aria-label="Chain"')
    expect(out).toContain('Select a chain')
    expect(out).toContain('– account menu"')
    expect(out).not.toContain('Active context')
    expect(out).toContain('aria-label="Theme"') // still reachable
  })

  test('page configs render in the bar: crumbs, chip, choice segments (Swap/Trade Acting as), Trade-style venue choice, buttons', () => {
    const out = at('/chains', h(TopBar), {
      ...swapBar,
      actions: [
        ...swapBar.actions!,
        { kind: 'choice', id: 'venue', label: 'Venue', value: 'on', options: [{ value: 'on', label: 'On-chain' }, { value: 'off', label: 'Off-chain' }], onChange() {} },
        { kind: 'button', id: 'new', label: 'New chain', icon: null, text: true, primary: true, onClick() {} },
      ],
    })
    expect(out).toContain('aria-label="Breadcrumb"')
    expect(out).toContain('>dave</a>')
    expect(out).toContain('Swap.sol 0x1234…abcd')
    expect(out).toContain('Acting as'); expect(out).toContain('>bob</button>')
    expect(out).toContain('Venue'); expect(out).toContain('>Off-chain</button>')
    expect(out).toContain('New chain')
    const chains = at('/chains/block/3', h(TopBar), { title: 'Chains', crumbs: crumbsFor('/chains/block/3', 'demo') })
    expect(chains).toContain('Block #3')
  })

  test('real pages still render inside the shell', () => {
    expect(at('/swap', h(Shell))).toContain('Select a chain first.')
    expect(at('/trade', h(Shell))).toContain('Select a chain first.')
    expect(at('/get-started', h(Shell))).toContain('Guided walkthroughs')
    expect(at('/accounts', h(Shell))).toContain('Create account')
  })

  test('File menu: New, Open…, Save, Import chain…, Export chain — disabled until wired, enabled when given', () => {
    const items = ['New', 'Open…', 'Save', 'Import chain…', 'Export chain']
    const off = at('/accounts', h(FileMenu, { defaultOpen: true }))
    expect(off).toContain('role="menu"')
    for (const i of items) expect(off).toMatch(new RegExp(`role="menuitem"[^>]*aria-disabled="true"[^>]*>${i}<`))
    const noop = () => {}
    const on = at('/accounts', h(FileMenu, { defaultOpen: true, actions: { new: noop, open: noop, save: noop, importChain: noop, exportChain: noop } }))
    for (const i of items) expect(on).toMatch(new RegExp(`role="menuitem"[^>]*>${i}<`))
    expect(on).not.toContain('aria-disabled="true"')
  })
})

describe('profile menu', () => {
  test('trigger shows the acting account initial and label; the menu lists accounts with labels, Create account… and Manage accounts', () => {
    const a = accounts.create('alice'), b = accounts.create('bob')
    try {
      const closed = at('/accounts', h(ProfileMenu))
      expect(closed).toContain(`aria-label="${accounts.list()[0]!.label} – account menu"`) // label-in-name
      expect(closed).toContain('aria-expanded="false"')
      const first = accounts.list()[0]!
      expect(closed).toContain(`>${first.label[0]!.toUpperCase()}</span>`)
      expect(closed).toContain(`<span class="sr-only max-w-32 truncate sm:not-sr-only">${first.label}</span>`) // exposed at phone width too
      const open = at('/accounts', h(ProfileMenu, { defaultOpen: true }))
      expect(open).toContain('aria-expanded="true"')
      expect(open).toContain('>alice<'); expect(open).toContain('>bob<')
      expect(open).toMatch(/role="menuitemradio"[^>]*aria-checked="true"/)
      expect(open).toContain('Create account…')
      expect(open).toContain('Manage accounts')
      expect(open).toContain('—') // balances: none without a chain
    } finally { accounts.remove(a.address); accounts.remove(b.address) }
  })
})

describe('walkthrough focus mode', () => {
  test('the bar carries data-wz-focus while a walkthrough runs in focus mode (sticky, so it stays on phone)', () => {
    const w = bundled[0]!
    const out = html(h(MemoryRouter, null, h(AppState, null, h(AppBarProvider, { children: h(WizardProvider, { seed: { w, run: newRun(w) } }, h(TopBar)) }))))
    expect(out).toMatch(/^<header data-wz-focus="" class="sticky top-0 /)
    expect(at('/accounts', h(TopBar))).not.toContain('data-wz-focus')
  })
  test('index.css dims the bar like main: outermost unmarked children only, marked ones stay bright', () => {
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
    expect(css).toContain(':is(main, header)[data-wz-focus] > :not(:has([data-wz-on])):not([data-wz-on])')
    expect(css).toContain(':is(main, header)[data-wz-focus] :has([data-wz-on]) > :not([data-wz-on]):not(:has([data-wz-on]))')
  })
})

test('no-account trigger names itself "No account – account menu"', () => {
  for (const a of accounts.list()) accounts.remove(a.address) // memory store in tests
  expect(at('/accounts', h(ProfileMenu))).toContain('aria-label="No account – account menu"')
})
