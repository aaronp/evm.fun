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

const base = () => JSON.parse(encodeChainFile(file))
const A = '0x' + 'a'.repeat(40), H = '0x' + 'b'.repeat(64)
const goodC = { address: A, deployer: A, txHash: H, name: 'C', abi: [{ type: 'function' }] }

test('malformed $bigint is a named error, never a throw', () => {
  for (const v of ['abc', '0x10', '']) {
    const r = dec(JSON.stringify({ ...base(), exportedAt: 'x', extra: { $bigint: v } }))
    expect(err(r)).toBe('Invalid $bigint value')
  }
  expect(err(dec(JSON.stringify({ ...base(), extra: { $bigint: 5 } })))).toBe('Invalid $bigint value')
})

test('version must be exactly 1', () => {
  for (const v of [0, 1.5, 2, '1', undefined]) expect(dec({ ...base(), version: v }).ok).toBe(false)
  expect(err(dec({ ...base(), version: 2 }))).toMatch(/newer version/)
})

test('contract entries are validated', () => {
  expect(dec({ ...base(), contracts: [goodC] }).ok).toBe(true)
  const t = (i: number, c: any, re: RegExp) => expect(err(dec({ ...base(), contracts: [goodC, goodC, ...Array(i - 2).fill(goodC), c] }))).toMatch(re)
  t(2, { ...goodC, address: '0x12' }, /contracts\[2\]\.address is not an address/)
  t(2, { ...goodC, deployer: 'x' }, /deployer/)
  t(2, { ...goodC, txHash: A }, /txHash/)
  t(2, { ...goodC, name: 'n'.repeat(201) }, /name/)
  t(2, { ...goodC, abi: [1] }, /abi/)
  t(2, { ...goodC, abi: 'x' }, /abi/)
  t(2, null, /not an object/)
})

test('dump field types are validated', () => {
  const d = (patch: object) => err(dec({ ...base(), dump: { ...base().dump, ...patch } }))
  expect(d({ accounts: [] })).toMatch(/accounts is not an object/)
  expect(d({ code: 'x' })).toMatch(/code/)
  expect(d({ storage: null })).toMatch(/storage/)
  expect(d({ blocks: {} })).toMatch(/blocks is not an array/)
  expect(d({ receipts: 1 })).toMatch(/receipts/)
  expect(d({ transactions: {} })).toMatch(/transactions/)
  expect(d({ chainId: 1 })).toMatch(/chainId/)
})

test('source and name limits', () => {
  const s = (source: any) => dec({ ...base(), source }).ok
  expect(s({ kind: 'import', fileName: 'x', height: -1 })).toBe(false)
  expect(s({ kind: 'import', fileName: 'x', height: 1.5 })).toBe(false)
  expect(s({ kind: 'import', fileName: 5, height: 1 })).toBe(false)
  expect(s({ kind: 'import', fileName: 'f'.repeat(201), height: 1 })).toBe(false)
  expect(s({ kind: 'snapshot', snapshotName: 's'.repeat(201), fromChainName: 'c', height: 1 })).toBe(false)
  expect(s({ kind: 'snapshot', snapshotName: 's', fromChainName: 'c', height: 0 })).toBe(true)
  expect(err(dec({ ...base(), chain: { name: 'n'.repeat(201), type: 'plain' } }))).toMatch(/chain/)
})

test('fileNameFor caps long names under 120 characters', () => {
  const n = fileNameFor('x'.repeat(500), 123456)
  expect(n.length).toBeLessThan(120)
  expect(n.endsWith('-123456.evmfun.json')).toBe(true)
  expect(fileNameFor('a-'.repeat(100), 1)).not.toContain('--')
})
