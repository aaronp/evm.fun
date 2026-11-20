import { test, expect, afterEach } from 'bun:test'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { adoptAuto, autoDelay, parseAuto, setAutoDelay } from '../src/walkthrough/auto'
import { FuseNext } from '../src/components/FuseNext'

const store = new Map<string, string>()
;(globalThis as any).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
afterEach(() => store.clear())

test('parseAuto: units, off, and junk', () => {
  expect(parseAuto('5s')).toBe(5000)
  expect(parseAuto('3')).toBe(3000)
  expect(parseAuto('1500ms')).toBe(1500)
  expect(parseAuto('0.5m')).toBe(30000)
  expect(parseAuto(' 2S ')).toBe(2000)
  expect(parseAuto('off')).toBeNull()
  expect(parseAuto('0')).toBeNull()
  expect(parseAuto('soon')).toBeUndefined()
  expect(parseAuto(null)).toBeUndefined()
})

test('adoptAuto keeps the delay for the session, prefers the hash query, and off clears it', () => {
  adoptAuto('?auto=5s', '?auto=9s')
  expect(autoDelay()).toBe(5000)
  adoptAuto('', '?auto=2s')
  expect(autoDelay()).toBe(2000)
  adoptAuto('?base=0x1', '') // no auto: unchanged
  expect(autoDelay()).toBe(2000)
  adoptAuto('?auto=off', '')
  expect(autoDelay()).toBeUndefined()
})

const fuse = (o: Partial<Parameters<typeof FuseNext>[0]> = {}) =>
  renderToString(h(FuseNext, { step: 's', busy: false, disabled: false, onNext: () => {}, ...o }))

test('FuseNext: a plain, non-submitting Next without auto; ring and countdown with it', () => {
  const plain = fuse()
  expect(plain).toContain('type="button"')
  expect(plain).not.toContain('data-wz-fuse')
  expect(plain).toContain('aria-label="Auto-advance"') // ▶ to start it
  expect(fuse({ disabled: true })).not.toContain('aria-label="Auto-advance"') // not at the end
  setAutoDelay(5000)
  const on = fuse()
  expect(on).toContain('data-wz-fuse')
  expect(on).toContain('5s')
  expect(on).not.toContain('aria-label="Auto-advance"') // already running: ⏸ instead
  expect(fuse({ error: 'nope' })).not.toContain('data-wz-fuse') // stops on an error
  expect(fuse({ disabled: true })).not.toContain('data-wz-fuse') // and at the end
})
