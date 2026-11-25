import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { BrowserKeyStore, MemoryKeyPersistence, passphraseProvider } from '@evmb/keys'
import { MemoryFollowerStore, mined } from '@evmb/node'
import { MemoryWorkspaceStorage, Workspace, type ChainRecord } from '../src'
import { startWorker, wasm } from './harness'

const sueKey = keccak256(toBytes('w-sue')), sue = privateKeyToAccount(sueKey)
let w: Awaited<ReturnType<typeof startWorker>>, url: string
const as = (a: typeof sue) => w.as(a)
const issue = (ttl?: number) => w.issue(ttl)
const persistence = new MemoryKeyPersistence()
const keys = new BrowserKeyStore({ persistence, provider: passphraseProvider({ persistence, ask: async () => 'pw' }) })
const storage = new MemoryWorkspaceStorage()
const followerStore = new MemoryFollowerStore()
const open = () => Workspace.open({ workerUrl: url, keys, me: sue.address, storage, wasm, followerStore })
const get = (ws: Workspace, id: string) => ws.chains().find((c) => c.id === id)!

beforeAll(async () => {
  w = await startWorker()
  url = w.url
  await keys.importKey(sueKey)
})
afterAll(() => w.stop())

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

  test('renameChain updates name and description, persisted, and notifies', async () => {
    const ws = await open()
    const c = await ws.createChain('Old name', 'old desc')
    let changes = 0
    ws.onChange(() => changes++)
    const r = await ws.renameChain(c.id, 'New name', 'new desc')
    expect(r).toEqual({ ...c, name: 'New name', desc: 'new desc' })
    expect(changes).toBe(1)
    expect(get(await open(), c.id)).toEqual(r)
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
    const code = await issue()
    await expect(ws.deploy(rec.id, { code })).rejects.toThrow('chain not created: ')
    expect(get(ws, rec.id).status).toBe('unfinished')
    expect(get(ws, rec.id).error).toStartWith('chain not created: ')
    await storage.save({ ...get(ws, rec.id), dump: rec.dump })
    ws = await open()
    expect(get(ws, rec.id).status).toBe('unfinished')
    const c = await ws.retryDeploy(rec.id)
    expect(c.status).toBe('deployed')
    expect(c.error).toBeUndefined()
    expect((await as(sue).info(rec.id)).admin).toBe(sue.address)
    // the use was spent once, by the first attempt
    await expect(ws.deploy((await ws.createChain('again', '')).id, { code })).rejects.toThrow('code used up')
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

  test('a 5xx other than 502 after the redeem (root fails checking the grant) → unfinished; retryDeploy → deployed', async () => {
    const ws = await open()
    const { id } = await ws.createChain('five hundred', '')
    const root = w.hosts.get('root')!.service as any
    const real = root.isDeployAllowed, err = console.error
    root.isDeployAllowed = async () => { throw new Error('evicted') }
    console.error = () => {}
    try { await expect(ws.deploy(id, { code: await issue() })).rejects.toThrow('internal error') } finally { root.isDeployAllowed = real; console.error = err }
    expect(get(ws, id)).toMatchObject({ status: 'unfinished', error: 'internal error', by: sue.address })
    expect((await ws.retryDeploy(id)).status).toBe('deployed')
    expect((await as(sue).info(id)).admin).toBe(sue.address)
  })

  test('another key\'s retry of an unfinished deploy is refused, nothing sent, the record kept', async () => {
    const bob = privateKeyToAccount(keccak256(toBytes('w-bob')))
    const c = await (await open()).createChain('sues', '')
    const rec = { ...c, status: 'unfinished', error: 'network', by: sue.address } as ChainRecord
    await storage.save(rec)
    const ws = await Workspace.open({ workerUrl: url, keys, me: bob.address, storage, wasm, followerStore })
    const real = globalThis.fetch
    let calls = 0
    globalThis.fetch = ((...a: Parameters<typeof fetch>) => (calls++, real(...a))) as typeof fetch
    try { await expect(ws.retryDeploy(c.id)).rejects.toThrow(`deployed by ${sue.address.slice(0, 6)}…${sue.address.slice(-4)}; switch to that key to retry`) } finally { globalThis.fetch = real }
    expect(calls).toBe(0)
    expect(get(ws, c.id)).toEqual(rec)
    expect(get(await open(), c.id)).toEqual(rec)
  })

  test('a rename while a deploy runs keeps the new name and the deployed status (also from a stale Workspace)', async () => {
    const ws = await open()
    const { id } = await ws.createChain('before', '')
    const stale = await open() // e.g. left from before a key switch: it still holds the chain as local
    const deploying = ws.deploy(id, { code: await issue() })
    await ws.renameChain(id, 'during', 'd')
    expect(await deploying).toMatchObject({ status: 'deployed', name: 'during', desc: 'd' })
    expect(await stale.renameChain(id, 'after', 'a')).toMatchObject({ status: 'deployed', name: 'after', desc: 'a' })
    expect(get(await open(), id)).toMatchObject({ status: 'deployed', name: 'after', desc: 'a' })
  })

  test('a second deploy or retry of a chain while one runs → "already deploying", nothing sent', async () => {
    const ws = await open()
    const { id } = await ws.createChain('twice', '')
    const first = ws.deploy(id, { code: await issue() })
    // sent, 'ABCD' would fail as "no such code"; a retry of a local chain as "not unfinished"
    await expect(ws.deploy(id, { code: 'ABCD' })).rejects.toThrow('already deploying')
    await expect(ws.retryDeploy(id)).rejects.toThrow('already deploying')
    expect((await first).status).toBe('deployed')
    expect(get(ws, id).error).toBeUndefined()
  })

  test('follow: a block the owner mines in the cloud reaches the follower; stop ends it', async () => {
    const ws = await open()
    const { id } = await ws.deploy((await ws.createChain('followed', '')).id, { code: await issue() })
    const states: string[] = []
    const stop = ws.follow(id, (s) => states.push(s))
    try {
      while (!states.length) await Bun.sleep(20) // the follower is open and connecting
      const c = as(sue)
      const tx = await sue.signTransaction({ type: 'eip1559', chainId: 31337, nonce: await c.nonce(id), to: sue.address, value: 0n, gas: 21_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
      const { head } = mined(await c.submit(id, [tx]))
      // no socket here (Bun.serve doesn't upgrade): liveSync syncs after each failed connect, within its backoff
      for (let i = 0; i < 100 && (await followerStore.loadConfirmed(id))?.head.number !== head.number; i++) await Bun.sleep(100)
      expect((await followerStore.loadConfirmed(id))?.head.hash).toBe(head.hash)
    } finally { stop() }
  }, 15_000)
})
