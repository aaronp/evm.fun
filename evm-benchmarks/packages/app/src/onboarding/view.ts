// Pure view helpers for the Onboarding page (the prototype's onboardingVm). Times are unix seconds.
import type { Hex } from 'viem'
import { codeHash, formatCode, isValidCode, normalizeCode, type Workspace } from '@evmb/workspace'
import { ago, plural } from '../chains/view'

export type CodeView = Awaited<ReturnType<Workspace['codes']>>[number]
/** Plain codes issued in this session, by hash (in memory only). */
export type Plain = Map<Hex, string>

export const LOOK: Record<CodeView['status'], { label: string; bg: string; fg: string }> = {
  active: { label: 'Active', bg: '#ECFDF3', fg: '#067647' },
  used: { label: 'Used up', bg: '#F2F4F7', fg: '#344054' },
  expired: { label: 'Expired', bg: '#FFFAEB', fg: '#B54708' },
  revoked: { label: 'Revoked', bg: '#FEF3F2', fg: '#B42318' },
}

const MIN = 60, HOUR = 3600, DAY = 86400
/** The prototype's timeLeft: `2 d 3 h`, `2 h 5 m`, else `m:ss`. */
export function timeLeft(s: number) {
  if (s >= DAY) return `${Math.floor(s / DAY)} d ${Math.floor((s % DAY) / HOUR)} h`
  if (s >= HOUR) return `${Math.floor(s / HOUR)} h ${Math.floor((s % HOUR) / MIN)} m`
  const t = Math.max(0, Math.ceil(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
const agoS = (now: number, t: number) => ago(now * 1000, t * 1000)

/** One row of the Codes list. */
export function codeRow(c: CodeView, now: number, plain: Plain) {
  const known = plain.get(c.hash)
  const st = c.status
  return {
    code: known ? formatCode(known) : c.label || `Code ending …${c.hash.slice(-4)}`,
    status: LOOK[st].label,
    forText: c.label ? `For ${c.label}` : 'For anyone with the code',
    usesText: st === 'active' ? `${plural(c.usesLeft, 'deployment', 'deployments')} left of ${c.uses}` : `${c.uses - c.usesLeft} of ${c.uses} used`,
    expiryText: st === 'active' ? `expires in ${timeLeft(c.expiresAt - now)}`
      : st === 'expired' ? `expired ${agoS(now, c.expiresAt)}`
      : st === 'revoked' ? 'revoked' : `issued ${agoS(now, c.issuedAt)}`,
    grants: c.grants.map((g) => `by ${g.by.slice(0, 4)}…${g.by.slice(-2)} → chain ${g.chainId}`),
    canRevoke: st === 'active',
  }
}

/** The prototype's checkIssue, for what the app can check before signing: null when ok. */
export function checkIssue(code: string, uses: number, codes: CodeView[]): string | null {
  if (!isValidCode(code)) return 'A code is 4–16 letters or digits.'
  const h = codeHash(normalizeCode(code))
  if (codes.some((c) => c.hash === h)) return 'That code is already in use. Type another, or generate a new one.'
  if (!Number.isInteger(uses) || uses < 1 || uses > 1000) return 'Deployments must be a whole number from 1 to 1000.'
  return null
}

/** The link that opens the app with `code` filled in (from `location.origin`, `location.pathname`). */
export const codeLink = (origin: string, pathname: string, code: string) => `${origin}${pathname}?code=${encodeURIComponent(code)}`
