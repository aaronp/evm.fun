import { test, expect } from 'bun:test'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { bundled } from '../walkthroughs'
import { groups } from '../src/App'
import { AppState } from '../src/state'
import { AppBarProvider } from '../src/state/appBar'
import { Editor, GetStarted, Walkthroughs, check, loadAll, resetEdit, saveEdit } from '../src/pages/GetStarted'

const html = (el: any) => renderToString(el).replaceAll('<!-- -->', '')
const w = bundled[0]!

test('lists both bundled walkthroughs with step counts', () => {
  const out = html(h(Walkthroughs, { entries: bundled.map(w => ({ w, edited: false, done: 0 })) }))
  for (const b of bundled) { expect(out).toContain(b.title); expect(out).toContain(`${b.steps.length} steps`) }
  expect(out).toContain('>Start<')
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
  expect(groups[0].items.map(([n]) => n)).toEqual(['Get started', 'Accounts', 'Chains'])
  expect(html(h(MemoryRouter, null, h(AppState, null, h(AppBarProvider, null, h(GetStarted)))))).toContain('Guided walkthroughs')
})
