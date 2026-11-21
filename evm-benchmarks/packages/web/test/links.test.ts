import { test, expect, describe, afterEach } from 'bun:test'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { personaParam, resolvePersona, safeBack, syncDecision, withParams, type Last } from '../src/links'
import { pushNotice, takeNotice } from '../src/notice'
import { sameRoute } from '../src/walkthrough/auto'

const store = new Map<string, string>()
;(globalThis as any).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
afterEach(() => store.clear())

const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), C = '0x' + 'c'.repeat(40)
const CA = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' // checksummed
const accts = [{ label: 'alice', address: A }, { label: 'bob', address: B }, { label: 'bob', address: C }]

describe('persona', () => {
  test('personaParam: the label when unique, else the checksummed address', () => {
    expect(personaParam(A, accts)).toBe('alice')
    expect(personaParam(A.toUpperCase().replace('0X', '0x'), accts)).toBe('alice')
    expect(personaParam(B, accts)).toBe('0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB') // two "bob"s → address
    expect(personaParam('0x' + 'd'.repeat(40), accts)).toBe('0xDDdDddDdDdddDDddDDddDDDDdDdDDdDDdDDDDDDd') // unknown → address
  })
  test('resolvePersona: label (case-sensitive, first match) or address (any case)', () => {
    expect(resolvePersona('alice', accts)).toBe(A)
    expect(resolvePersona('Alice', accts)).toBeUndefined()
    expect(resolvePersona('bob', accts)).toBe(B) // ambiguous label: first match
    expect(resolvePersona(CA, accts)).toBe(A)
    expect(resolvePersona(C.toUpperCase().replace('0X', '0x'), accts)).toBe(C)
    expect(resolvePersona('carol', accts)).toBeUndefined()
    expect(resolvePersona('', accts)).toBeUndefined()
  })
})

test('withParams sets and removes, keeping the rest', () => {
  expect(withParams('/swap?base=0x1&quote=0x2', { chain: 'c1', as: 'bob' })).toBe('/swap?base=0x1&quote=0x2&chain=c1&as=bob')
  expect(withParams('/swap?chain=c1&as=bob&auto=5s', { chain: 'c2', as: undefined })).toBe('/swap?chain=c2&auto=5s')
  expect(withParams('/assets?chain=c1', { chain: undefined })).toBe('/assets')
  expect(withParams('/assets', { back: '/swap?base=0x1&chain=c1' })).toBe('/assets?back=%2Fswap%3Fbase%3D0x1%26chain%3Dc1')
})

test('sameRoute ignores chain and as (the sync re-adds them after a ribbon navigation)', () => {
  expect(sameRoute('/pool?base=0x1&chain=c1&as=bob&auto=5s', '/pool?base=0x1')).toBe(true)
  expect(sameRoute('/pool?base=0x1&chain=c1', '/pool?base=0x2')).toBe(false)
})

test('safeBack: only same-app hash paths', () => {
  expect(safeBack('/swap?base=0x1&chain=c1&as=bob')).toBe('/swap?base=0x1&chain=c1&as=bob')
  expect(safeBack('/')).toBe('/')
  for (const bad of [undefined, null, '', 'swap', 'https://evil.com', '//evil.com', '/\\evil.com', '\\\\evil.com', 'javascript:alert(1)', '/\t/evil.com', ' /swap', '#/swap'])
    expect(safeBack(bad)).toBeUndefined()
})

test('one-shot notice: taken once', () => {
  expect(takeNotice()).toBeUndefined()
  pushNotice('Received 5 GBP from issuer', 'success')
  expect(takeNotice()).toEqual({ text: 'Received 5 GBP from issuer', tone: 'success' })
  expect(takeNotice()).toBeUndefined()
  pushNotice('No chain x in this browser')
  expect(takeNotice()).toEqual({ text: 'No chain x in this browser', tone: 'warn' })
})

