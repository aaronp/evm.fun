import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { THEMES } from '../src/theme/theme'

const css = readFileSync(new URL('../src/theme/tokens.css', import.meta.url), 'utf8')

function themeMap(name: string): Record<string, string> {
  const m = css.match(new RegExp(`:root\\[data-theme="${name}"\\]\\s*\\{([^}]*)\\}`))
  if (!m) throw new Error(`no ${name} block in tokens.css`)
  return Object.fromEntries([...m[1]!.matchAll(/--c-([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((x) => [x[1]!, x[2]!]))
}

const lin = (h: string, i: number) => {
  const c = parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16) / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const lum = (h: string) => 0.2126 * lin(h, 0) + 0.7152 * lin(h, 1) + 0.0722 * lin(h, 2)
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

// [foreground, background, min ratio]
const pairs: [string, string, number][] = []
for (const fg of ['text', 'text-2', 'muted', 'subtle']) for (const bg of ['bg', 'surface', 'selected']) pairs.push([fg, bg, 4.5])
for (const bg of ['bg', 'surface']) pairs.push(['faint', bg, 4.5])
for (const [fg, soft] of [['accent', 'accent-soft'], ['success-text', 'success-soft'], ['warn-text', 'warn-soft'], ['danger', 'danger-soft']] as const)
  for (const bg of ['surface', soft]) pairs.push([fg, bg, 4.5])
pairs.push(['on-accent', 'accent', 4.5])
for (const fg of ['text', 'text-2', 'muted', 'success-text', 'warn-text', 'danger']) pairs.push([fg, 'accent-soft', 4.5]) // walkthrough ribbon
for (const bg of ['bg', 'surface']) pairs.push(['accent', bg, 3]) // focus ring
for (const fg of ['text-2', 'muted', 'faint', 'accent', 'code-keyword', 'code-string', 'success-text', 'warn-text']) pairs.push([fg, 'panel', 4.5]) // editor background
pairs.push(['accent', 'selected', 3]) // selected-state border/outline
for (let i = 1; i <= 6; i++) pairs.push([`series-${i}`, 'surface', 3]) // chart graphics

for (const fg of ['ask', 'bid']) for (const bg of ['surface', 'selected', 'surface-hover']) pairs.push([fg, bg, 4.5]) // swap book prices
for (const bg of ['ask', 'bid']) pairs.push(['on-accent', bg, 4.5]) // swap side toggle, Take and Create buttons
for (const [fg, bg] of [['bid', 'panel'], ['subtle', 'panel'], ['muted', 'panel'], ['bid', 'bg'], ['ask', 'bg']] as const) pairs.push([fg, bg, 4.5]) // trade: mid row, venue switch, last price, trades
pairs.push(['warn', 'warn-soft', 3], ['accent', 'surface-hover', 4.5], ['text', 'panel', 4.5]) // trade: allowance icon, My orders row hover link, form fields
for (let i = 1; i <= 4; i++) pairs.push([`tone-${i}-fg`, `tone-${i}-bg`, 4.5]) // asset badges

const cssThemes = [...css.matchAll(/:root\[data-theme="(\w+)"\]/g)].map((m) => m[1]!)
test('tokens.css themes match THEMES', () => {
  expect([...cssThemes].sort()).toEqual([...THEMES].sort())
})
test('index.html pre-paint script knows every theme', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  for (const t of THEMES) expect(html, `index.html missing '${t}'`).toContain(`'${t}'`)
})

for (const theme of cssThemes) {
  const t = themeMap(theme)
  test(`${theme}: contrast`, () => {
    for (const [fg, bg, min] of pairs) {
      expect(t[fg] && t[bg], `${theme}: missing ${fg} or ${bg}`).toBeTruthy()
      const r = ratio(t[fg]!, t[bg]!)
      expect(r >= min, `${theme}: ${fg} on ${bg} = ${r.toFixed(2)} (< ${min})`).toBe(true)
    }
  })
}
