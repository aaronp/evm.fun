import { describe, test, expect } from 'bun:test'
import { legacyRoute } from '../src/routes'

describe('legacyRoute', () => {
  test('index', () => { expect(legacyRoute('/explorer')).toBe('/chains'); expect(legacyRoute('/explorer/')).toBe('/chains') })
  test('block', () => expect(legacyRoute('/explorer/block/5')).toBe('/chains/block/5'))
  test('block txs', () => expect(legacyRoute('/explorer/block/5/txs')).toBe('/chains/block/5/txs'))
  test('tx and address', () => {
    expect(legacyRoute('/explorer/tx/0xab')).toBe('/chains/tx/0xab')
    expect(legacyRoute('/explorer/address/0xcd')).toBe('/chains/address/0xcd')
  })
  test('other paths give null', () => {
    for (const p of ['/chains', '/accounts', '/explorerx', '/', '']) expect(legacyRoute(p)).toBeNull()
  })
})

describe('/swap', () => {
  test('Swap sits under Markets after Assets and its route renders the page', async () => {
    const { createElement: h } = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { MemoryRouter } = await import('react-router-dom')
    const { groups, real } = await import('../src/App')
    const { AppState } = await import('../src/state')
    const { AppBarProvider } = await import('../src/state/appBar')
    expect(groups.find(g => g.label === 'Markets')!.items.map(([n]) => n)).toEqual(['Assets', 'Swap'])
    const html = renderToString(h(MemoryRouter, { initialEntries: ['/swap'] }, h(AppState, null, h(AppBarProvider, null, real.Swap!))))
    expect(html).toContain('aria-label="Chain"')
    expect(html).toContain('Select a chain first.')
  })
})

describe('/swap/report', () => {
  test('renders inline messages, not a crash, without a chain', async () => {
    const { createElement: h } = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { MemoryRouter } = await import('react-router-dom')
    const { SwapReport } = await import('../src/pages/SwapReport')
    const { AppState } = await import('../src/state')
    const { AppBarProvider } = await import('../src/state/appBar')
    const html = renderToString(h(MemoryRouter, { initialEntries: ['/swap/report?tx=0x12'] }, h(AppState, null, h(AppBarProvider, null, h(SwapReport)))))
    expect(html).toContain('Select a chain first.')
  })
})
