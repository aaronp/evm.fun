import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'

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
for (const bg of ['bg', 'surface']) pairs.push(['accent', bg, 3]) // focus ring

for (const theme of ['dark', 'light', 'paper']) {
  const t = themeMap(theme)
  test(`${theme}: contrast`, () => {
    for (const [fg, bg, min] of pairs) {
      expect(t[fg] && t[bg], `${theme}: missing ${fg} or ${bg}`).toBeTruthy()
      const r = ratio(t[fg]!, t[bg]!)
      expect(r >= min, `${theme}: ${fg} on ${bg} = ${r.toFixed(2)} (< ${min})`).toBe(true)
    }
  })
}
