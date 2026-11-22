import { describe, test, expect } from 'bun:test'
import { legacyRoute, pageOf } from '../src/routes'

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

describe('pageOf', () => {
  test('keeps the top-level page only', () => {
    expect(pageOf('/assets')).toBe('/assets')
    expect(pageOf('/chains/tx/0xab')).toBe('/chains')
    expect(pageOf('/swap/report')).toBe('/swap')
    expect(pageOf('/')).toBe('/')
  })
})

describe('/swap', () => {
  test('Swap sits under Markets after Assets (then Pool, Trade) and its route renders the page', async () => {
    const { createElement: h } = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { MemoryRouter } = await import('react-router-dom')
    const { groups, real } = await import('../src/App')
    const { AppState } = await import('../src/state')
    const { AppBarProvider } = await import('../src/state/appBar')
    expect(groups.find(g => g.label === 'Markets')!.items.map(([n]) => n)).toEqual(['Assets', 'Swap', 'Cross-chain swap', 'Pool', 'Trade'])
    const html = renderToString(h(MemoryRouter, { initialEntries: ['/swap'] }, h(AppState, null, h(AppBarProvider, null, real.Swap!))))
    expect(html).toContain('Select a chain first.')
  })
})

describe('chain switcher', () => {
  test('the top bar chain picker offers the chains', async () => {
    const { createElement: h } = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { MemoryRouter } = await import('react-router-dom')
    const { AppState } = await import('../src/state')
    const { ChainPicker } = await import('../src/components/ChainPicker')
    const html = renderToString(h(MemoryRouter, null, h(AppState, null, h(ChainPicker))))
    expect(html).toContain('aria-label="Chain"')
    expect(html).toContain('Select a chain')
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

describe('/swap/report views', () => {
  const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`
  const GBP = { address: a(1), symbol: 'GBP', decimals: 2 }, USD = { address: a(2), symbol: 'USD', decimals: 6 }
  const render = async (el: (h: typeof import('react').createElement) => any) => {
    const { createElement: h } = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { MemoryRouter } = await import('react-router-dom')
    return renderToString(h(MemoryRouter, null, el(h))).replaceAll('<!-- -->', '')
  }

  test('success layout of a bid offer: price is quote per base (USD per GBP), links carry the pair', async () => {
    const { TakeReportView: ReportView } = await import('../src/pages/SwapReport')
    // maker bids 1,270.00 USD for 1,000.00 GBP; the taker sells GBP
    const offer = { id: 3n, maker: a(9), giveToken: USD.address, giveAmt: 1_270_000_000n, getToken: GBP.address, getAmt: 100_000n, status: 'filled', taker: a(8), closedBlock: 7n }
    const report = {
      outcome: 'taken', tx: `0x${'ab'.repeat(32)}`, block: 7n, txIndex: 0, gasUsed: 91_234n, swap: a(5), taker: a(8), offer,
      title: 'Offer #3 taken', pill: 'Settled · 1 transaction', summary: 'ok',
      kpis: [{ label: 'Price', value: `{price:${USD.address}:1270000000:${GBP.address}:100000}`, sub: `{unit:${USD.address}:${GBP.address}}` }],
      steps: [{ title: 'Offer #3 made', body: '', evidence: 'earlier · OfferMade', ok: true, mark: 'ok' }],
      balanceChanges: [], balanceNote: '', logs: [`Transfer ({symbol:${GBP.address}}) {name:${a(8)}} → {name:${a(9)}} {number:${GBP.address}:100000}`],
      fix: { text: 'x', label: 'Again' },
    }
    const html = await render(h => h(ReportView, { report: report as any, people: [{ label: 'tester', address: a(8) }], assets: [USD, GBP], hint: { base: GBP.address, quote: USD.address } }))
    expect(html).toContain('1.2700</span>')
    expect(html).toContain('USD per GBP')
    expect(html).toContain('price 1.2700 USD/GBP')
    expect(html).toContain(`Transfer (GBP) tester → ${'0x0000…0009'} 1,000.00`)
    expect(html).toContain('role="img" aria-label="ok"')
    expect(html).toContain(`href="/swap?base=${GBP.address}&amp;quote=${USD.address}"`)
  })

  test('error path: a takeReport that rejects renders the danger notice', async () => {
    const { ReportState, loadReport } = await import('../src/pages/SwapReport')
    const tx = `0x${'cd'.repeat(32)}`
    const got = await loadReport(() => Promise.reject(new Error('boom')), 'c', tx)
    expect(got).toEqual({ error: 'boom' })
    const html = await render(h => h(ReportState, { chainName: 'Local', tx, got, people: [] }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('No report for 0xcdcd…cdcd on Local: boom.')
  })
})
