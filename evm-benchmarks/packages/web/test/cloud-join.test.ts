import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ChainHost, handle, type ChainHandleLike } from '@evmb/node/src/router'
import { GRANT_CREATE_CHAIN, GRANT_READER, NodeClient, claimTx, generateCode, inviteTx, setupTxs } from '@evmb/node/src/client'
import { bunSql } from '@evmb/node/test/bunSql'
import { freshDump, wasm } from '@evmb/node/scripts/bootstrap'
import { createKv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'
import { joinChain, joinLink, joinName, joinPrefill } from '../src/cloud/join'
import type { FollowerStatus } from '../src/cloud/followerChain'

// The worker stand-in, as in cloud-deploy.test.ts: packages/node's router over in-process ChainHosts on bun:sqlite.
const admin = privateKeyToAccount(generatePrivateKey())
const owner = privateKeyToAccount(generatePrivateKey())
const hosts = new Map<string, ChainHost>()
const chainHost = (id: string): ChainHandleLike => {
  let h = hosts.get(id)
  if (!h) hosts.set(id, (h = new ChainHost(bunSql(), wasm, { rootAdmin: admin.address, chain: chainHost })))
  return h
}
let srv: ReturnType<typeof Bun.serve>
let url: string
let chainId: string
let access: `0x${string}`
const o = () => new NodeClient(url, owner)
/** An invite on the owner's chain. */
async function invite(grants: number) {
  const code = generateCode()
  await o().submit(chainId, [await inviteTx(owner, await o().nonce(chainId), access, code, 600, 1, grants)])
  return code
}

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

/** A second browser whose only key is `phone`. */
function phoneBrowser() {
  const phone = privateKeyToAccount(generatePrivateKey())
  const kv = createKv()
  const registry = createChainRegistry({
    kv, host: () => ({}),
    follower: { wasm: async () => wasm, account: (a) => (a.toLowerCase() === phone.address.toLowerCase() ? { account: phone, label: 'phone' } : undefined) },
  })
  return { phone, kv, registry, client: new NodeClient(url, phone, { name: 'phone' }) }
}
const status = (h: { approach: unknown }) => (h.approach as { status(): FollowerStatus }).status()

describe('joinChain', () => {
  test('a second key joins with a reader code and follows', async () => {
    const { phone, kv, registry, client } = phoneBrowser()
    const code = await invite(GRANT_READER)
    const h = await joinChain({ client, chainId, code: ` ${code} `, account: phone, name: 'From the laptop', registry })
    expect(h.info).toMatchObject({ name: 'From the laptop', type: 'follower', follows: { nodeUrl: url, chainId, account: phone.address } })
    const head = (await o().info(chainId)).head
    expect(status(h)).toEqual({ kind: 'following', block: head.number, behind: 0 })
    expect(((await h.request('eth_getBlockByNumber', ['latest', false])) as { hash: string }).hash).toBe(head.hash)
    expect(await kv.get<any>('chains', h.info.id)).toMatchObject({ type: 'follower', follows: { chainId } })
    const me = (await o().nodes(chainId)).members.find((m) => m.address.toLowerCase() === phone.address.toLowerCase())
    expect(me).toMatchObject({ role: 'reader', name: 'phone' })
    await registry.remove(h.info.id)
  })

  test('a bad, used or create-chain code → the worker\'s message, nothing added', async () => {
    const used = await invite(GRANT_READER)
    const first = phoneBrowser()
    await first.registry.remove((await joinChain({ ...first, chainId, code: used, account: first.phone, name: 'x' })).info.id)
    const deployOnly = await invite(GRANT_CREATE_CHAIN)
    // ponytail: expiry is covered by packages/node service-devices.test.ts (it needs a controllable clock)
    for (const code of ['not-a-real-code', used, deployOnly]) {
      const b = phoneBrowser()
      const e = await joinChain({ ...b, chainId, code, account: b.phone, name: 'x' }).catch((x) => x)
      expect(e).toBeInstanceOf(Error)
      expect(e.message).toBe('bad, used or expired code')
      expect(await b.registry.list()).toEqual([])
      expect(b.registry.liveCount()).toBe(0)
    }
  })

  test('joined but not opened: the chain stays listed and can be opened later', async () => {
    const phone = privateKeyToAccount(generatePrivateKey())
    const kv = createKv()
    const client = new NodeClient(url, phone, { name: 'phone' })
    // no follower support here, so opening fails after the code is spent
    const e = await joinChain({ client, chainId, code: await invite(GRANT_READER), account: phone, name: 'Later', registry: createChainRegistry({ kv, host: () => ({}) }) }).catch((x) => x)
    expect(e.message).toStartWith("Joined, but couldn't open it yet: ")
    expect(e.joined).toBeString()
    const later = createChainRegistry({ kv, host: () => ({}), follower: { wasm: async () => wasm, account: () => ({ account: phone, label: 'phone' }) } })
    expect(await later.list()).toMatchObject([{ id: e.joined, name: 'Later', type: 'follower', follows: { chainId, account: phone.address } }])
    const h = await later.open(e.joined)
    expect(status(h)).toMatchObject({ kind: 'following' })
    await later.remove(h.info.id)
  })

  test('the default name is "Joined <short id>"', () => {
    expect(joinName('0123456789abcdef')).toBe('Joined 01234567')
  })
})

describe('joinPrefill', () => {
  test('the join link prefills URL, chain id and code', () => {
    expect(joinPrefill('?node=https%3A%2F%2Fnode.example&chain=abc-123&code=apple-river')).toEqual({ nodeUrl: 'https://node.example', chainId: 'abc-123', code: 'apple-river' })
    expect(joinPrefill('')).toEqual({})
    // only what a join could use: an http(s) URL that parses, a chain-id token
    expect(joinPrefill('?node=javascript%3Aalert(1)&chain=..%2Fx')).toEqual({})
    expect(joinPrefill('?node=http%3A%2F%2F%5B&chain=ok')).toEqual({ chainId: 'ok' })
  })

  test('the join link carries URL and chain id, and prefills them back', () => {
    const link = joinLink('https://evm.fun/', 'https://node.example', 'abc-123')
    expect(link).toBe('https://evm.fun/#/cloud/join?node=https%3A%2F%2Fnode.example&chain=abc-123')
    expect(joinPrefill(link.slice(link.indexOf('?')))).toEqual({ nodeUrl: 'https://node.example', chainId: 'abc-123' })
  })

  test('joinLink without a code has no code param', () => {
    expect(joinLink('https://evm.fun/', 'https://n.example', 'c1')).not.toContain('code')
    expect(joinLink('https://evm.fun/', 'https://n.example', 'c1', '  ')).not.toContain('code')
  })

  test('a code round-trips exactly through the link', () => {
    const code = 'a&b #c=d ü'
    const link = joinLink('https://evm.fun/', 'https://n.example', 'c1', code)
    expect(joinPrefill(link.slice(link.indexOf('?')))).toEqual({ nodeUrl: 'https://n.example', chainId: 'c1', code })
  })

  test('joinPrefill ignores a blank or 201-char code, and trims', () => {
    expect(joinPrefill('?chain=c1&code=%20%20')).toEqual({ chainId: 'c1' })
    expect(joinPrefill(`?chain=c1&code=${'x'.repeat(201)}`)).toEqual({ chainId: 'c1' })
    expect(joinPrefill(`?code=${'x'.repeat(200)}`)).toEqual({ code: 'x'.repeat(200) })
    expect(joinPrefill('?code=%20apple-river%20')).toEqual({ code: 'apple-river' })
  })
})