describe('syncDecision (one round settles)', () => {
  const known = { chains: ['c1', 'c2'], accounts: accts }
  const sel = (chain?: string, account?: string, loading = false) => ({ chain, account, loading })
  const none: Last = {}

  test('first load with a link: select what the URL names (chain already restored from it)', () => {
    const d = syncDecision({ chain: 'c1', as: 'alice' }, sel('c1', B), none, known)
    expect(d).toEqual({ account: A, notices: [], last: { chain: 'c1', as: 'alice' } })
    // next round, the selection caught up: nothing
    expect(syncDecision({ chain: 'c1', as: 'alice' }, sel('c1', A), d.last, known)).toEqual({ notices: [], last: d.last })
  })

  test('a link to another chain selects it; while it loads nothing is rewritten; then settled', () => {
    const last = { chain: 'c1', as: 'alice' }
    const d = syncDecision({ chain: 'c2', as: 'alice' }, sel('c1', A), last, known)
    expect(d).toEqual({ chain: 'c2', notices: [], last: { chain: 'c2', as: 'alice' } })
    expect(syncDecision({ chain: 'c2', as: 'alice' }, sel('c1', A, true), d.last, known)).toEqual({ notices: [], last: d.last })
    expect(syncDecision({ chain: 'c2', as: 'alice' }, sel('c2', A), d.last, known)).toEqual({ notices: [], last: d.last })
  })

  test('the selection changed in the app: rewrite the URL (label when unique, else address)', () => {
    const last = { chain: 'c1', as: 'alice' }
    const d = syncDecision({ chain: 'c1', as: 'alice' }, sel('c2', B), last, known)
    expect(d).toEqual({ url: { chain: 'c2', as: personaParam(B, accts) }, notices: [], last: { chain: 'c2', as: personaParam(B, accts) } })
    expect(syncDecision(d.url!, sel('c2', B), d.last, known)).toEqual({ notices: [], last: d.last })
  })

  test('params dropped by a navigation (sidebar, ribbon) are re-added', () => {
    const last = { chain: 'c1', as: 'alice' }
    const d = syncDecision({}, sel('c1', A), last, known)
    expect(d.url).toEqual({ chain: 'c1', as: 'alice' })
    expect(d.chain).toBeUndefined()
    expect(d.account).toBeUndefined()
  })

  test('nothing selected, no params: nothing', () => {
    expect(syncDecision({}, sel(), none, known)).toEqual({ notices: [], last: {} })
  })

  test('while a chain loads (or on first load before the restore) nothing happens', () => {
    expect(syncDecision({ chain: 'c2' }, sel(undefined, A, true), none, known)).toEqual({ notices: [], last: none })
    expect(syncDecision({}, sel('c1', A, true), { chain: 'c1', as: 'alice' }, known)).toEqual({ notices: [], last: { chain: 'c1', as: 'alice' } })
  })

  test('a failed chain load does not retry forever: the URL follows the (empty) selection', () => {
    const d = syncDecision({ chain: 'c2', as: 'alice' }, sel(undefined, A), { chain: 'c2', as: 'alice' }, known)
    expect(d).toEqual({ url: { chain: undefined, as: 'alice' }, notices: [], last: { chain: undefined, as: 'alice' } })
  })

  test('unknown chain/as: selection left alone, a notice, the bad param replaced', () => {
    const d = syncDecision({ chain: 'nope', as: 'carol' }, sel('c1', A), none, known)
    expect(d).toEqual({ url: { chain: 'c1', as: 'alice' }, notices: ['No chain nope in this browser', 'No account carol in this browser'], last: { chain: 'c1', as: 'alice' } })
    expect(syncDecision(d.url!, sel('c1', A), d.last, known)).toEqual({ notices: [], last: d.last })
    // nothing selected: the param is dropped
    expect(syncDecision({ chain: 'nope' }, sel(), none, known).url).toEqual({ chain: undefined, as: undefined })
  })

  test('an address in the URL that matches the selection is kept as written (no second rewrite)', () => {
    const d = syncDecision({ chain: 'c1', as: CA }, sel('c1', A), none, known)
    expect(d).toEqual({ notices: [], last: { chain: 'c1', as: CA } })
    expect(syncDecision({ chain: 'c1', as: CA }, sel('c1', A), d.last, known)).toEqual({ notices: [], last: d.last })
  })

  test('ambiguous label in a link picks the first match; written back as the address after a switch', () => {
    const d = syncDecision({ chain: 'c1', as: 'bob' }, sel('c1', A), { chain: 'c1', as: 'alice' }, known)
    expect(d.account).toBe(B)
    expect(d.url).toEqual({ chain: 'c1', as: personaParam(B, accts) }) // the link's ambiguous label → the address
    expect(syncDecision(d.url!, sel('c1', B), d.last, known)).toEqual({ notices: [], last: d.last })
    expect(syncDecision({ chain: 'c1', as: 'alice' }, sel('c1', C), { chain: 'c1', as: 'alice' }, known).url!.as).toBe(personaParam(C, accts))
  })

  test('a label that became ambiguous (new account) is rewritten to the address', () => {
    const two = [...accts, { label: 'alice', address: '0x' + 'e'.repeat(40) }]
    const d = syncDecision({ chain: 'c1', as: 'alice' }, sel('c1', A), { chain: 'c1', as: 'alice' }, { ...known, accounts: two })
    expect(d.url).toEqual({ chain: 'c1', as: personaParam(A, two) })
    expect(d.url!.as).not.toBe('alice')
  })

  test('busy (tx in flight, passed as loading): Back/Forward or a pasted link waits, then applies', () => {
    const last = { chain: 'c1', as: 'alice' }
    expect(syncDecision({ chain: 'c2', as: 'bob' }, sel('c1', A, true), last, known)).toEqual({ notices: [], last })
    const d = syncDecision({ chain: 'c2', as: 'bob' }, sel('c1', A), last, known) // the tx landed
    expect(d.chain).toBe('c2')
    expect(d.account).toBe(B)
  })

  test('back/forward to an older URL selects it', () => {
    const d = syncDecision({ chain: 'c1', as: 'alice' }, sel('c2', B), { chain: 'c2', as: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' }, known)
    expect(d.chain).toBe('c1')
    expect(d.account).toBe(A)
    expect(d.url).toBeUndefined()
  })
})

test('UrlSync renders nothing on the server', async () => {
  const { UrlSync } = await import('../src/components/UrlSync')
  const { AppState } = await import('../src/state')
  expect(renderToString(h(MemoryRouter, { initialEntries: ['/swap?chain=c1&as=bob'] }, h(AppState, null, h(UrlSync))))).toBe('')
})
