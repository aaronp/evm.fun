import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import type { Hex } from 'viem'
import { codeHash } from '@evmb/workspace'
import { checkIssue, codeLink, codeRow, timeLeft } from '../src/onboarding/view'
import { CodeList } from '../src/onboarding/CodeList'
import { IssueForm } from '../src/onboarding/IssueForm'
import { OnboardingPage } from '../src/onboarding/OnboardingPage'

type CodeView = Parameters<typeof codeRow>[0]
const html = (el: React.ReactElement) => renderToString(el).replaceAll('<!-- -->', '').replaceAll('&#x27;', "'")
const noop = () => {}
const NOW = 1_800_000_000
const HOUR = 3600
const BY = '0x12345678901234567890123456789012345678ab'
const code = (o: Partial<CodeView> = {}): CodeView => ({
  hash: '0x00000000000000000000000000000000000000000000000000000000deadbeef', label: '', issuer: BY,
  issuedAt: NOW - HOUR, expiresAt: NOW + 2 * HOUR + 5 * 60, uses: 3, usesLeft: 2, status: 'active', grants: [], ...o,
})

describe('onboarding', () => {
  test('view: status text for active/used/expired/revoked', () => {
    const a = codeRow(code(), NOW, new Map())
    expect(a.status).toBe('Active')
    expect(a.usesText).toBe('2 deployments left of 3')
    expect(a.expiryText).toBe('expires in 2 h 5 m')
    expect(a.forText).toBe('For anyone with the code')
    expect(a.code).toBe('Code ending …beef')
    expect(a.canRevoke).toBe(true)
    expect(codeRow(code({ usesLeft: 1, uses: 1 }), NOW, new Map()).usesText).toBe('1 deployment left of 1')

    const u = codeRow(code({ status: 'used', usesLeft: 0, label: 'Sue', grants: [{ by: BY, chainId: 'c-1', at: NOW }] }), NOW, new Map())
    expect(u.status).toBe('Used up')
    expect(u.usesText).toBe('3 of 3 used')
    expect(u.expiryText).toBe('issued 1 h ago')
    expect(u.code).toBe('Sue')
    expect(u.forText).toBe('For Sue')
    expect(u.grants).toEqual(['by 0x12…ab → chain c-1'])
    expect(u.canRevoke).toBe(false)

    const e = codeRow(code({ status: 'expired', expiresAt: NOW - 3 * HOUR }), NOW, new Map())
    expect(e.status).toBe('Expired')
    expect(e.usesText).toBe('1 of 3 used')
    expect(e.expiryText).toBe('expired 3 h ago')

    const r = codeRow(code({ status: 'revoked' }), NOW, new Map([[code().hash, '205117']]))
    expect(r.status).toBe('Revoked')
    expect(r.expiryText).toBe('revoked')
    expect(r.code).toBe('205 117') // issued in this session
    expect(r.canRevoke).toBe(false)

    expect(timeLeft(2 * 86400 + 3 * HOUR)).toBe('2 d 3 h')
    expect(timeLeft(90)).toBe('1:30')
  })

  test('issue form validates "ab" with the 4–16 hint and uses 1001', () => {
    expect(checkIssue('ab', 1, [])).toBe('A code is 4–16 letters or digits.')
    expect(checkIssue('let-sue-in', 1001, [])).toBe('Deployments must be a whole number from 1 to 1000.')
    expect(checkIssue('let-sue-in', 1.5, [])).toBe('Deployments must be a whole number from 1 to 1000.')
    expect(checkIssue(' 205-117 ', 1, [code({ hash: codeHash('205117') as Hex })])).toBe('That code is already in use. Type another, or generate a new one.')
    expect(checkIssue('let-sue-in', 1000, [])).toBeNull()
    const h = html(<IssueForm busy={false} codes={[]} onIssue={async () => {}} onDismiss={noop} />)
    expect(h).toContain('Issue an access code')
    expect(h).toContain('Whoever enters the code can deploy a chain of their own, vouched for by Root.')
    expect(h).toContain('Generated for you. Type your own if you prefer: 4–16 letters or digits.')
    expect(h).toContain('For (optional)')
    expect(h).toContain('Issue code')
    expect([...h.matchAll(/<option[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(['1 minute', '10 minutes', '1 hour', '1 day', '1 week'])
    expect(h).toMatch(/<option value="1h" selected="">/)
    expect(h).toMatch(/type="number"[^>]*value="1"/)
  })

  test('non-issuer sees the issuer-only message', () => {
    const h = html(<OnboardingPage issuer={false} plain={new Map()} onNotice={noop} />)
    expect(h).toContain('Only people with this contract’s Issuer role can see its codes.')
    expect(h).not.toContain('Issue code')
    expect(html(<OnboardingPage issuer plain={new Map()} onNotice={noop} />)).not.toContain('Issuer role can see its codes')
  })

  test('issued code shows once with its ?code= link', () => {
    expect(codeLink('http://localhost:5174', '/', '205117')).toBe('http://localhost:5174/?code=205117')
    const issued = { code: '205117', link: codeLink('http://localhost:5174', '/', '205117') }
    const h = html(<IssueForm busy={false} codes={[]} issued={issued} onIssue={async () => {}} onDismiss={noop} />)
    expect(h).toContain('205 117')
    expect(h).toContain('http://localhost:5174/?code=205117')
    expect(h).toContain('Copy code')
    expect(html(<IssueForm busy={false} codes={[]} onIssue={async () => {}} onDismiss={noop} />)).not.toContain('?code=')
  })

  test('codes list: rows, revoke only for active, busy disables it', () => {
    const list = [code(), code({ hash: '0x01', status: 'revoked' })]
    const h = html(<CodeList codes={list} plain={new Map()} now={NOW} busy={false} onRevoke={noop} />)
    expect(h).toContain('1 active')
    expect(h.match(/>Revoke</g)?.length).toBe(1)
    expect(h).toContain('aria-label="Revoke code Code ending …beef"')
    expect(html(<CodeList codes={list} plain={new Map()} now={NOW} busy onRevoke={noop} />)).toMatch(/<button[^>]*disabled=""[^>]*>Revoke</)
    expect(html(<CodeList codes={[]} plain={new Map()} now={NOW} busy={false} onRevoke={noop} />)).toContain('No codes yet.')
  })
})
