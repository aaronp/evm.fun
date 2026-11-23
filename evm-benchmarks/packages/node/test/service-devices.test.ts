import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { encodeFunctionData, keccak256, toBytes, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createNode, type SerializedState } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { ChainAccess } from '@evmb/contracts'
import { ChainService, ServiceError } from '../src/service'
import { claimTx, codeHash, GRANT_CREATE_CHAIN, GRANT_READER, GRANT_WRITER, setupTxs } from '../src/client'
import { bunSql } from './bunSql'
import { wasm } from './workload'

const admin = privateKeyToAccount(keccak256(toBytes('dev-admin')))
const phone = privateKeyToAccount(keccak256(toBytes('dev-phone')))
const laptop = privateKeyToAccount(keccak256(toBytes('dev-laptop')))
const stranger = privateKeyToAccount(keccak256(toBytes('dev-stranger')))
const T0 = 1_700_000_000
const me = admin.address.toLowerCase()
const tx = { type: 'eip1559', chainId: 31337, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n } as const

let dump: SerializedState
let s: ChainService
let access: Address
let t = T0 + 100
const next = () => ++t

beforeAll(async () => {
  const node = await createNode({ chainId: 31337, computeStateRoot: true, miningConfig: { type: 'manual' }, genesisTimestamp: BigInt(T0), engine: await createRevmEngine({ wasm }) })
  dump = await node.dumpState()
  await node.dispose()
  s = await ChainService.create(bunSql(), wasm, { chainId: 'chain-1', signer: me, dump, setup: await setupTxs(admin, 0, 31337), timestamp: t })
  access = (await s.info()).access
})
afterAll(() => s.dispose())

const adminTx = async (fn: string, args: unknown[]) =>
  s.submit(me, [await admin.signTransaction({ ...tx, nonce: await s.nonceOf(me), to: access, data: encodeFunctionData({ abi: ChainAccess.abi, functionName: fn, args } as never), gas: 300_000n })], next())
const invite = (code: string, ttl: number, uses: number, grants: number) => adminTx('invite', [codeHash(code), BigInt(ttl), uses, grants])
const join = async (who: typeof phone, code: string, at = next()) => s.join(who.address, await claimTx(who, await s.nonceOf(who.address), code, access), at)
const head = async () => (await s.info()).head
const refused = async (p: Promise<unknown>) => {
  const e = await p.catch((x) => x)
  expect(e).toBeInstanceOf(ServiceError)
  return e as ServiceError
}

test('state() boots a fresh node to the same root', async () => {
  await invite('warm-up', 3600, 1, GRANT_READER) // some storage beyond the set-up block
  const st = await s.state()
  expect(st.head).toEqual(await head())
  const n = await createNode({ chainId: st.dump.chainId, computeStateRoot: true, miningConfig: { type: 'manual' }, engine: await createRevmEngine({ wasm }) })
  await n.loadState(st.dump)
  expect(await n.getStateRoot()).toBe(st.head.stateRoot)
  await n.dispose()
})

test('blocks(after) pages at 100 and returns head', async () => {
  while ((await head()).number < 105) await s.submit(me, [], next())
  const h = await head()
  const first = s.blocks(0)
  expect(first.head).toEqual(h)
  expect(first.blocks.map((b) => b.header.number)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1))
  expect(first.blocks[0]!.txs.length).toBe(2)
  expect(first.blocks[0]!.receipts.length).toBe(2)
  expect(s.blocks(100).blocks.map((b) => b.header.number)).toEqual(Array.from({ length: h.number - 100 }, (_, i) => i + 101))
  expect(s.blocks(h.number)).toEqual({ head: h, blocks: [] })
  expect(s.blocks(0, 3).blocks.length).toBe(3)
})

