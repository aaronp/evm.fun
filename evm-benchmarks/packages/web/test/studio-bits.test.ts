import { describe, test, expect } from 'bun:test'
import { parseArg } from '../src/abi/args'
import { contractsRegistry } from '../src/contracts/registry'

test('parseArg: constructor types', () => {
  expect(parseArg('uint256', '9007199254740993')).toBe(9007199254740993n)
  expect(() => parseArg('uint256', '-1')).toThrow()
  expect(() => parseArg('address', 'nope')).toThrow()
  expect(parseArg('string', ' x ')).toBe(' x ')
})

test('contractsRegistry add/list/remove per chain', async () => {
  const c = { address: '0x000000000000000000000000000000000000dEaD', name: 'A', abi: [], deployer: '0x01', txHash: '0x02' } as any
  await contractsRegistry.add('c1', c)
  expect((await contractsRegistry.list('c1')).map(x => x.name)).toEqual(['A'])
  expect(await contractsRegistry.list('c2')).toEqual([])
  await contractsRegistry.remove('c1', c.address)
  expect(await contractsRegistry.list('c1')).toEqual([])
})
