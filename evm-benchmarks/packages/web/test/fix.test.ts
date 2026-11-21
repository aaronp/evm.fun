import { test, expect, describe } from 'bun:test'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Asset } from '@evmb/assets'
import { requestFix, linkedSend } from '../src/fix'
import { Shortfall } from '../src/components/Shortfall'
import { SendDialog } from '../src/components/SendDialog'
import { AppState } from '../src/state'

const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), X = '0x' + 'e'.repeat(40)
const people = [{ label: 'alice', address: A }, { label: 'bob', address: B }]
const GBP = { id: 'gbp-id', chainId: 'c1', kind: 'erc20', address: X, symbol: 'GBP', name: 'Pound', decimals: 2, issuer: A } as unknown as Asset
const swapAsBob = '/swap?base=0x1&quote=0x2&chain=c1&as=bob'
const base = { chainId: 'c1', asset: GBP, issuer: A, recipient: B, need: 1250n, have: 50n, issuerHas: 10_000n, back: swapAsBob, accounts: people }
const q = (href: string) => new URLSearchParams(href.split('?')[1])

describe('requestFix', () => {
  test('the issuer, a local account other than you holding the shortfall: a link to Send as the issuer', () => {
    const f = requestFix(base)!
    expect(f.label).toBe('Request 12 GBP from alice')
    expect(f.href.startsWith('/assets?')).toBe(true)
    const p = q(f.href)
    expect(Object.fromEntries(p)).toEqual({ chain: 'c1', as: 'alice', asset: 'gbp-id', send: B, amount: '12', back: swapAsBob })
  })
  test('exact decimal shortfall', () => {
    expect(requestFix({ ...base, need: 1001n, have: 0n })!.label).toBe('Request 10.01 GBP from alice')
    expect(q(requestFix({ ...base, need: 1001n, have: 0n })!.href).get('amount')).toBe('10.01')
  })
  test('no button: no issuer, issuer is you, issuer not in this browser, issuer short, no shortfall', () => {
    expect(requestFix({ ...base, issuer: undefined })).toBeUndefined()
    expect(requestFix({ ...base, recipient: A.toUpperCase().replace('0X', '0x') })).toBeUndefined()
    expect(requestFix({ ...base, issuer: X })).toBeUndefined()
    expect(requestFix({ ...base, issuerHas: 1199n })).toBeUndefined()
    expect(requestFix({ ...base, issuerHas: 1200n })).toBeDefined()
    expect(requestFix({ ...base, have: 1250n })).toBeUndefined()
  })
  test('back always carries the chain and you as the persona', () => {
    expect(q(requestFix({ ...base, back: '/swap?base=0x1' })!.href).get('back')).toBe('/swap?base=0x1&chain=c1&as=bob')
  })
})

describe('round trip (Review Focus 2)', () => {
  test('Swap as bob → Request → Send as alice prefilled → back to the same Swap URL as bob', () => {
    const p = q(requestFix(base)!.href)
    const l = linkedSend(p, people)!
    expect(l.from.label).toBe('alice')
    expect(l).toMatchObject({ asset: 'gbp-id', to: B, amount: '12', back: swapAsBob })
    const back = q(l.back!)
    expect(back.get('as')).toBe('bob')
    expect(back.get('chain')).toBe('c1')
    expect(back.get('base')).toBe('0x1')
  })
  test('bad links are safe: off-site back dropped, unknown as or no send → nothing opens', () => {
    const p = q(requestFix(base)!.href)
    for (const bad of ['https://evil.com', '//evil.com', 'javascript:alert(1)']) {
      p.set('back', bad)
      expect(linkedSend(p, people)!.back).toBeUndefined()
    }
    p.set('as', 'carol'); expect(linkedSend(p, people)).toBeUndefined()
    expect(linkedSend(new URLSearchParams('as=alice&asset=gbp-id'), people)).toBeUndefined()
    expect(linkedSend(new URLSearchParams('as=alice&asset=gbp-id&send=nope&amount=x'), people)).toMatchObject({ to: 'nope', amount: 'x' }) // the dialog validates
  })
})

const render = (el: any) => renderToString(h(MemoryRouter, null, h(AppState, null, el))).replaceAll('<!-- -->', '')

test('SendDialog prefilled from a link: to and amount', () => {
  const ppl = people.map(p => ({ ...p, privateKey: '0x' })) as any
  const html = render(h(SendDialog, { dialogRef: { current: null }, chain: {} as any, asset: GBP, from: ppl[0], accounts: ppl, to: B, amount: '12', onSent() {}, onClose() {} }))
  expect(html).toMatch(new RegExp(`<option value="${B}" selected=""`))
  expect(html).toMatch(/aria-label="Amount"[^>]*value="12"/)
})

test('SendDialog prefilled with an address not in this browser: Other address', () => {
  const ppl = people.map(p => ({ ...p, privateKey: '0x' })) as any
  const html = render(h(SendDialog, { dialogRef: { current: null }, chain: {} as any, asset: GBP, from: ppl[0], accounts: ppl, to: X, amount: '1', onSent() {}, onClose() {} }))
  expect(html).toMatch(/<option value="other" selected=""/)
  expect(html).toMatch(new RegExp(`aria-label="Recipient address"[^>]*value="${X}"`))
})

test('Shortfall renders the message; with a fix, the request link', () => {
  const html = render(h(Shortfall, { asset: GBP, need: 10n, have: 0n, fix: { label: 'Request 0.1 GBP from alice', href: '/assets?as=alice' } }, 'Not enough GBP — you have 0.00.'))
  expect(html).toContain('Not enough GBP — you have 0.00.')
  expect(html).toMatch(/<a [^>]*href="\/assets\?as=alice"[^>]*>Request 0.1 GBP from alice<\/a>/)
  const none = render(h(Shortfall, { asset: GBP, need: 10n, have: 0n }, 'Not enough GBP'))
  expect(none).toContain('Not enough GBP')
  expect(none).not.toContain('<a ')
})
