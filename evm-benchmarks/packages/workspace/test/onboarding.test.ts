import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { keccak256, pad, toBytes, type Abi, type Address } from 'viem'
import { AllowList, ChainAccess } from '@evmb/contracts'
import { privateKeyToAccount } from 'viem/accounts'
import { BrowserKeyStore, MemoryKeyPersistence, passphraseProvider } from '@evmb/keys'
import { MemoryFollowerStore } from '@evmb/node'
import { MemoryWorkspaceStorage, Workspace, normalizeCode } from '../src'
import { admin, adminKey, startWorker, wasm } from './harness'

const sueKey = keccak256(toBytes('o-sue')), sue = privateKeyToAccount(sueKey)
const carlKey = keccak256(toBytes('o-carl')), carl = privateKeyToAccount(carlKey) // in the AllowList, reads root, can't write it
const wendyKey = keccak256(toBytes('o-wendy')), wendy = privateKeyToAccount(wendyKey) // writes root, not in the AllowList
let w: Awaited<ReturnType<typeof startWorker>>
const persistence = new MemoryKeyPersistence()
const keys = new BrowserKeyStore({ persistence, provider: passphraseProvider({ persistence, ask: async () => 'pw' }) })
const open = (me: Address) => Workspace.open({ workerUrl: w.url, keys, me, storage: new MemoryWorkspaceStorage(), wasm, followerStore: new MemoryFollowerStore() })
const hashOf = (code: string) => keccak256(toBytes(normalizeCode(code)))

beforeAll(async () => {
  w = await startWorker()
  await keys.importKey(adminKey)
  for (const k of [sueKey, carlKey, wendyKey]) await keys.importKey(k)
  await w.adminCall(w.allowList, AllowList.abi as Abi, 'add', [{ kind: 1, value: pad(carl.address) }])
  await w.adminCall(w.access, ChainAccess.abi as Abi, 'addReader', [carl.address])
  await w.adminCall(w.access, ChainAccess.abi as Abi, 'addWriter', [wendy.address])
})
afterAll(() => w.stop())

