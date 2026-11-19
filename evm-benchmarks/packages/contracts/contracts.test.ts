import {expect, test} from 'bun:test'
import {AtomicSwap, MintableToken} from './index.ts'

const fnNames = (abi: readonly {type: string; name?: string}[]) =>
  abi.filter((x) => x.type === 'function').map((x) => x.name)

test('MintableToken abi has mint, transfer, approve, balanceOf', () => {
  expect(fnNames(MintableToken.abi)).toEqual(expect.arrayContaining(['mint', 'transfer', 'approve', 'balanceOf']))
})
test('AtomicSwap abi has swap', () => {
  expect(fnNames(AtomicSwap.abi)).toContain('swap')
})
test('bytecode is non-empty hex', () => {
  for (const c of [MintableToken, AtomicSwap]) expect(c.bytecode).toMatch(/^0x[0-9a-f]{100,}$/)
})
