import { expect, test } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { recoverSigner, signRequest } from '../src/auth'

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
