import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { keccak256, toBytes, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { BrowserKeyStore, MemoryKeyPersistence, passphraseProvider } from '@evmb/keys'
import { ChainHost, MemoryFollowerStore, NodeClient, ensureOnboarding, handle, issueTx, mined, setupTxs, type ChainHandleLike } from '@evmb/node'
import { createNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { bunSql } from '../../node/test/bunSql'
import { wasm } from '../../node/test/workload'
import { MemoryWorkspaceStorage, Workspace, type ChainRecord } from '../src'

const acct = (n: string) => privateKeyToAccount(keccak256(toBytes(n)))
const admin = acct('w-admin'), sueKey = keccak256(toBytes('w-sue')), sue = privateKeyToAccount(sueKey)
const hosts = new Map<string, ChainHost>()
const chainHost = (id: string): ChainHandleLike => {
  let h = hosts.get(id)
  if (!h) hosts.set(id, (h = new ChainHost(bunSql(), wasm, { rootAdmin: admin.address, chain: chainHost })))
  return h
}
let srv: ReturnType<typeof Bun.serve>, url: string, onb: Address
const as = (a: typeof admin) => new NodeClient(url, a)
const now = () => Math.floor(Date.now() / 1000)
let n = 0
const issue = async (ttl = 600) => {
  const code = `CODE${++n}`
  const a = as(admin)
  mined(await a.submit('root', [await issueTx(admin, await a.nonce('root'), onb, code, `label ${n}`, now() + ttl, 1)]))
  return code
}
const persistence = new MemoryKeyPersistence()
const keys = new BrowserKeyStore({ persistence, provider: passphraseProvider({ persistence, ask: async () => 'pw' }) })
const storage = new MemoryWorkspaceStorage()
const open = () => Workspace.open({ workerUrl: url, keys, me: sue.address, storage, wasm, followerStore: new MemoryFollowerStore() })
const get = (ws: Workspace, id: string) => ws.chains().find((c) => c.id === id)!

beforeAll(async () => {
  srv = Bun.serve({ port: 0, fetch: (r) => handle(r, { chain: chainHost }) })
  url = `http://localhost:${srv.port}`
  const node = await createNode({ chainId: 31337, computeStateRoot: true, miningConfig: { type: 'manual' }, engine: await createRevmEngine({ wasm }) })
  const dump = await node.dumpState()
  await node.dispose()
  await as(admin).createChain({ dump, setup: await setupTxs(admin, 0, 31337) })
  onb = (await ensureOnboarding(as(admin), admin)).onboarding
  await keys.importKey(sueKey)
})
afterAll(() => srv.stop(true))

describe('Workspace', () => {
  test('createChain is local and persisted (reopen sees it)', async () => {
    const ws = await open()
    let changes = 0
    ws.onChange(() => changes++)
    const c = await ws.createChain('Sue chain', 'a test chain')
    expect(c).toMatchObject({ name: 'Sue chain', desc: 'a test chain', status: 'local' })
    expect(c.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(c.dump!.blocks.length).toBe(1)
    expect(changes).toBe(1)
    expect(get(await open(), c.id)).toEqual(c)
  })

  test('deploy with a live code → deployed, the cloud head matches, I\'m its admin', async () => {
    const ws = await open()
    const { id } = await ws.createChain('live', '')
    const c = await ws.deploy(id, { code: (await issue()).toLowerCase() })
    expect(c.status).toBe('deployed')
    expect(c.deployedAt).toBeNumber()
    const info = await as(sue).info(id)
    expect(info.admin).toBe(sue.address)
    expect(c.dump!.blocks.at(-1)!.hash).toBe(info.head.hash)
    expect(get(await open(), id).status).toBe('deployed')
    const f = await ws.follower(id)
    try { expect(f.head.hash).toBe(info.head.hash) } finally { await f.dispose() }
  })

  test('deploy with an expired code → throws "code expired", stays local', async () => {
    const ws = await open()
    const { id } = await ws.createChain('late', '')
    const code = await issue(1)
    await Bun.sleep(2100)
    await issue() // a block past the expiry
    await expect(ws.deploy(id, { code })).rejects.toThrow('code expired')
    expect(get(ws, id).status).toBe('local')
  })

  test('a bad code is refused before any request', async () => {
    const ws = await open()
    const { id } = await ws.createChain('bad', '')
    const real = globalThis.fetch
    let calls = 0
    globalThis.fetch = ((...a: Parameters<typeof fetch>) => (calls++, real(...a))) as typeof fetch
    try { await expect(ws.deploy(id, { code: 'ab' })).rejects.toThrow('bad code') } finally { globalThis.fetch = real }
    expect(calls).toBe(0)
  })

  test('create fails after redeem (corrupt the dump) → unfinished; retryDeploy → deployed', async () => {
    let ws = await open()
    const rec = await ws.createChain('flaky', '')
    const bad = structuredClone(rec.dump!)
    bad.chainId = 1 // loads locally; the worker refuses the set-up txs (signed for 31337)
    await storage.save({ ...rec, dump: bad })
    ws = await open()
    await expect(ws.deploy(rec.id, { code: await issue() })).rejects.toThrow('chain not created: ')
    expect(get(ws, rec.id).status).toBe('unfinished')
    expect(get(ws, rec.id).error).toStartWith('chain not created: ')
    await storage.save({ ...get(ws, rec.id), dump: rec.dump })
    ws = await open()
    expect(get(ws, rec.id).status).toBe('unfinished')
    const c = await ws.retryDeploy(rec.id)
    expect(c.status).toBe('deployed')
    expect(c.error).toBeUndefined()
    expect((await as(sue).info(rec.id)).admin).toBe(sue.address)
  })

  test('retryDeploy: 409 (an earlier attempt landed) → deployed; 403 (no grant) → local', async () => {
    let ws = await open()
    const landed = await ws.deploy((await ws.createChain('landed', '')).id, { code: await issue() })
    const never = await ws.createChain('never', '')
    for (const c of [landed, never]) await storage.save({ ...c, status: 'unfinished', error: 'network' } as ChainRecord)
    ws = await open()
    const c = await ws.retryDeploy(landed.id)
    expect(c.status).toBe('deployed')
    expect(c.dump!.blocks.at(-1)!.hash).toBe((await as(sue).info(landed.id)).head.hash)
    await expect(ws.retryDeploy(never.id)).rejects.toThrow('not allowed to create this chain')
    expect(get(ws, never.id).status).toBe('local')
    expect(get(ws, never.id).error).toBeUndefined()
  })
})
