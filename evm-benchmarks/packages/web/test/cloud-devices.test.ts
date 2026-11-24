import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ChainHost, handle, type ChainHandleLike } from '@evmb/node/src/router'
import { GRANT_READER, GRANT_WRITER, NodeClient, NodeError, accessTx, claimTx, generateCode, inviteTx, setupTxs } from '@evmb/node/src/client'
import { bunSql } from '@evmb/node/test/bunSql'
import { freshDump, wasm } from '@evmb/node/scripts/bootstrap'
import { createKv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'
import { MAX_CODE_LENGTH, codeUsable, joinChain, joinPrefill } from '../src/cloud/join'
import { inviteDefaults, inviteDevice, inviteShare, multiUseWriterWarning, removeDevice, singleLinkWarning } from '../src/cloud/devices'

// The worker stand-in, as in cloud-join.test.ts: packages/node's router over in-process ChainHosts on bun:sqlite.
const admin = privateKeyToAccount(generatePrivateKey())
const owner = privateKeyToAccount(generatePrivateKey())
const hosts = new Map<string, ChainHost>()
const chainHost = (id: string): ChainHandleLike => {
  let h = hosts.get(id)
  if (!h) hosts.set(id, (h = new ChainHost(bunSql(), wasm, { rootAdmin: admin.address, chain: chainHost })))
  return h
}
let srv: ReturnType<typeof Bun.serve>, url: string, chainId: string, access: `0x${string}`
const o = () => new NodeClient(url, owner)

beforeAll(async () => {
  srv = Bun.serve({ port: 0, fetch: (r) => handle(r, { chain: chainHost }) })
  url = `http://localhost:${srv.port}`
  const a = new NodeClient(url, admin)
  await a.createChain({ dump: await freshDump(), setup: await setupTxs(admin, 0, 31337) })
  const rootAccess = (await a.health()).root!.access
  const deploy = generateCode()
  await a.submit('root', [await inviteTx(admin, await a.nonce('root'), rootAccess, deploy, 600, 1)])
  chainId = (await o().createChain({ dump: await freshDump(), setup: await setupTxs(owner, 0, 31337), claim: await claimTx(owner, await o().nonce('root'), deploy, rootAccess) })).chainId
  access = (await o().info(chainId)).access
})
afterAll(() => srv.stop(true))

/** A new key that joins the owner's chain with `grants` (read straight from the worker). */
async function member(grants: number) {
  const key = privateKeyToAccount(generatePrivateKey())
  const code = generateCode()
  await o().submit(chainId, [await inviteTx(owner, await o().nonce(chainId), access, code, 600, 1, grants)])
  const c = new NodeClient(url, key, { name: 'k' })
  const { nonce } = await c.joinInfo(chainId)
  await c.join(chainId, await claimTx(key, nonce, code, access))
  await c.nodes(chainId) // leaves a cursor, so it is listed with its name
  return { key, client: c, m: (await o().nodes(chainId)).members.find((x) => x.address === key.address)! }
}

describe('inviteDevice', () => {
  test('invite then a second key joins with that code', async () => {
    for (const role of ['reader', 'writer'] as const) {
      const code = generateCode()
      await inviteDevice({ client: o(), chainId, admin: owner, code, ttlS: 300, uses: 1, role })
      const phone = privateKeyToAccount(generatePrivateKey())
      const registry = createChainRegistry({ kv: createKv(), host: () => ({}), follower: { wasm: async () => wasm, account: () => ({ account: phone, label: 'phone' }) } })
      const h = await joinChain({ client: new NodeClient(url, phone, { name: 'phone' }), chainId, code, account: phone, name: 'p', registry })
      const me = (await o().nodes(chainId)).members.find((m) => m.address === phone.address)
      expect(me).toMatchObject({ role, name: 'phone' })
      await registry.remove(h.info.id)
    }
  })
})

describe('removeDevice', () => {
  test('removeDevice removes a reader, a writer, and one with both roles in one submit; the member then gets 403', async () => {
    for (const grants of [GRANT_READER, GRANT_WRITER, GRANT_READER | GRANT_WRITER]) {
      const { client, m } = await member(grants)
      const before = (await o().info(chainId)).head.number
      await removeDevice({ client: o(), chainId, admin: owner, member: m, closeReads: false })
      expect((await o().info(chainId)).head.number).toBe(before + 1) // one submit → one block
      expect((await o().nodes(chainId)).members.some((x) => x.address === m.address)).toBe(false)
      const e = await client.nodes(chainId).catch((x) => x)
      expect(e).toBeInstanceOf(NodeError)
      expect(e.status).toBe(403)
    }
  })

  test('closeReads sends setReadOpen(false) too', async () => {
    await o().submit(chainId, [await accessTx(owner, await o().nonce(chainId), access, 'setReadOpen', true)])
    expect((await o().nodes(chainId)).readOpen).toBe(true)
    const { client, m } = await member(GRANT_READER)
    await removeDevice({ client: o(), chainId, admin: owner, member: m, closeReads: true })
    expect((await o().nodes(chainId)).readOpen).toBe(false)
    expect(await client.nodes(chainId).catch((x) => x.status)).toBe(403)
  })

  test('a remove the chain refuses rejects with the reason (it is not reported done)', async () => {
    const refused = { hash: '0x01', result: 'refused', code: 'nonce', reason: 'nonce too low: stale' } as const
    const client = { joinInfo: async () => ({ nonce: 0, access }), submit: async () => ({ head: { number: 1, hash: '0x', stateRoot: '0x' }, results: [refused] }) } as unknown as NodeClient
    const member = { address: owner.address, role: 'reader' } as const
    await expect(removeDevice({ client, chainId, admin: owner, member, closeReads: false })).rejects.toThrow('nonce too low: stale')
    await expect(inviteDevice({ client, chainId, admin: owner, code: 'c', ttlS: 60, uses: 1, role: 'reader' })).rejects.toThrow('nonce too low: stale')
  })

  test('the admin is never removed', async () => {
    const me = (await o().nodes(chainId)).members.find((x) => x.role === 'admin')!
    await expect(removeDevice({ client: o(), chainId, admin: owner, member: me, closeReads: false })).rejects.toThrow("The chain's admin can't be removed")
  })
})

test('multi-use writer warning', () => {
  const w = 'Anyone who can read this chain could see a multi-use writer code once it is used. Prefer single-use.'
  expect(multiUseWriterWarning('writer', 2)).toBe(w)
  expect(multiUseWriterWarning('writer', 1)).toBeUndefined()
  expect(multiUseWriterWarning('reader', 5)).toBeUndefined()
})

test('follower status badges', async () => {
  const { statusBadge } = await import('../src/cloud/followerChain')
  expect(statusBadge({ kind: 'following', block: 9, behind: 0 })).toEqual({ text: 'in sync', tone: 'success' })
  expect(statusBadge({ kind: 'following', block: 9, behind: 3 })).toEqual({ text: '3 behind', tone: 'warn' })
  expect(statusBadge({ kind: 'removed', detail: '' })).toEqual({ text: 'removed', tone: 'danger' })
  expect(statusBadge({ kind: 'unreachable', detail: '' })).toEqual({ text: 'unreachable', tone: 'warn' })
})

const share = { base: 'https://x.test/app', nodeUrl: 'https://n.test', chainId: '0xabc', code: 'a&b #c' }
test('inviteShare single link carries the code and returns no separate code', () => {
  const r = inviteShare({ ...share, singleLink: true })
  expect(r.code).toBeUndefined()
  expect(joinPrefill(r.link.slice(r.link.indexOf('?')))).toEqual({ nodeUrl: 'https://n.test', chainId: '0xabc', code: 'a&b #c' })
})
test('inviteShare default returns a code-free link and the code', () => {
  const r = inviteShare({ ...share, singleLink: false })
  expect(r.code).toBe('a&b #c')
  expect(r.link).not.toContain('code')
  expect(r.link).not.toContain('%23c')
})
test('singleLinkWarning names the role', () => {
  expect(singleLinkWarning('writer')).toBe("Anyone with this link can join as writer until it's used up or expires. Share it only somewhere private.")
  expect(singleLinkWarning('reader')).toContain('join as reader')
})

test('inviteDefaults is single-use reader, 1 h, no single link', () => {
  expect(inviteDefaults).toEqual({ ttl: '3600', uses: '1', role: 'reader', singleLink: false })
})

test('a code the wizard accepts (200 chars) survives inviteShare -> joinPrefill; 201 and blank are rejected', () => {
  const code = 'ü'.repeat(MAX_CODE_LENGTH)
  expect(codeUsable(code)).toBe(true)
  const r = inviteShare({ ...share, code, singleLink: true })
  expect(joinPrefill(r.link.slice(r.link.indexOf('?'))).code).toBe(code)
  expect(codeUsable(code + 'x')).toBe(false)
  expect(codeUsable('  ')).toBe(false)
})
