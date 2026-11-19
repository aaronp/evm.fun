import { describe, test, expect } from 'bun:test'
import { encodeFunctionData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { MintableToken } from '@evmb/contracts'
import { parseArg, encodeArgs } from '../src/abi/args'
import { signAndSend } from '../src/tx/send'
import { createKv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'

const ok = (t: string, v: string) => { const r = parseArg(t, v); if (!r.ok) throw new Error(r.error); return r.value }
const bad = (t: string, v: string) => expect(parseArg(t, v).ok).toBe(false)

describe('parseArg', () => {
  test('address', () => {
    expect(parseArg('address', '0x000000000000000000000000000000000000dEaD').ok).toBe(true)
    bad('address', '0x123')
  })
  test('uint', () => {
    bad('uint256', '-1'); bad('uint256', '1.5'); bad('uint8', '256')
    expect(ok('uint256', '9007199254740993')).toBe(9007199254740993n)
    expect(ok('int8', '-128')).toBe(-128n); bad('int8', '128')
  })
  test('bool', () => { expect(ok('bool', 'true')).toBe(true); bad('bool', 'yes') })
  test('bytes', () => {
    expect(ok('bytes', '0xab')).toBe('0xab'); bad('bytes', '0xzz')
    expect(ok('bytes2', '0xabcd')).toBe('0xabcd'); bad('bytes2', '0xab')
  })
  test('arrays', () => {
    expect(ok('uint256[]', '[1,2]')).toEqual([1n, 2n])
    bad('uint256[]', '[1,"x"]'); bad('uint256[]', 'nope')
  })
  test('encodeArgs collects every error', () => {
    const r = encodeArgs([{ name: 'a', type: 'address' }, { name: 'b', type: 'uint8' }], ['0x1', '300'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toHaveLength(2)
  })
})

test('signAndSend: deploy, mint, transfer on a plain chain', async () => {
  const a = privateKeyToAccount(`0x${'11'.repeat(32)}`)
  const b = privateKeyToAccount(`0x${'22'.repeat(32)}`)
  const acct = { label: 'a', address: a.address, privateKey: `0x${'11'.repeat(32)}` as const }
  const stores = new Map<string, any>()
  const reg = createChainRegistry({
    kv: createKv(),
    host: id => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
    purge: async id => void stores.delete(id),
  })
  const h = await reg.create('c', 'plain', [a.address])
  const dep = await signAndSend(h, acct, {
    data: (await import('viem')).encodeDeployData({ abi: MintableToken.abi, bytecode: MintableToken.bytecode, args: ['T', 'T'] }),
  })
  expect(dep.status).toBe('success')
  const to = dep.contractAddress!
  const call = (fn: string, args: unknown[]) => signAndSend(h, acct, { to, data: encodeFunctionData({ abi: MintableToken.abi, functionName: fn, args } as any) })
  expect((await call('mint', [a.address, 100n])).status).toBe('success')
  expect((await call('transfer', [b.address, 30n])).status).toBe('success')
  const bal = async (x: string) => BigInt((await h.request('eth_call', [{ to, data: encodeFunctionData({ abi: MintableToken.abi, functionName: 'balanceOf', args: [x] } as any) }, 'latest'])) as string)
  expect([await bal(a.address), await bal(b.address)]).toEqual([70n, 30n])
  await h.dispose()
})
