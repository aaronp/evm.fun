import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { keccak256, toBytes, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { BrowserKeyStore, MemoryKeyPersistence, passphraseProvider } from '@evmb/keys'
import { MemoryFollowerStore } from '@evmb/node'
import { MemoryWorkspaceStorage, Workspace, normalizeCode } from '../src'
import { admin, adminKey, startWorker, wasm } from './harness'

const sueKey = keccak256(toBytes('o-sue')), sue = privateKeyToAccount(sueKey)
let w: Awaited<ReturnType<typeof startWorker>>
const persistence = new MemoryKeyPersistence()
const keys = new BrowserKeyStore({ persistence, provider: passphraseProvider({ persistence, ask: async () => 'pw' }) })
const open = (me: Address) => Workspace.open({ workerUrl: w.url, keys, me, storage: new MemoryWorkspaceStorage(), wasm, followerStore: new MemoryFollowerStore() })
const hashOf = (code: string) => keccak256(toBytes(normalizeCode(code)))

beforeAll(async () => {
  w = await startWorker()
  await keys.importKey(adminKey)
  await keys.importKey(sueKey)
})
afterAll(() => w.stop())

describe('Workspace onboarding', () => {
  test('the root admin is an issuer; a fresh key is not', async () => {
    expect(await (await open(admin.address)).isIssuer()).toBe(true)
    expect(await (await open(sue.address)).isIssuer()).toBe(false)
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
