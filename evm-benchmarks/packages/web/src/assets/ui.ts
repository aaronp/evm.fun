import { zeroAddress } from 'viem'
import type { Asset } from '@evmb/assets'

const GLYPHS: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', ETH: 'Ξ' }
export const glyphFor = (symbol: string) => GLYPHS[symbol.toUpperCase()] ?? (symbol[0] ?? '?').toUpperCase()

/** Fixed token pairs (bg + text); literal class names so Tailwind sees them. */
export const TONES = [
  'bg-tone-1-bg text-tone-1-fg',
  'bg-tone-2-bg text-tone-2-fg',
  'bg-tone-3-bg text-tone-3-fg',
  'bg-tone-4-bg text-tone-4-fg',
] as const
export const badgeTone = (id: string) => {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return TONES[h % TONES.length]!
}

/** Rounded to `dp` places (default: the token's decimals), thousands-separated. */
export function formatAmount(v: bigint, decimals: number, dp = decimals): string {
  const shown = Math.min(dp, decimals)
  const unit = 10n ** BigInt(decimals - shown)
  const scaled = (v + unit / 2n) / unit
  const base = 10n ** BigInt(shown)
  const whole = (scaled / base).toLocaleString('en-US')
  return shown ? `${whole}.${(scaled % base).toString().padStart(shown, '0')}` : whole
}

export function parseAmount(text: string, decimals: number): { ok: bigint } | { error: string } {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text.trim())
  if (!m) return { error: 'Enter a positive number.' }
  const frac = m[2] ?? ''
  if (frac.length > decimals) return { error: `At most ${decimals} digits after the point.` }
  return { ok: BigInt(m[1]! + frac.padEnd(decimals, '0')) }
}

/** Percentage of the total per value, on bigints (basis points, so no float drift on large balances). */
export function shares(values: bigint[]): number[] {
  const total = values.reduce((a, b) => a + b, 0n)
  return values.map(v => (total ? Number((v * 10000n) / total) / 100 : 0))
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function issuerText(asset: Asset, accounts: { label: string; address: string }[]): string {
  if (asset.kind === 'native') return 'genesis'
  const i = asset.issuer
  if (!i || i === zeroAddress) return '—'
  return accounts.find(a => a.address.toLowerCase() === i.toLowerCase())?.label ?? shortAddress(i)
}