describe('Workspace onboarding', () => {
  test('the root admin is an issuer; a fresh key is not', async () => {
    expect(await (await open(admin.address)).isIssuer()).toBe(true)
    expect(await (await open(sue.address)).isIssuer()).toBe(false)
  })

  test('a key in the AllowList that can read but not write root → not an issuer', async () => {
    expect(await (await open(carl.address)).isIssuer()).toBe(false)
  })

  test('a root writer who isn\'t an issuer → issueCode throws "issuers only", nothing sent', async () => {
    const ws = await open(wendy.address)
    expect(await ws.isIssuer()).toBe(false)
    const before = await w.as(wendy).nonce('root')
    await expect(ws.issueCode({ code: 'WENDYS', label: 'mine', validFor: '1h', uses: 1 })).rejects.toThrow('issuers only')
    expect(await w.as(wendy).nonce('root')).toBe(before)
  })

  test('root is booted once per workspace: later reads only fetch new blocks', async () => {
    const a = await open(admin.address)
    const real = globalThis.fetch
    const paths: string[] = []
    globalThis.fetch = ((u: RequestInfo | URL, init?: RequestInit) => (paths.push(new URL(String(u)).pathname), real(u, init))) as typeof fetch
    try {
      await a.isIssuer(); await a.codes(); await a.issueCode({ label: 'once', validFor: '1h', uses: 1 }); await a.codes()
    } finally { globalThis.fetch = real; await a.dispose() }
    expect(paths.filter((p) => p === '/chains/root/state').length).toBe(1)
  })

  test('a reverting root call keeps the root follower; the next call and two concurrent reads reuse it', async () => {
    const ws = await open(wendy.address) // reads root; her issue reverts "issuers only" in the simulation
    const real = globalThis.fetch
    const paths: string[] = []
    globalThis.fetch = ((u: RequestInfo | URL, init?: RequestInit) => (paths.push(new URL(String(u)).pathname), real(u, init))) as typeof fetch
    try {
      expect(await ws.isIssuer()).toBe(false)
      await expect(ws.issueCode({ label: 'no', validFor: '1h', uses: 1 })).rejects.toThrow('issuers only')
      expect((await ws.codes()).length).toBeGreaterThan(0)
      const [x, y] = await Promise.all([ws.codes(), ws.isIssuer()])
      expect(x.length).toBeGreaterThan(0)
      expect(y).toBe(false)
    } finally { globalThis.fetch = real; await ws.dispose() }
    expect(paths.filter((p) => p === '/chains/root/state').length).toBe(1)
  })

  test('concurrent issues from one workspace share the root nonce without colliding', async () => {
    const a = await open(admin.address)
    const codes = await Promise.all([1, 2, 3].map((i) => a.issueCode({ label: `burst ${i}`, validFor: '1h', uses: 1 })))
    const listed = new Set((await a.codes()).map((c) => c.hash))
    for (const { code } of codes) expect(listed.has(hashOf(code))).toBe(true)
  })

  test('issueCode with a typed code "let-sue-in" → Sue deploys with it; codes() shows usesLeft 0, status used, a grant with Sue\'s address and chain id', async () => {
    const a = await open(admin.address), s = await open(sue.address)
    expect(await a.issueCode({ code: 'let-sue-in', label: 'For Sue', validFor: '1h', uses: 1 })).toEqual({ code: 'LETSUEIN' })
    const { id } = await s.deploy((await s.createChain('Sue', '')).id, { code: 'let-sue-in' })
    const c = (await a.codes()).find((x) => x.hash === hashOf('LETSUEIN'))!
    expect(c).toMatchObject({ label: 'For Sue', issuer: admin.address, uses: 1, usesLeft: 0, status: 'used' })
    expect(c.expiresAt - c.issuedAt).toBeWithin(3595, 3605)
    expect(c.grants).toEqual([{ by: sue.address, chainId: id, at: expect.any(Number) }])
  })

  test('issueCode without a code → 6 digits; codes() lists newest first, active', async () => {
    const a = await open(admin.address)
    const { code } = await a.issueCode({ label: 'gen', validFor: '10m', uses: 3 })
    expect(code).toMatch(/^\d{6}$/)
    const [newest] = await a.codes()
    expect(newest).toMatchObject({ hash: hashOf(code), label: 'gen', uses: 3, usesLeft: 3, status: 'active', grants: [] })
  })

  test('revokeCode → status revoked; deploy with it → "code revoked"', async () => {
    const a = await open(admin.address), s = await open(sue.address)
    const { code } = await a.issueCode({ label: 'nope', validFor: '1h', uses: 2 })
    await a.revokeCode(hashOf(code))
    expect((await a.codes()).find((x) => x.hash === hashOf(code))!.status).toBe('revoked')
    const { id } = await s.createChain('revoked', '')
    await expect(s.deploy(id, { code })).rejects.toThrow('code revoked')
  })

  test('a non-issuer\'s issueCode → throws (root refuses the tx)', async () => {
    const s = await open(sue.address)
    await expect(s.issueCode({ code: 'SUESOWN', label: 'mine', validFor: '1h', uses: 1 })).rejects.toThrow('is not a writer on this chain')
  })

  test('vouch by the admin deploys; vouch by a non-issuer → "Only issuers can vouch"', async () => {
    const a = await open(admin.address), s = await open(sue.address)
    const c = await a.deploy((await a.createChain('Vouched', '')).id, { vouch: true })
    expect(c.status).toBe('deployed')
    const v = (await a.codes()).find((x) => x.label === 'Vouch: Vouched')!
    expect(v).toMatchObject({ uses: 1, usesLeft: 0, status: 'used', grants: [{ by: admin.address, chainId: c.id }] })
    expect(v.expiresAt - v.issuedAt).toBeWithin(595, 605)
    await expect(s.deploy((await s.createChain('Unvouched', '')).id, { vouch: true })).rejects.toThrow('Only issuers can vouch')
  })
})
