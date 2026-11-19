import { test, expect } from 'bun:test'
import { initialTheme, getTheme, setTheme } from '../src/theme/theme'

test('first visit follows the OS', () => {
  expect(initialTheme(null, true)).toBe('dark')
  expect(initialTheme(null, false)).toBe('light')
})
test('stored valid theme wins; bogus is ignored', () => {
  expect(initialTheme('paper', true)).toBe('paper')
  expect(initialTheme('bogus', false)).toBe('light')
})
test('theme store survives throwing localStorage', () => {
  const g = globalThis as any
  const saved = Object.getOwnPropertyDescriptor(g, 'localStorage')
  Object.defineProperty(g, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
  g.document = { documentElement: { dataset: {} } }
  try {
    expect(() => setTheme('paper')).not.toThrow()
    expect(getTheme()).toBe('paper')
  } finally {
    if (saved) Object.defineProperty(g, 'localStorage', saved); else delete g.localStorage
    delete g.document
  }
})