describe('join', () => {
  test('with a reader code adds a reader; with a writer code a writer', async () => {
    await invite('reader-code', 3600, 3, GRANT_READER)
    await invite('writer-code', 3600, 1, GRANT_WRITER)
    const r = await join(phone, 'reader-code')
    expect(r).toEqual({ head: await head(), role: 'reader' })
    expect([await s.canRead(phone.address), await s.canWrite(phone.address)]).toEqual([true, false])
    expect((await join(laptop, 'writer-code')).role).toBe('writer')
    expect(await s.canWrite(laptop.address)).toBe(true)
  })

  test('refuses a create-chain code, an expired code, a used-up code — 403, head unchanged', async () => {
    await invite('deploy-code', 3600, 5, GRANT_CREATE_CHAIN)
    await invite('short-code', 10, 5, GRANT_READER)
    const expiresAt = t + 10
    const before = await head()
    for (const [code, at] of [['deploy-code', next()], ['short-code', expiresAt + 1], ['writer-code', next()], ['never-issued', next()]] as const) {
      const e = await refused(join(stranger, code, at))
      expect([code, e.status, e.message]).toEqual([code, 403, 'bad, used or expired code'])
    }
    // a claim sent by another key than the request signer
    expect((await refused(s.join(stranger.address, await claimTx(phone, await s.nonceOf(phone.address), 'reader-code', access), next()))).status).toBe(403)
    // not a claim to this chain's ChainAccess
    expect((await refused(s.join(stranger.address, await claimTx(stranger, 0, 'reader-code', stranger.address), next()))).status).toBe(400)
    expect(await head()).toEqual(before)
    expect(await s.canRead(stranger.address)).toBe(false)
  })

  test('joining twice with valid codes leaves one role entry', async () => {
    expect((await join(phone, 'reader-code')).role).toBe('reader')
    const m = (await s.nodes()).members.filter((x) => x.address === phone.address)
    expect(m.map((x) => x.role)).toEqual(['reader'])
  })
})

describe('nodes and cursors', () => {
  test('touch writes on a higher block, and on an empty poll only after 60 s', async () => {
    const seen = async () => (await s.nodes()).members.find((x) => x.address === laptop.address)!
    s.touch(laptop.address.toLowerCase(), 'laptop', 5, 1000)
    expect(await seen()).toMatchObject({ name: 'laptop', block: 5, seenAt: 1000 })
    s.touch(laptop.address, 'laptop', 5, 1059)
    expect((await seen()).seenAt).toBe(1000)
    s.touch(laptop.address, 'laptop', 6, 1059)
    expect(await seen()).toMatchObject({ block: 6, seenAt: 1059 })
    s.touch(laptop.address, 'laptop', 6, 1118)
    expect((await seen()).seenAt).toBe(1059)
    s.touch(laptop.address, 'laptop', 6, 1119)
    expect((await seen()).seenAt).toBe(1119)
  })

  test('nodes lists admin/writers/readers once each, with cursor fields; a removed member and its cursor are gone', async () => {
    await join(laptop, 'reader-code') // laptop is now reader and writer: listed once, as writer
    const h = await head()
    s.touch(phone.address, 'phone', h.number - 3, 2000)
    s.touch(stranger.address, 'nobody', h.number, 2000) // not a member: omitted
    const v = await s.nodes()
    expect(v.head).toEqual(h)
    expect(v.admin).toBe(admin.address)
    expect(v.readOpen).toBe(false)
    expect(v.members).toEqual([
      { address: admin.address, role: 'admin' },
      { address: laptop.address, role: 'writer', name: 'laptop', block: 6, behind: h.number - 6, seenAt: 1119 },
      { address: phone.address, role: 'reader', name: 'phone', block: h.number - 3, behind: 3, seenAt: 2000 },
    ])
    await adminTx('removeReader', [phone.address])
    expect((await s.nodes()).members.map((x) => x.address)).toEqual([admin.address, laptop.address])
  })

  test('touch keeps the stored name when none is given, and never lowers the stored block', async () => {
    const seen = async () => (await s.nodes()).members.find((x) => x.address === laptop.address)!
    expect(await seen()).toMatchObject({ name: 'laptop', block: 6, seenAt: 1119 })
    s.touch(laptop.address, undefined, 7, 1120)
    expect(await seen()).toMatchObject({ name: 'laptop', block: 7, seenAt: 1120 })
    s.touch(laptop.address, '', 8, 1121)
    expect(await seen()).toMatchObject({ name: 'laptop', block: 8, seenAt: 1121 })
    s.touch(laptop.address, 'laptop-2', 3, 1181) // a minute on, a lower block: seenAt and name only
    expect(await seen()).toMatchObject({ name: 'laptop-2', block: 8, seenAt: 1181 })
  })
})
