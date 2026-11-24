import { describe, expect, test } from 'bun:test'
import { createKv } from '../src/store/kv'
import { kvFollowerStore } from '../src/cloud/followerStore'

const tx = (seq: number) => ({ hash: `0x${seq}`, raw: '0x', from: '0x1', nonce: seq, seq, first: { status: 'success', logs: [] }, status: 'pending' }) as any
const head = { number: 3, hash: '0xab' } as any

describe('kvFollowerStore', () => {
  test('round-trips confirmed copies and pending records by seq', async () => {
    const s = kvFollowerStore(createKv())
    expect(await s.loadConfirmed('c')).toBeUndefined()
    await s.saveConfirmed('c', { head, dump: {} as any, savedAt: 5 })
    expect((await s.loadConfirmed('c'))?.savedAt).toBe(5)
    await s.putPending('c', tx(2)); await s.putPending('c', tx(1)); await s.putPending('c', { ...tx(2), status: 'confirmed' })
    expect((await s.listPending('c')).map((t) => [t.seq, t.status])).toEqual([[1, 'pending'], [2, 'confirmed']])
    await s.deletePending('c', 1)
    expect((await s.listPending('c')).map((t) => t.seq)).toEqual([2])
  })
  test("pending records of two chains don't mix", async () => {
    const s = kvFollowerStore(createKv())
    await s.putPending('a', tx(1)); await s.putPending('b', tx(7))
    expect((await s.listPending('a')).map((t) => t.seq)).toEqual([1])
    expect((await s.listPending('b')).map((t) => t.seq)).toEqual([7])
  })
})
