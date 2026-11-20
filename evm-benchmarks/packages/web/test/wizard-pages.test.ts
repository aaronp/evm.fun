import { describe, test, expect } from 'bun:test'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Asset } from '@evmb/assets'
import { bundled } from '../walkthroughs'
import { WizardProvider } from '../src/walkthrough/wizard'
import { AppState } from '../src/state'
import { AppBarProvider } from '../src/state/appBar'
import { newRun } from '../src/walkthrough/run'
import { Accounts } from '../src/pages/Accounts'
import { Swap } from '../src/pages/Swap'
import { MakeOfferCard } from '../src/components/MakeOfferCard'
import type { Outputs, Run } from '../src/walkthrough/types'

const w = bundled.find(x => x.id === 'gbp-usd')!
const at = (id: string) => w.steps.findIndex(s => s.id === id)
const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`
const GBP: Outputs['launchAsset'] = { address: a(1), symbol: 'GBP', name: 'Pound', decimals: 2 }
const USD: Outputs['launchAsset'] = { address: a(2), symbol: 'USD', name: 'Dollar', decimals: 6 }
const beforeOffer = (): Run => ({
  ...newRun(w),
  values: { alice: { label: 'alice', address: a(7) }, bob: { label: 'bob', address: a(8) }, chain: { id: 'c1', name: 'Example' }, GBP, USD, swap: { address: a(5) } },
})
const asset = (o: Outputs['launchAsset']) => ({ kind: 'erc20', chainId: 'c1', id: o.address, ...o }) as unknown as Asset

const render = (el: any, seed?: { run: Run; index: number }) =>
  renderToString(h(MemoryRouter, null, h(AppState, null, h(AppBarProvider, null, seed ? h(WizardProvider, { seed: { w, ...seed } }, el) : el)))).replaceAll('<!-- -->', '')
const offerCard = () => h(MakeOfferCard, { base: asset(GBP), quote: asset(USD), funds: () => ({}), busy: false, onApprove() {}, onCreate: async () => true })
const wzAttrs = (html: string) => html.match(/data-wz-[\w-]+/g) ?? []

describe('pages in a walkthrough', () => {
  test('Accounts at an account step: the label filled, Create account pulses', () => {
    const html = render(h(Accounts), { run: newRun(w), index: at('alice') })
    expect(html).toMatch(/<input[^>]*value="alice"/)
    expect(html).toMatch(/<button[^>]*data-wizard="account.create"[^>]*data-wz-pulse=""[^>]*>Create account<\/button>/)
  })
  test('MakeOfferCard at the offer step: its card is on, the create button is marked, fields filled', () => {
    const html = render(offerCard(), { run: beforeOffer(), index: at('offer') })
    expect(html).toMatch(/<section[^>]*data-wizard="offer.card"[^>]*data-wz-on=""/)
    expect(html).toMatch(/<button[^>]*data-wizard="offer.create"[^>]*data-wz-pulse=""/)
    expect(html).toMatch(/<input[^>]*id="fa"[^>]*value="1000"/)
    expect(html).toMatch(/aria-label="Side"[^>]*data-wizard="offer.side"[^>]*data-wz-on=""/)
  })
})

describe('pages outside a walkthrough', () => {
  test('Accounts, Swap and MakeOfferCard carry no data-wz-* attributes, only data-wizard', () => {
    for (const el of [h(Accounts), h(Swap), offerCard()]) {
      expect(wzAttrs(render(el))).toEqual([])
    }
    expect(render(h(Accounts))).toContain('data-wizard="account.create"')
    expect(render(offerCard())).toContain('data-wizard="offer.create"')
  })
})
