import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, keccak256, toBytes, type Hex } from 'viem'
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
const T0 = 1_700_000_000
const me = admin.address.toLowerCase()
const tx = { type: 'eip1559', chainId: 31337, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n } as const

let dump: SerializedState
beforeAll(async () => {
  const node = await createNode({ chainId: 31337, computeStateRoot: true, miningConfig: { type: 'manual' }, genesisTimestamp: BigInt(T0), engine: await createRevmEngine({ wasm }) })
  dump = await node.dumpState()
  await node.dispose()
})

const create = (sql = bunSql(), setup?: Hex[], signer = me, chainId = 'root') =>
  (async () => ChainService.create(sql, wasm, { chainId, signer, dump, setup: (setup ?? (await setupTxs(admin, 0, 31337))) as [Hex, Hex], timestamp: T0 + 100 }))()

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
      expect(await ChainService.open(sql, wasm, { chainId: 'root' })).toBeNull()
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
    const head = (await s.info()).head.number
    const again = await refused(s.redeem(joiner.address, await claimTx(joiner, 1, 'one-two-three-four', access), T0 + 203))
    expect([again.status, again.message]).toEqual([403, 'bad, used or expired code'])
    expect((await refused(s.redeem(joiner.address, await claimTx(joiner, 1, 'short-lived-code-x', access), T0 + 211))).status).toBe(403)
    expect((await refused(s.redeem(joiner.address, await claimTx(joiner, 1, 'never-issued-code', access), T0 + 212))).status).toBe(403)
    // claim sent by someone else than the request signer
    expect((await refused(s.redeem(me, await claimTx(joiner, 1, 'short-lived-code-x', access), T0 + 205))).status).toBe(403)
    expect((await s.info()).head.number).toBe(head)
  })

  test('codes lists the invite with usesLeft and the recorded redeem', async () => {
    const codes = await s.codes()
    expect(codes).toEqual([
      { hash: codeHash('one-two-three-four'), expiry: T0 + 200 + 3600, usesLeft: 0, redeemed: [{ by: joiner.address, chainId: 'chain-1', at: T0 + 202 }] },
      { hash: codeHash('short-lived-code-x'), expiry: T0 + 210, usesLeft: 2, redeemed: [] },
    ])
  })

  test('open() reboots to the same info and head', async () => {
    const again = await ChainService.open(sql, wasm, { chainId: 'root' })
    expect(await again!.info()).toEqual(await s.info())
    expect(await again!.codes()).toEqual(await s.codes())
  })
})
