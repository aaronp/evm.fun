import { test, expect } from 'bun:test'
import { encodeChainFile, decodeChainFile, fileNameFor, defaultSnapshotName, provenanceText, CROSS_ENGINE_OK, type ChainFile } from '../src/chain/chainFile'

const dump = { version: 1, chainId: 31337, accounts: { '0xa': { balance: 2n ** 64n, list: [1n, [2n ** 70n]] } }, code: {}, storage: {}, blocks: [], receipts: [], transactions: [] }
const file: ChainFile = {
  format: 'evm.fun/chain', version: 1, exportedAt: '2026-11-19T00:00:00Z', chainId: 31337, engine: 'webevm@0.9.1+revm',
  chain: { name: 'demo', type: 'plain' }, dump, contracts: [], source: { kind: 'import', fileName: 'x.evmfun.json', height: 3 },
}
const opts = { engine: 'webevm@0.9.1+revm', crossEngineOk: true }
const dec = (f: unknown, o = opts) => decodeChainFile(typeof f === 'string' ? f : JSON.stringify(f), o)
const err = (r: ReturnType<typeof dec>) => (r.ok ? '' : r.error)

test('round trip keeps nested bigints exactly', () => {
  const text = encodeChainFile(file)
  expect(text).toContain('{"$bigint":"18446744073709551616"}')
  const r = dec(text)
  expect(r.ok && r.file).toStrictEqual(file)
})

test('rejections name the problem and are ok:false', () => {
  const j = (patch: object) => ({ ...JSON.parse(encodeChainFile(file)), ...patch })
  expect(err(dec('{"format":'))).toMatch(/JSON/i)
  expect(err(dec('null'))).toMatch(/object/i)
  expect(err(dec(j({ format: 'other' })))).toMatch(/format/)
  expect(err(dec(j({ version: 2 })))).toMatch(/version/)
  expect(err(dec(j({ chainId: 1 })))).toMatch(/chainId/)
  expect(err(dec(j({ exportedAt: 5 })))).toMatch(/exportedAt/)
  expect(err(dec(j({ chain: { name: 'x', type: 'bad' } })))).toMatch(/chain/)
  expect(err(dec(j({ contracts: 'no' })))).toMatch(/contracts/)
  expect(err(dec(j({ dump: undefined })))).toMatch(/dump/)
  expect(err(dec(j({ dump: [] })))).toMatch(/dump/)
  expect(err(dec(j({ dump: { version: 1 } })))).toMatch(/dump.*accounts/)
  expect(err(dec(j({ source: { kind: 'x' } })))).toMatch(/source/)
})

test('engine mismatch only rejected when crossEngineOk is false', () => {
  const other = { ...JSON.parse(encodeChainFile(file)), engine: 'webevm@0.9.1' }
  expect(dec(other).ok).toBe(true)
  expect(err(dec(other, { engine: 'webevm@0.9.1+revm', crossEngineOk: false }))).toMatch(/engine/i)
  expect(CROSS_ENGINE_OK).toBe(true)
})

test('genesis-only chain round-trips', () => {
  const f = { ...file, dump: { ...dump, blocks: [] }, source: undefined }
  expect(dec(encodeChainFile(f)).ok).toBe(true)
})

test('names and provenance', () => {
  expect(fileNameFor('My Chain #1', 42)).toBe('my-chain-1-42.evmfun.json')
  expect(fileNameFor('###', 1)).toBe('chain-1.evmfun.json')
  expect(defaultSnapshotName('demo', 42)).toBe('demo @ block 42')
  expect(provenanceText({ kind: 'snapshot', snapshotName: 'before swap', fromChainName: 'demo', height: 42 })).toBe("from snapshot 'before swap' of demo @ #42")
  expect(provenanceText({ kind: 'import', fileName: 'x.evmfun.json', height: 42 })).toBe('imported from x.evmfun.json @ #42')
  expect(provenanceText(undefined)).toBeNull()
})
