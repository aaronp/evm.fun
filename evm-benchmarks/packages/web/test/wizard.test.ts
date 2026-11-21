import { describe, test, expect } from 'bun:test'
import { createElement as h, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { bundled } from '../walkthroughs'
import { binding, lastRegistered } from '../src/walkthrough/bindings'
import { WizardProvider, checkTone, useWizardAction, useWizardField, useWizardMark, useWizardReport } from '../src/walkthrough/wizard'
import { WizardInline } from '../src/components/WizardInline'
import { AppState } from '../src/state'
import { newRun } from '../src/walkthrough/run'
import type { Outputs, Run, StepType } from '../src/walkthrough/types'

const w = bundled.find(x => x.id === 'gbp-usd')!
const step = (id: string) => w.steps.find(s => s.id === id)!
const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`
const GBP: Outputs['launchAsset'] = { address: a(1), symbol: 'GBP', name: 'Pound', decimals: 2 }
const USD: Outputs['launchAsset'] = { address: a(2), symbol: 'USD', name: 'Dollar', decimals: 6 }
const tx = `0x${'ab'.repeat(32)}` as const
const fullRun = (): Run => ({
  ...newRun(w),
  values: { alice: { label: 'alice', address: a(7) }, bob: { label: 'bob', address: a(8) }, chain: { id: 'c1', name: 'Example' }, GBP, USD, swap: { address: a(5) }, offer: { offerId: '0', tx } },
  steps: { take: { inputs: {}, outputs: { tx, reverted: false }, at: '' } },
})

const render = (el: any, seed?: { run: Run; index: number }) =>
  renderToString(h(MemoryRouter, null, h(AppState, null, seed ? h(WizardProvider, { seed: { w, ...seed } }, el) : el))).replaceAll('<!-- -->', '')

describe('binding', () => {
  test('covers every step type', () => {
    const types: StepType[] = ['account', 'chain', 'launchAsset', 'deploySwap', 'approve', 'makeOffer', 'take', 'view']
    expect(new Set(w.steps.map(s => s.do))).toEqual(new Set(types))
    for (const s of w.steps) {
      const b = binding(s, w)
      expect(typeof b.path(fullRun())).toBe('string')
      expect(typeof b.report).toBe('string')
    }
  })
  test('ids per step', () => {
    const run = fullRun(), q = `base=${GBP.address}&quote=${USD.address}`
    expect(binding(step('alice'), w)).toMatchObject({ fields: ['account.label'], actions: ['account.create'], report: 'account.create' })
    expect(binding(step('alice'), w).path(run)).toBe('/accounts')
    expect(binding(step('chain'), w)).toMatchObject({ fields: ['chain.name'], actions: ['chains.new', 'chain.create'] })
    expect(binding(step('chain'), w).path(run)).toBe('/chains')
    expect(binding(step('gbp'), w)).toMatchObject({ fields: ['launch.name', 'launch.symbol', 'launch.decimals', 'launch.supply', 'launch.issuer'], actions: ['assets.launch', 'launch.submit'] })
    expect(binding(step('gbp'), w).path(run)).toBe('/assets')
    expect(binding(step('swap'), w)).toMatchObject({ fields: [], actions: ['swap.deploy'] })
    expect(binding(step('swap'), w).path(run)).toBe(`/swap?${q}`)
    expect(binding(step('aliceOk'), w)).toMatchObject({ fields: ['offer.side', 'offer.amount', 'offer.price'], actions: ['offer.approve'], report: 'offer.approve' })
    expect(binding(step('offer'), w)).toMatchObject({ actions: ['offer.create'], report: 'offer.create' })
    expect(binding(step('bobOk'), w)).toMatchObject({ fields: ['take.offer'], actions: ['take.approve'] })
    expect(binding(step('take'), w)).toMatchObject({ fields: ['take.offer'], actions: ['take.submit'] })
    expect(binding(step('view'), w)).toMatchObject({ fields: [], actions: [] })
    expect(binding(step('view'), w).path(run)).toBe(`/swap/report?tx=${tx}&${q}`)
  })
  test('Next presses the last registered action', () => {
    const { actions } = binding(step('chain'), w)
    expect(lastRegistered(actions, new Set(['chains.new', 'chain.create']))).toBe('chain.create')
    expect(lastRegistered(actions, new Set(['chains.new']))).toBe('chains.new')
    expect(lastRegistered(actions, new Set())).toBeUndefined()
  })
})

function Page() {
  const [label, setLabel] = useState('')
  useWizardField('account.label', label, setLabel)
  useWizardAction('account.create', () => {})
  useWizardReport()
  const mark = useWizardMark()
  return h('div', mark('account.card'), h('input', { value: label, readOnly: true }), h('button', mark('account.create'), 'Create account'), h('span', mark('swap.deploy'), 'x'))
}

describe('hooks', () => {
  test('mark: on + pulse on the action Next presses, on for the area, nothing elsewhere', () => {
    const html = render(h(Page), { run: newRun(w), index: 0 })
    expect(html).toContain('<div data-wizard="account.card" data-wz-on="">')
    expect(html).toContain('<button data-wizard="account.create" data-wz-on="" data-wz-pulse="">Create account</button>')
    expect(html).toContain('<span data-wizard="swap.deploy">x</span>')
  })
  test('field: the initial value is set on arrival', () => {
    expect(render(h(Page), { run: newRun(w), index: 0 })).toContain('value="alice"')
  })
  test('field: the actual value wins over the initial one', () => {
    const run: Run = { ...newRun(w), steps: { alice: { inputs: { 'account.label': 'alicia' }, outputs: { label: 'alicia', address: a(7) }, at: '' } } }
    expect(render(h(Page), { run, index: 0 })).toContain('value="alicia"')
  })
  test('no-ops without an active walkthrough: renders as without the wizard', () => {
    const plain = render(h(Page))
    expect(plain).toContain('value=""')
    expect(plain).not.toContain('data-wz-')
    expect(renderToString(h(MemoryRouter, null, h(AppState, null, h(WizardProvider, null, h(Page)))))).toBe(renderToString(h(MemoryRouter, null, h(AppState, null, h(Page)))))
  })
  test('a done step does not pulse', () => {
    const run: Run = { ...newRun(w), steps: { alice: { inputs: {}, outputs: { label: 'alice', address: a(7) }, at: '' } } }
    expect(render(h(Page), { run, index: 0 })).not.toContain('data-wz-pulse')
  })
})

describe('WizardInline', () => {
  test('shows the step text and Next when its step is current', () => {
    const html = render(h(WizardInline, { step: 'chain' }), { run: fullRun(), index: 2 })
    expect(html).toContain(step('chain').title)
    expect(html).toContain(step('chain').text)
    expect(html).toContain('>Next</button>')
  })
  test('is exempt from focus dimming (its dialog sits under main, beside marked inputs)', () => {
    expect(render(h(WizardInline, { step: 'chain' }), { run: fullRun(), index: 2 })).toStartWith('<div data-wz-ribbon=""')
  })
  test('renders nothing otherwise', () => {
    expect(render(h(WizardInline, { step: 'chain' }), { run: fullRun(), index: 3 })).toBe('')
    expect(render(h(WizardInline, { step: 'chain' }))).toBe('')
  })
})

describe('check tone', () => {
  test('pass, fail, fail after an edit', () => {
    expect(checkTone(true, false)).toBe('pass')
    expect(checkTone(true, true)).toBe('pass')
    expect(checkTone(false, false)).toBe('fail')
    expect(checkTone(false, true)).toBe('differs')
  })
})

describe('Ribbon', () => {
  test('check lines and made-summaries for the order-book steps', async () => {
    const { checkText, made } = await import('../src/components/Ribbon')
    expect(checkText({ order: '$ask2', status: 'partial', filled: '500 $GBP' })).toBe('$ask2 is partial, 500 $GBP filled')
    expect(checkText({ order: '$ask1', status: 'filled' })).toBe('$ask1 is filled')
    expect(checkText({ trades: '$book', count: 2 })).toBe('$book has 2 trades')
    expect(checkText({ outcome: 'reverted', error: 'X' })).toBe('The take was reverted (X)')
    expect(made({ address: `0x${'1'.repeat(40)}`, venue: 'offchain' })).toBe('Settlement')
    expect(made({ orderId: '7', filled: '0' })).toBe('order #7')
    expect(made({ filled: '150000', tx: `0x${'ab'.repeat(32)}` })).toBeUndefined()
    expect(checkText({ pool: '$pool', kGrew: true })).toBe('k of $pool grew since the first deposit')
    expect(made({ tx: `0x${'ab'.repeat(32)}`, shares: '112694276695958814472445', k: '1' })).toBe('112,694.28 LP shares')
  })
  test('stepper, current step text and the ribbon buttons while a walkthrough is active', async () => {
    const { Ribbon } = await import('../src/components/Ribbon')
    const html = render(h(Ribbon), { run: fullRun(), index: 2 })
    for (const s of w.steps) expect(html).toContain(s.title)
    expect(html).toContain('Step 3 of 11')
    expect(html).toContain(step('chain').text)
    for (const b of ['Back', 'Next', 'Exit', 'Restart', 'Focus', 'Run values', 'Download']) expect(html).toContain(`>${b}<`)
    expect(html).toContain('aria-current="step"')
  })
  test('nothing without a walkthrough', async () => {
    const { Ribbon } = await import('../src/components/Ribbon')
    expect(render(h(Ribbon))).toBe('')
  })
})

describe('review fixes', () => {
  test('the pair comes from the step, not launch order: quote launched before base', () => {
    // USD launched first; the offer still sells GBP (base) for USD (quote)
    const order = ['alice', 'bob', 'chain', 'usd', 'gbp', 'swap', 'aliceOk', 'offer', 'bobOk', 'take', 'view']
    const w2 = { ...w, steps: order.map(step) }
    const run: Run = { ...fullRun(), values: { alice: { label: 'alice', address: a(7) }, bob: { label: 'bob', address: a(8) }, chain: { id: 'c1', name: 'Example' }, USD, GBP, swap: { address: a(5) }, offer: { offerId: '0', tx } } }
    const q = `base=${GBP.address}&quote=${USD.address}`
    for (const id of ['swap', 'aliceOk', 'offer', 'bobOk', 'take']) expect(binding(step(id), w2).path(run)).toBe(`/swap?${q}`)
    expect(binding(step('view'), w2).path(run)).toBe(`/swap/report?tx=${tx}&${q}`)
  })
  test('an approve already satisfied (done, unrecorded) is not where a resumed run stands', async () => {
    const { firstOpen } = await import('../src/walkthrough/wizard')
    const recorded = ['alice', 'bob', 'chain', 'gbp', 'usd', 'swap']
    const run: Run = { ...fullRun(), steps: Object.fromEntries(recorded.map(id => [id, { inputs: {}, outputs: {} as any, at: '' }])) }
    expect(w.steps[firstOpen(w, run)]!.id).toBe('aliceOk')
    const doneMap = Object.fromEntries(w.steps.map(s => [s.id, [...recorded, 'aliceOk'].includes(s.id)]))
    expect(w.steps[firstOpen(w, run, doneMap)]!.id).toBe('offer')
  })
  test("a step whose values can't be worked out shows why, naming the step and key", async () => {
    const { Ribbon } = await import('../src/components/Ribbon')
    const html = render(h(Ribbon), { run: newRun(w), index: w.steps.findIndex(s => s.id === 'gbp') })
    expect(html).toContain('Step gbp: $alice has no value yet')
  })
})
