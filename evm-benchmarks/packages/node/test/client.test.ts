import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { getAddress, decodeFunctionResult, encodeFunctionData, keccak256, toBytes, type Hex } from 'viem'
import { createNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { privateKeyToAccount } from 'viem/accounts'
import { Aliases, ChainAccess } from '@evmb/contracts'
import { ChainNode, ChainStore } from '../src'
import { claimTx, codeHash, generateCode, inviteTx, mined, NodeClient, NodeError, setupTxs, type SubmitResult } from '../src/client'
import { WORDS } from '../src/words'
import { bunSql } from './bunSql'
import { wasm } from './workload'

const admin = privateKeyToAccount(keccak256(toBytes('admin')))
const joiner = privateKeyToAccount(keccak256(toBytes('joiner')))
const cfg = { wasm, rebuildEvery: 100 }
const call = (n: ChainNode, to: Hex, abi: any, fn: string, args: unknown[] = []) =>
  n.read(async (x) => decodeFunctionResult({ abi, functionName: fn, data: (await x.request({ method: 'eth_call', params: [{ to, data: encodeFunctionData({ abi, functionName: fn, args }) }, 'latest'] })) as Hex }))

test('codeHash is keccak256(bytes(code))', () => {
  expect(codeHash('a-b-c-d')).toBe(keccak256(toBytes('a-b-c-d')))
})

test('mined passes an all-mined reply through and throws on the first refused tx, naming its reason', () => {
  const head = { number: 3, hash: '0xh', stateRoot: '0xr' }
  const ok = { head, results: [{ hash: '0x01', result: 'mined', block: 3 }] } as SubmitResult
  expect(mined(ok)).toBe(ok)
  const bad = { head, results: [...ok.results, { hash: '0x02', result: 'refused', code: 'nonce', reason: 'nonce too low: address 0xa, tx: 1, state: 2' }] } as SubmitResult
  expect(() => mined(bad)).toThrow('tx 0x02 refused (nonce): nonce too low: address 0xa, tx: 1, state: 2')
})

test('generateCode gives 4 lowercase words', () => {
  for (let i = 0; i < 20; i++) {
    const w = generateCode().split('-')
    expect(w.length).toBe(4)
    for (const x of w) expect(WORDS).toContain(x)
  }
  expect(new Set(WORDS).size).toBe(WORDS.length)
  expect(WORDS.every((x) => /^[a-z]+$/.test(x))).toBe(true)
})

describe('set-up txs on a fresh node', () => {
  const fresh = async () => {
    const node = await createNode({ chainId: 31337, computeStateRoot: true, miningConfig: { type: 'manual' }, genesisTimestamp: 1_700_000_000n, engine: await createRevmEngine({ wasm }) })
    const dump = await node.dumpState()
    await node.dispose()
    return ChainNode.create(new ChainStore(bunSql(new Database(':memory:'))), dump, cfg)
  }

  test('one block, both succeed, admin and aliases wired; invite then claim once', async () => {
    const node = await fresh()
    const [a, b] = await setupTxs(admin, 0, 31337)
    const blk = (await node.apply(1_700_000_100, [a, b])).block!
    expect(blk.receipts.map((r: any) => r.status)).toEqual([1, 1])
    const access = (blk.receipts[0] as any).contractAddress as Hex
    const aliases = (blk.receipts[1] as any).contractAddress as Hex
    expect(await call(node, access, ChainAccess.abi, 'admin')).toBe(admin.address)
    expect(await call(node, aliases, Aliases.abi, 'access')).toBe(getAddress(access))

    const code = generateCode()
    const inv = (await node.apply(1_700_000_101, [await inviteTx(admin, 2, access, code, 3600, 1)])).block!
    expect((inv.receipts[0] as any).status).toBe(1)
    const ok = (await node.apply(1_700_000_102, [await claimTx(joiner, 0, code, access)])).block!
    expect((ok.receipts[0] as any).status).toBe(1)
    const again = (await node.apply(1_700_000_103, [await claimTx(joiner, 1, code, access)])).block!
    expect((again.receipts[0] as any).status).toBe(0)
    await node.dispose()
  })
})

test('NodeClient signs and throws NodeError on non-2xx', async () => {
  let seen: Headers | undefined
  const srv = Bun.serve({ port: 0, fetch: (r) => ((seen = r.headers), Response.json({ error: 'nope' }, { status: 403 })) })
  const c = new NodeClient(`http://localhost:${srv.port}`, admin)
  const e = await c.codes().catch((x) => x)
  srv.stop(true)
  expect(e).toBeInstanceOf(NodeError)
  expect(e).toMatchObject({ status: 403, error: 'nope' })
  expect(seen!.get('x-sig')).toBeTruthy()
  expect(seen!.get('x-ts') && seen!.get('x-nonce')).toBeTruthy()
})

test('a request the worker never answers times out (not a NodeError: the follower reads it as unreachable)', async () => {
  const srv = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) }) // never answers
  try {
    const t0 = Date.now()
    const e = await new NodeClient(`http://localhost:${srv.port}`, admin, { timeoutMs: 100 }).info('x').catch((e) => e)
    expect(e).toBeInstanceOf(Error)
    expect(e).not.toBeInstanceOf(NodeError)
    expect((e as Error).name).toBe('TimeoutError')
    expect(Date.now() - t0).toBeLessThan(5_000)
  } finally { srv.stop(true) }
})
