import { expect, test } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { recoverSigner, signRequest } from '../src/auth'
import { NodeClient } from '../src/client'

const acct = privateKeyToAccount('0x' + '11'.repeat(32) as `0x${string}`)
const url = new URL('http://x/chains/abc/submit?a=1')

test('signRequest round-trips; a changed body, path or method recovers someone else', async () => {
  const sig = await signRequest(acct, 'POST', url, '{"a":1}')
  const me = acct.address.toLowerCase()
  expect(await recoverSigner('POST', url, '{"a":1}', sig)).toBe(me)
  expect(await recoverSigner('POST', url, '{"a":2}', sig)).not.toBe(me)
  expect(await recoverSigner('POST', new URL('http://x/chains/abd/submit?a=1'), '{"a":1}', sig)).not.toBe(me)
  expect(await recoverSigner('GET', url, '{"a":1}', sig)).not.toBe(me)
})

test('subscribeUrl is ws(s) and recoverSigner(GET, url, "") gives the account', async () => {
  for (const [base, scheme] of [['http://x', 'ws:'], ['https://x', 'wss:']] as const) {
    const u = new URL(await new NodeClient(base, acct).subscribeUrl('abc'))
    expect(u.protocol).toBe(scheme)
    expect(u.pathname).toBe('/chains/abc/subscribe')
    const a = { ts: u.searchParams.get('ts')!, nonce: u.searchParams.get('nonce')!, sig: u.searchParams.get('sig')! }
    expect(await recoverSigner('GET', u, '', a)).toBe(acct.address.toLowerCase())
  }
})
