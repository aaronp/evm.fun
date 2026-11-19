import { test, expect } from 'bun:test'
import { restoreBlockedReason, importSource, dumpHeight, sizeKb, WARN_BYTES, forkName } from '../src/chain/snapshotUi'
import { MAX_NAME } from '../src/chain/chainFile'

test('restore is blocked only while txs are pending', () => {
  expect(restoreBlockedReason(0)).toBeNull()
  expect(restoreBlockedReason(undefined)).toBeNull()
  expect(restoreBlockedReason(3)).toBe('Wait for 3 pending transactions to settle')
})

test('dumpHeight is the head block number, 0 for an empty dump', () => {
  expect(dumpHeight({ blocks: [] })).toBe(0)
  expect(dumpHeight({ blocks: [{ number: 0 }, { number: 7 }] })).toBe(7)
  expect(dumpHeight({ blocks: [{ number: 5n }] })).toBe(5)
})

test('import source comes from the file name and dump, never the file source', () => {
  expect(importSource('a.evmfun.json', { blocks: [{ number: 2 }] })).toEqual({ kind: 'import', fileName: 'a.evmfun.json', height: 2 })
})

test('size in KB and the 20 MB warning threshold', () => {
  expect(sizeKb(2048)).toBe('2 KB')
  expect(sizeKb(100)).toBe('1 KB')
  expect(WARN_BYTES).toBe(20 * 1024 * 1024)
})

test('fork name keeps " (fork)" and fits the 200-character import cap', () => {
  expect(forkName('s1')).toBe('s1 (fork)')
  const long = forkName('x'.repeat(200))
  expect(long.length).toBe(MAX_NAME)
  expect(long.endsWith(' (fork)')).toBe(true)
})
