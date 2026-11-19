import { test, expect } from 'bun:test'
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'

const PAL = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const RAW = [
  /#[0-9a-fA-F]{3,8}\b/,
  /\b(?:rgba?|hsla?)\(/,
  new RegExp(`\\b(?:bg|text|border|ring|outline|divide|fill|stroke|from|to|via|placeholder|accent|caret|shadow)-(?:${PAL})-\\d{2,3}\\b`),
  /\b(?:bg|text|border|ring|outline|divide|fill|stroke|from|to|via|placeholder|accent|caret|shadow)-(?:white|black)\b/,
]

// Files still using raw colours; each is removed from this list by the task that ports it.
const NOT_YET_PORTED: string[] = [
  'src/App.tsx',
  'src/components/Erc20Card.tsx',
  'src/components/FunctionForm.tsx',
  'src/components/ReceiptView.tsx',
  'src/pages/Accounts.tsx',
  'src/pages/Benchmark.tsx',
  'src/pages/Chains.tsx',
  'src/pages/Explorer.tsx',
  'src/pages/Studio.tsx',
  'src/pages/Transact.tsx',
  'src/ui/button.tsx',
  'src/ui/card.tsx',
  'src/ui/notice.tsx',
]

const root = new URL('..', import.meta.url).pathname
const files = [...new Glob('src/**/*.{ts,tsx,css}').scanSync(root)].filter((f) => f !== 'src/theme/tokens.css').sort()
const matches = (f: string) => RAW.some((re) => re.test(readFileSync(root + f, 'utf8')))

test('no raw colours outside tokens.css (except not-yet-ported files)', () => {
  const bad = files.filter((f) => !NOT_YET_PORTED.includes(f) && matches(f))
  expect(bad).toEqual([])
})
test('allowlist is not stale', () => {
  const stale = NOT_YET_PORTED.filter((f) => !files.includes(f) || !matches(f))
  expect(stale).toEqual([])
})
