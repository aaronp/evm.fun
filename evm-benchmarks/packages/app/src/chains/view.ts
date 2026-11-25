// Pure view helpers for the Chains screens (the prototype's presentation helpers).
import { formatCode, normalizeCode, type ChainRecord } from '@evmb/workspace'
import { C } from '../theme'

const INVALID = "That code isn't valid. Check it and try again."
const REFUSALS: Record<string, string> = {
  'code expired': 'That code has expired. Ask for a new one.',
  'code used up': 'That code has no deployments left.',
  'code revoked': 'That code was revoked.',
  'no such code': INVALID,
  'bad code': INVALID,
}
/** The worker's refusal reason as the user reads it; any other reason as given. */
export const refusalCopy = (reason: string) => REFUSALS[reason] ?? reason

/** The `code` of a `?code=` link, normalised and shown as the user would type it. */
export function codeFromSearch(search: string): string | undefined {
  const c = new URLSearchParams(search).get('code')
  return c ? formatCode(normalizeCode(c)) : undefined
}

// the prototype's STATUS, plus unfinished (its warning colours)
export const STATUS: Record<ChainRecord['status'], { label: string; bg: string; fg: string; dot: string }> = {
  local: { label: 'Local', bg: '#F2F4F7', fg: '#344054', dot: C.dotLocal },
  deployed: { label: 'Deployed', bg: '#ECFDF3', fg: '#067647', dot: C.dotDeployed },
  unfinished: { label: 'Unfinished', bg: '#FFFAEB', fg: '#B54708', dot: C.warn },
}
/** My access to my own chains (I created them all here). */
export const MY_ACCESS = 'Admin'

const PALETTE = ['#3B5BDB', '#107569', '#6941C6', '#B54708', '#C11574', '#175CD3', '#344054']
/** A chain's glyph colour, stable per id. */
export const chainColor = (id: string) => PALETTE[[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % PALETTE.length]!

export function initials(name: string) {
  const s = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return s === '' ? '?' : s
}

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR
export function ago(now: number, t: number) {
  const d = Math.max(0, now - t)
  if (d < MIN) return 'just now'
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`
  const days = Math.floor(d / DAY)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The prototype's checkChainName: null when ok. */
export function checkChainName(chains: ChainRecord[], name: string): string | null {
  if (name.trim() === '') return 'Give the chain a name.'
  return chains.some((c) => sameName(c.name, name)) ? `You already have a chain called “${name.trim()}”.` : null
}

/** The prototype's S.avatar (square). */
export const glyph = (id: string, size: number) => ({
  flex: 'none', width: size, height: size, display: 'grid', placeItems: 'center', color: '#FFFFFF', fontWeight: 700,
  fontSize: Math.round(size / 3), background: chainColor(id), borderRadius: Math.round(size / 4),
}) as const

/** The prototype's S.badge. */
export const badge = (s: ChainRecord['status']) => ({
  display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 999, fontSize: 12, fontWeight: 500,
  whiteSpace: 'nowrap', background: STATUS[s].bg, color: STATUS[s].fg,
}) as const
