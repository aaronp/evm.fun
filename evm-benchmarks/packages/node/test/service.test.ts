import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, keccak256, toBytes, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createNode, type SerializedState } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { ChainAccess } from '@evmb/contracts'
import { ChainService, ServiceError } from '../src/service'
import { claimTx, codeHash, inviteTx, setupTxs } from '../src/client'
import { bunSql } from './bunSql'
import { wasm } from './workload'

const admin = privateKeyToAccount(keccak256(toBytes('svc-admin')))
const joiner = privateKeyToAccount(keccak256(toBytes('svc-joiner')))
const other = privateKeyToAccount(keccak256(toBytes('svc-other')))
const T0 = 1_700_000_000
const me = admin.address.toLowerCase()
const tx = { type: 'eip1559', chainId: 31337, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n } as const

let dump: SerializedState
beforeAll(async () => {
  const node = await createNode({ chainId: 31337, computeStateRoot: true, miningConfig: { type: 'manual' }, genesisTimestamp: BigInt(T0), engine: await createRevmEngine({ wasm }) })
  dump = await node.dumpState()
  await node.dispose()
})

// every service made here, disposed at the end: leaked wasm engines pile up across the whole bun test run
const made: (ChainService | null)[] = []
afterAll(() => Promise.all(made.map((s) => s?.dispose())))
const keep = <T extends ChainService | null>(s: T) => (made.push(s), s)
const open = (sql: ReturnType<typeof bunSql>, chainId = 'root') => ChainService.open(sql, wasm, { chainId }).then(keep)
const create = (sql = bunSql(), setup?: Hex[], signer = me, chainId = 'root') =>
  (async () => keep(await ChainService.create(sql, wasm, { chainId, signer, dump, setup: (setup ?? (await setupTxs(admin, 0, 31337))) as [Hex, Hex], timestamp: T0 + 100 })))()

const refused = async (p: Promise<unknown>) => {
  const e = await p.catch((x) => x)
  expect(e).toBeInstanceOf(ServiceError)
  return e as ServiceError
}

test('create: head is dump head + 1 and admin is the signer', async () => {
  const s = await create()
  const info = await s.info()
  expect(info.head.number).toBe(dump.blocks.at(-1)!.number + 1)
  expect(info.admin.toLowerCase()).toBe(me)
  expect(info.chainId).toBe('root')
  expect(info.access).toMatch(/^0x[0-9a-fA-F]{40}$/)
  expect(info.aliases).toMatch(/^0x[0-9a-fA-F]{40}$/)
  expect(await s.canWrite(me)).toBe(true)
  expect(await s.canWrite(joiner.address)).toBe(false)
  expect(await s.nonceOf(me)).toBe(2)
})

describe('create refuses, and the sql holds no chain afterwards', () => {
  const deploy = (nonce: number, data: Hex) => admin.signTransaction({ ...tx, nonce, data, gas: 3_000_000n })
  const cases: [string, () => Promise<Hex[]>, number][] = [
    ['setup signed by another key', () => setupTxs(joiner, 0, 31337), 403],
    ['a third tx', async () => [...(await setupTxs(admin, 0, 31337)), await deploy(2, '0x00')], 400],
    ['a reverting tx', async () => [await deploy(0, '0xfe'), (await setupTxs(admin, 0, 31337))[1]], 400],
    ['a non-creation tx', async () => [(await setupTxs(admin, 0, 31337))[0], await admin.signTransaction({ ...tx, nonce: 1, to: joiner.address, gas: 21_000n })], 400],
    ['an admin() that is not the signer', async () => [await deploy(0, encodeDeployData({ abi: [], bytecode: '0x00' } as never)), (await setupTxs(admin, 0, 31337))[1]], 403],
  ]
  for (const [name, setup, status] of cases)
    test(name, async () => {
      const sql = bunSql()
      expect((await refused(create(sql, await setup()))).status).toBe(status)
      expect(await open(sql)).toBeNull()
      // a retry on the same sql works
      expect((await (await create(sql)).info()).head.number).toBe(1)
    })
})

