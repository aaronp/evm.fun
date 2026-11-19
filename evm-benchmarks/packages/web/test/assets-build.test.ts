import { test, expect } from 'bun:test'
import { erc20Abi, type Address } from 'viem'
import { createAssetRegistry, memoryStore } from '@evmb/assets'
import { reconcileAssets, tokenAsset } from '../src/assets/build'
import { decodeChainFile, encodeChainFile, type ChainFile } from '../src/chain/chainFile'

const A = '0x6643000000000000000000000000000000001234' as Address
const B = '0x0754000000000000000000000000000000005678' as Address
const D = '0x2222000000000000000000000000000000000001' as Address
const C = '0x1111000000000000000000000000000000009999' as Address
const rec = (address: Address, abi: any[] = erc20Abi as any) => ({ address, abi, deployer: A })
const info = { symbol: 'T', name: 'Token', decimals: 2 }

test('a 300-char name is clipped and survives encode -> decode', () => {
  const a = tokenAsset('c', A, { ...info, name: 'x'.repeat(300), symbol: 's'.repeat(300) }, { origin: 'imported', mintable: false })
  expect(a.name.length).toBe(200)
  const file: ChainFile = {
    format: 'evm.fun/chain', version: 1, exportedAt: '2026-11-19T00:00:00Z', chainId: 31337, engine: 'e',
    chain: { name: 'n', type: 'plain' }, dump: { version: 1, chainId: 31337, accounts: {}, code: {}, storage: {}, blocks: [], receipts: {}, transactions: {} }, contracts: [], assets: [a],
  }
  const r = decodeChainFile(encodeChainFile(file), { engine: 'e', crossEngineOk: true })
  expect(r.ok ? '' : r.error).toBe('')
})

test('reconcile skips non-ERC-20s, survives a failing read, and does not re-add', async () => {
  const reg = createAssetRegistry(memoryStore())
  await reg.add(tokenAsset('c', C, info, { origin: 'imported', mintable: false }))
  const reads: string[] = []
  await reconcileAssets('c', [rec(A, []), rec(B), rec(C), rec(D)], reg, async addr => {
    reads.push(addr)
    if (addr === B) throw new Error('boom')
    return info
  })
  expect(reads).toEqual([B, D]) // A not ERC-20, C already known
  expect((await reg.list('c')).filter(a => a.kind === 'erc20').map(a => a.address).sort()).toEqual([C, D].sort())
})
