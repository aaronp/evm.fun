import { test, expect } from 'bun:test'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { bundled } from '../walkthroughs'
import { groups } from '../src/App'
import { AppState } from '../src/state'
import { AppBarProvider } from '../src/state/appBar'
import { Editor, begin, GetStarted, Walkthroughs, check, loadAll, filterWalkthroughs, allTags, resetEdit, saveEdit } from '../src/pages/GetStarted'

const html = (el: any) => renderToString(el).replaceAll('<!-- -->', '')
const w = bundled[0]!

test('lists both bundled walkthroughs with step counts', () => {
  const out = html(h(Walkthroughs, { entries: bundled.map(w => ({ w, edited: false, done: 0 })) }))
  for (const b of bundled) { expect(out).toContain(b.title); expect(out).toContain(`${b.steps.length} steps`) }
  expect(out).toContain('>Start<')
  expect(out.match(/>Install</g)?.length).toBe(bundled.length) // one per walkthrough
})

test('a run in progress shows "n of m" and Resume / Restart', () => {
  const out = html(h(Walkthroughs, { entries: [{ w, edited: false, done: 3 }] }))
  expect(out).toContain(`3 of ${w.steps.length}`)
  expect(out).toContain('>Resume<'); expect(out).toContain('>Restart<')
})

test('an invalid edit shows step · field — message and disables Save', () => {
  const bad = JSON.stringify({ ...w, steps: w.steps.map((s, i) => i ? s : { ...s, title: '' }) })
  const r = check(bad, w.id)
  expect('errors' in r && r.errors[0]).toBe(`${w.steps[0]!.id} · title — Missing title`)
  const out = html(h(Editor, { id: w.id, initial: bad, onSave() {}, onCancel() {} }))
  expect(out).toContain('title — Missing title')
  expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/)
  expect(html(h(Editor, { id: w.id, initial: JSON.stringify(w), onSave() {}, onCancel() {} }))).not.toMatch(/<button[^>]*disabled=""[^>]*>Save/)
  expect('errors' in check('{', w.id)).toBe(true)
  expect('errors' in check(JSON.stringify({ ...w, id: 'other' }), w.id)).toBe(true)
})

test('a saved edit is listed as edited; Reset removes it', async () => {
  await saveEdit({ ...w, title: 'My version' })
  const e = (await loadAll()).find(x => x.w.id === w.id)!
  expect([e.edited, e.w.title]).toEqual([true, 'My version'])
  expect(html(h(Walkthroughs, { entries: [e] }))).toContain('edited')
  await resetEdit(w.id)
  const r = (await loadAll()).find(x => x.w.id === w.id)!
  expect([r.edited, r.w.title]).toEqual([false, w.title])
})

test('Setup group starts with Get started; page renders', () => {
  expect(groups[0].items.map(([n]) => n)).toEqual(['Get started', 'Accounts', 'Chains', 'Cloud'])
  expect(html(h(MemoryRouter, null, h(AppState, null, h(AppBarProvider, null, h(GetStarted)))))).toContain('Guided walkthroughs')
})

test('Start and Restart hand the wizard the edited copy', async () => {
  const edited = { ...w, title: 'My version' }, got: string[] = []
  const wz = { start: async (x: any) => void got.push('start ' + x.title), restart: (x?: any) => void got.push('restart ' + x.title) }
  await saveEdit(edited)
  const e = (await loadAll()).find(x => x.w.id === w.id)!
  begin(wz, e.w).start(); await begin(wz, e.w).restart()
  expect(got).toEqual(['start My version', 'restart My version'])
  await resetEdit(w.id)
})

const E = (id: string, title: string, summary: string, tags?: string[]) => ({ w: { ...w, id, title, summary, tags }, edited: false, done: 0 })
const es = [E('a', 'Alpha swap', 'Two traders', ['swap', 'AMM']), E('b', 'Beta book', 'Orders rest', ['order book', 'swap']), E('c', 'Delta', 'No tags')]
const ids = (r: typeof es) => r.map(x => x.w.id)

test('filterWalkthroughs: no filters keeps all; text matches title, summary and tag case-insensitively', () => {
  expect(ids(filterWalkthroughs(es, '', []))).toEqual(['a', 'b', 'c'])
  expect(ids(filterWalkthroughs(es, 'ALPHA', []))).toEqual(['a'])
  expect(ids(filterWalkthroughs(es, 'rest', []))).toEqual(['b'])
  expect(ids(filterWalkthroughs(es, 'amm', []))).toEqual(['a'])
  expect(ids(filterWalkthroughs(es, '  ', []))).toEqual(['a', 'b', 'c'])
})

test('filterWalkthroughs: several tags must all match', () => {
  expect(ids(filterWalkthroughs(es, '', ['swap']))).toEqual(['a', 'b'])
  expect(ids(filterWalkthroughs(es, '', ['swap', 'AMM']))).toEqual(['a'])
  expect(ids(filterWalkthroughs(es, 'beta', ['AMM']))).toEqual([])
})

test('allTags is sorted and de-duplicated', () => {
  expect(allTags(es)).toEqual(['AMM', 'order book', 'swap'])
})

test('the page renders a filter box and a chip per tag; bundled walkthroughs are tagged', () => {
  const out = html(h(Walkthroughs, { entries: bundled.map(w => ({ w, edited: false, done: 0 })) }))
  expect(out).toContain('aria-label="Filter walkthroughs"')
  expect(out).toContain('placeholder="Filter by title, summary or tag"')
  expect(out).toMatch(/<button[^>]*aria-pressed="false"[^>]*>hash lock</)
  expect(out).not.toContain('Showing')
  for (const b of bundled) expect(b.tags?.length).toBeGreaterThan(0)
})