describe('root chain: codes', () => {
  let s: ChainService
  let sql: ReturnType<typeof bunSql>
  beforeAll(async () => {
    sql = bunSql()
    s = await create(sql)
  })

  test('submit by a non-writer → 403', async () => {
    const access = (await s.info()).access
    const e = await refused(s.submit(joiner.address, [await inviteTx(joiner, 0, access, 'x', 60, 1)], T0 + 101))
    expect(e.status).toBe(403)
    // signer is a writer but a tx sender is not
    expect((await refused(s.submit(me, [await inviteTx(joiner, 0, access, 'x', 60, 1)], T0 + 101))).status).toBe(403)
  })

  test('invite via submit, redeem once; again → 403; after expiry → 403; refused redeems keep no block', async () => {
    const { access } = await s.info()
    const blk = await s.submit(me, [await inviteTx(admin, 2, access, 'one-two-three-four', 3600, 1), await inviteTx(admin, 3, access, 'short-lived-code-x', 10, 2)], T0 + 200)
    expect(blk.number).toBe(2)
    expect(await s.redeem(joiner.address, await claimTx(joiner, 0, 'one-two-three-four', access), T0 + 201)).toEqual({ codeHash: codeHash('one-two-three-four') })
    s.recordRedeem(codeHash('one-two-three-four'), joiner.address, 'chain-1', T0 + 202)
    // claim's require is block.timestamp <= expiry: the expiry second itself still redeems
    expect(await s.redeem(joiner.address, await claimTx(joiner, 1, 'short-lived-code-x', access), T0 + 210)).toEqual({ codeHash: codeHash('short-lived-code-x') })
    const head = (await s.info()).head.number
    const again = await refused(s.redeem(joiner.address, await claimTx(joiner, 2, 'one-two-three-four', access), T0 + 210))
    expect([again.status, again.message]).toEqual([403, 'bad, used or expired code'])
    expect((await refused(s.redeem(joiner.address, await claimTx(joiner, 2, 'short-lived-code-x', access), T0 + 211))).status).toBe(403)
    expect((await refused(s.redeem(joiner.address, await claimTx(joiner, 2, 'never-issued-code', access), T0 + 212))).status).toBe(403)
    // claim sent by someone else than the request signer
    expect((await refused(s.redeem(me, await claimTx(joiner, 2, 'short-lived-code-x', access), T0 + 205))).status).toBe(403)
    expect((await s.info()).head.number).toBe(head)
  })

  test('codes lists the invite with usesLeft and the recorded redeem', async () => {
    const codes = await s.codes()
    expect(codes).toEqual([
      { hash: codeHash('one-two-three-four'), expiry: T0 + 200 + 3600, usesLeft: 0, redeemed: [{ by: joiner.address, chainId: 'chain-1', at: T0 + 202 }] },
      { hash: codeHash('short-lived-code-x'), expiry: T0 + 210, usesLeft: 1, redeemed: [] },
    ])
  })

  test('open() reboots to the same info and head', async () => {
    const again = await open(sql)
    expect(await again!.info()).toEqual(await s.info())
    expect(await again!.codes()).toEqual(await s.codes())
  })

  test('two concurrent redeems of a single-use code: one succeeds, one 403, one block', async () => {
    const { access } = await s.info()
    await s.submit(me, [await inviteTx(admin, 4, access, 'race-race-race-race', 3600, 1)], T0 + 300)
    const head = (await s.info()).head.number
    const claims = [await claimTx(joiner, 2, 'race-race-race-race', access), await claimTx(other, 0, 'race-race-race-race', access)]
    const res = await Promise.allSettled([s.redeem(joiner.address, claims[0]!, T0 + 301), s.redeem(other.address, claims[1]!, T0 + 301)])
    expect(res.filter((r) => r.status === 'fulfilled').length).toBe(1)
    const lost = res.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect([lost.reason.status, lost.reason.message]).toEqual([403, 'bad, used or expired code'])
    expect((await s.info()).head.number).toBe(head + 1)
  })

  test('a writer revoked by a concurrent submit is refused', async () => {
    const { access } = await s.info()
    const acl = (nonce: number, fn: 'addWriter' | 'removeWriter') =>
      admin.signTransaction({ ...tx, nonce, to: access, data: encodeFunctionData({ abi: ChainAccess.abi, functionName: fn, args: [other.address] }), gas: 300_000n })
    await s.submit(me, [await acl(5, 'addWriter')], T0 + 400)
    expect(await s.canWrite(other.address)).toBe(true)
    const [revoke, send] = [await acl(6, 'removeWriter'), await other.signTransaction({ ...tx, nonce: await s.nonceOf(other.address), to: joiner.address, gas: 21_000n })]
    const head = (await s.info()).head.number
    const [r1, r2] = await Promise.allSettled([s.submit(me, [revoke], T0 + 401), s.submit(other.address, [send], T0 + 401)])
    expect(r1.status).toBe('fulfilled')
    expect((r2 as PromiseRejectedResult).reason.status).toBe(403)
    expect((await s.info()).head.number).toBe(head + 1)
  })

  test('create on a sql that holds a chain → 409, the chain untouched', async () => {
    const before = await s.info()
    expect((await refused(create(sql))).status).toBe(409)
    expect(await s.info()).toEqual(before)
    const again = await open(sql)
    expect(await again!.info()).toEqual(before)
  })
})

test('two concurrent creates on one sql: one chain, one 409', async () => {
  const sql = bunSql()
  const res = await Promise.allSettled([create(sql), create(sql)])
  const ok = res.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<ChainService>[]
  expect(ok.length).toBe(1)
  expect((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.status).toBe(409)
  const info = await ok[0]!.value.info()
  expect(info.head.number).toBe(1)
  const again = await open(sql)
  expect(await again!.info()).toEqual(info)
})

test('open() with another chain id than the one stored throws', async () => {
  const sql = bunSql()
  await create(sql)
  await expect(open(sql, 'other')).rejects.toThrow('holds chain root')
})
