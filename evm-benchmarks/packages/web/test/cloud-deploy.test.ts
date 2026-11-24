import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ChainHost, handle, type ChainHandleLike } from '@evmb/node/src/router'
import { MAX_CREATE_BYTES, NodeClient, NodeError, generateCode, inviteTx, setupTxs } from '@evmb/node/src/client'
import { bunSql } from '@evmb/node/test/bunSql'
import { freshDump, wasm } from '@evmb/node/scripts/bootstrap'
import { createKv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'
import { convertDeployed, deployChain } from '../src/cloud/deploy'
import { createContractsRegistry } from '../src/contracts/registry'
import type { FollowerStatus } from '../src/cloud/followerChain'
import { nodeUrl, setNodeUrl, DEFAULT_NODE_URL } from '../src/cloud/node'

// The worker stand-in: packages/node's own router over in-process ChainHosts on bun:sqlite.
const admin = privateKeyToAccount(generatePrivateKey())
const user = privateKeyToAccount(generatePrivateKey())
const B = '0x000000000000000000000000000000000000dEaD' as const
const stranger = privateKeyToAccount(generatePrivateKey())
const hosts = new Map<string, ChainHost>()
const chainHost = (id: string): ChainHandleLike => {
  let h = hosts.get(id)
  if (!h) hosts.set(id, (h = new ChainHost(bunSql(), wasm, { rootAdmin: admin.address, chain: chainHost })))
  return h
}
let srv: ReturnType<typeof Bun.serve>
let url: string
let access: `0x${string}`
const adminClient = () => new NodeClient(url, admin)
async function issue(code: string) {
  const c = adminClient()
  await c.submit('root', [await inviteTx(admin, await c.nonce('root'), access, code, 600, 1)])
}

beforeAll(async () => {
  srv = Bun.serve({ port: 0, fetch: (r) => handle(r, { chain: chainHost }) })
  url = `http://localhost:${srv.port}`
  await adminClient().createChain({ dump: await freshDump(), setup: await setupTxs(admin, 0, 31337) })
  access = (await adminClient().health()).root!.access
})
afterAll(() => srv.stop(true))

/** A browser registry (memory persistence) with one plain chain where `user` has sent a tx; `user`'s key is in this browser unless `keys.off`. */
async function browserChain() {
  const stores = new Map<string, any>()
  const kv = createKv()
  const keys = { off: false }
  const registry = createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
    purge: async (id: string) => void stores.delete(id),
    follower: { wasm: async () => wasm, account: (a) => (!keys.off && a.toLowerCase() === user.address.toLowerCase() ? { account: user, label: 'laptop' } : undefined) },
  })
  const chain = await registry.create('mine', 'plain', [user.address])
  await chain.send(await user.signTransaction({ type: 'eip1559', chainId: 31337, nonce: 0, to: B, value: 7n, gas: 21_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }))
  return { registry, kv, chain, stores, keys }
}
const status = (h: { approach: unknown }) => (h.approach as { status(): FollowerStatus }).status()
const head = async (c: { request(m: string, p?: unknown[]): Promise<unknown> }) => ((await c.request('eth_getBlockByNumber', ['latest', false])) as { hash: string; number: string })

/** A plain chain deployed before follower conversion existed: the key is missing during the deploy, so the copy stays plain with `deployed` recorded. */
async function legacyDeploy() {
  const chain = await browserChain()
  const code = generateCode()
  await issue(code)
  const before = await chain.chain.approach.snapshot!() // the browser copy before the deploy's set-up block
  chain.keys.off = true
  const e = await deployChain({ chain: chain.chain, account: user, code, client: new NodeClient(url, user), registry: chain.registry, onStep: () => {} }).catch((x) => x)
  chain.keys.off = false
  const handle = chain.registry.peek(chain.chain.info.id)!
  return { chain: { ...chain, id: chain.chain.info.id }, handle, deployed: handle.info.deployed!, before, r: { e } }
}

describe('deployChain', () => {
  test('after deploy the chain is a follower at the cloud head with the same id and records', async () => {
    const { registry, kv, chain, stores } = await browserChain()
    const id = chain.info.id
    const rec = { address: '0x00000000000000000000000000000000000000aa', name: 'T', abi: [] as any[], deployer: user.address, txHash: `0x${'ab'.repeat(32)}` as const } as const
    await createContractsRegistry(kv).add(id, rec)
    const code = generateCode()
    await issue(code)
    const r = await deployChain({ chain, account: user, code, client: new NodeClient(url, user), registry, onStep: () => {} })
    const f = registry.peek(id)!
    expect(f).not.toBe(chain)
    expect(f.info).toMatchObject({ id, name: 'mine', type: 'follower', follows: { nodeUrl: url, chainId: r.chainId, account: user.address } })
    expect(status(f)).toEqual({ kind: 'following', block: r.head.number, behind: 0 })
    const h = await head(f)
    expect(h.hash).toBe(r.head.hash)
    expect(Number(h.number)).toBe(r.head.number)
    expect(await f.approach.getBalance(B)).toBe(7n) // the browser's state came back with the set-up block on top
    expect(r.url).toBe(`${url}/chains/${r.chainId}`)
    expect(await createContractsRegistry(kv).list(id)).toEqual([{ ...rec, chainId: id }] as any)
    expect(await kv.get<any>('chains', id)).toMatchObject({ type: 'follower', follows: { chainId: r.chainId } })
    expect(stores.has(id)).toBe(false) // the plain engine's state is gone
    expect((await new NodeClient(url, user).info(r.chainId)).admin.toLowerCase()).toBe(user.address.toLowerCase())
    // a reload re-syncs it as a follower
    await registry.close(id)
    const again = await registry.open(id)
    expect([again.info.type, (await head(again)).hash]).toEqual(['follower', r.head.hash])
    // deployed once: refused before any step, code unspent
    const steps: string[] = [], code2 = generateCode()
    await issue(code2)
    await expect(deployChain({ chain: again, account: user, code: code2, client: new NodeClient(url, user), registry, onStep: (s) => steps.push(s) })).rejects.toThrow(`Already follows ${r.chainId}`)
    expect(steps).toEqual([])
    expect((await adminClient().codes()).find((c) => c.redeemed.length === 0 && c.usesLeft === 1)).toBeTruthy()
    await registry.remove(id)
  })

  test('a refused deploy still changes nothing (same handle, head hash, type; no deployed field); another code then works', async () => {
    const { registry, kv, chain } = await browserChain()
    const before = await head(chain)
    const e = await deployChain({ chain, account: user, code: 'not-a-real-code', client: new NodeClient(url, user), registry, onStep: () => {} }).catch((x) => x)
    expect(e).toBeInstanceOf(NodeError)
    expect(e.status).toBe(403)
    expect(await head(chain)).toEqual(before)
    expect(registry.peek(chain.info.id)).toBe(chain)
    expect(chain.info.deployed).toBeUndefined()
    expect(await kv.get<any>('chains', chain.info.id)).toMatchObject({ type: 'plain' })
    expect((await kv.get<any>('chains', chain.info.id)).deployed).toBeUndefined()
    const code = generateCode()
    await issue(code)
    const r = await deployChain({ chain, account: user, code, client: new NodeClient(url, user), registry, onStep: () => {} })
    expect((await head(registry.peek(chain.info.id)!)).hash).toBe(r.head.hash)
    await registry.remove(chain.info.id)
  })

  test('steps are reported in order, with tx hashes and the worker URL', async () => {
    const { registry, chain } = await browserChain()
    const code = generateCode()
    await issue(code)
    const steps: [string, string][] = []
    const r = await deployChain({ chain, account: user, code, client: new NodeClient(url, user), registry, onStep: (s, d) => steps.push([s, d]) })
    expect(steps.map(([s]) => s)).toEqual(['prepare', 'code', 'node', 'replace'])
    expect(steps[0]![1]).toMatch(/0x[0-9a-f]{64}.*0x[0-9a-f]{64}/)
    expect(steps[1]![1]).toMatch(/0x[0-9a-f]{64}/)
    expect(steps[2]![1]).toContain(url)
    expect(steps[3]![1]).toContain(r.head.hash)
    await registry.remove(chain.info.id)
  })

  test('pending txs: refused before anything is sent', async () => {
    const { registry, chain } = await browserChain()
    const steps: string[] = []
    chain.approach.pending = () => 2
    const e = await deployChain({ chain, account: user, code: 'x', client: new NodeClient(url, user), registry, onStep: (s) => steps.push(s) }).catch((x) => x)
    expect(e.message).toMatch(/2 pending transactions/)
    expect(e.step).toBe('prepare')
    expect(steps).toEqual([])
    await chain.dispose()
  })

  test('a chain over the upload limit: refused at prepare, before any request (no code spent)', async () => {
    const { registry, chain } = await browserChain()
    const real = chain.approach.snapshot!
    chain.approach.snapshot = async () => ({ ...(await real()), pad: 'x'.repeat(MAX_CREATE_BYTES + 2 ** 20) }) as any
    let requests = 0
    const realFetch = globalThis.fetch
    globalThis.fetch = ((...a: Parameters<typeof fetch>) => (requests++, realFetch(...a))) as typeof fetch
    try {
      const steps: string[] = []
      const e = await deployChain({ chain, account: user, code: 'x', client: new NodeClient(url, user), registry, onStep: (s) => steps.push(s) }).catch((x) => x)
      expect(e.message).toMatch(/^Your chain is too large to deploy \(9\.0 MB, limit 8 MB\)$/)
      expect([e.step, steps, requests]).toEqual(['prepare', [], 0])
    } finally {
      globalThis.fetch = realFetch
      await chain.dispose()
    }
  })

  test('a worker refusal is tagged with the step that failed: a bad code → code', async () => {
    const { registry, chain } = await browserChain()
    const e = await deployChain({ chain, account: user, code: 'nope', client: new NodeClient(url, user), registry, onStep: () => {} }).catch((x) => x)
    expect([e.status, e.step]).toEqual([403, 'code'])
    await chain.dispose()
  })

  test('after the cloud chain exists, a failed match says so with its id, puts the browser copy back, records nothing', async () => {
    const { registry, kv, chain } = await browserChain()
    const before = await head(chain)
    let calls = 0
    const flaky = { setDeployed: registry.setDeployed, convertToFollower: registry.convertToFollower, replaceState: async (id: string, d: unknown) => { if (++calls === 1) throw new Error('disk full'); return registry.replaceState(id, d) } }
    const code = generateCode()
    await issue(code)
    const e = await deployChain({ chain, account: user, code, client: new NodeClient(url, user), registry: flaky, onStep: () => {} }).catch((x) => x)
    expect(e.message).toMatch(/^Deployed as [0-9a-f-]{36} \(http:\/\/localhost:\d+\/chains\/[0-9a-f-]{36}\), but your browser copy couldn't be matched: disk full$/)
    expect(e.step).toBe('replace')
    expect(e.chainId).toBeTruthy()
    expect(e.url).toBe(`${url}/chains/${e.chainId}`)
    expect(calls).toBe(2) // the rollback ran
    expect(await head(chain)).toEqual(before)
    expect((await kv.get<any>('chains', chain.info.id)).deployed).toBeUndefined()
    // a rollback that fails too is surfaced, not swallowed
    const broken = { setDeployed: registry.setDeployed, convertToFollower: registry.convertToFollower, replaceState: async () => { throw new Error('gone') } }
    const code2 = generateCode()
    await issue(code2)
    const e2 = await deployChain({ chain, account: user, code: code2, client: new NodeClient(url, user), registry: broken as any, onStep: () => {} }).catch((x) => x)
    expect(e2.message).toMatch(/couldn't be matched: gone; putting your browser copy back failed too: gone$/)
    await chain.dispose()
  })

  test("converting fails after the cloud chain exists: says so with its id; the browser copy stays a usable plain chain at the cloud head, deployed recorded", async () => {
    const { chain, r, handle, deployed } = await legacyDeploy()
    expect(handle.info.type).toBe('plain')
    expect(deployed).toMatchObject({ nodeUrl: url, chainId: r.e.chainId })
    expect((await head(handle)).hash).toBe((await new NodeClient(url, user).state(r.e.chainId)).head.hash)
    expect(await handle.approach.getBalance(B)).toBe(7n) // usable
    await chain.registry.remove(chain.id)
    expect(r.e.message).toMatch(new RegExp(`^Deployed as ${r.e.chainId} \\(http://localhost:\\d+/chains/${r.e.chainId}\\), but your browser copy couldn't be switched to follow it: Needs ${user.address}'s key$`))
    expect([r.e.step, r.e.url]).toEqual(['replace', `${url}/chains/${r.e.chainId}`])
  })

  test('convertDeployed converts at the deployed head; returns diverged after a local block, and converts only when asked', async () => {
    // at the deployed head: converts quietly, signing as the deploying (admin) account
    const a = await legacyDeploy()
    expect(a.handle.info.type).toBe('plain')
    expect(Number((await head(a.handle)).number)).toBe(a.deployed.head)
    expect(await convertDeployed(a.chain.id, { registry: a.chain.registry, accounts: [stranger, user] })).toBe('converted')
    const f = a.chain.registry.peek(a.chain.id)!
    expect(f.info).toMatchObject({ type: 'follower', follows: { nodeUrl: url, chainId: a.deployed.chainId, account: user.address } })
    expect(status(f).kind).toBe('following')
    await a.chain.registry.remove(a.chain.id)
    // a local block since: diverged, nothing changes until asked
    const b = await legacyDeploy()
    await b.handle.send(await user.signTransaction({ type: 'eip1559', chainId: 31337, nonce: 3, to: B, value: 1n, gas: 21_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }))
    expect(await convertDeployed(b.chain.id, { registry: b.chain.registry, accounts: [user] })).toBe('diverged')
    expect(b.chain.registry.peek(b.chain.id)).toBe(b.handle)
    expect(b.handle.info.type).toBe('plain')
    expect(b.chain.stores.has(b.chain.id)).toBe(true)
    expect(await convertDeployed(b.chain.id, { registry: b.chain.registry, accounts: [user], force: true })).toBe('converted')
    const g = b.chain.registry.peek(b.chain.id)!
    expect(g.info.type).toBe('follower')
    expect(Number((await head(g)).number)).toBe(b.deployed.head)
    await b.chain.registry.remove(b.chain.id)
    // rewound and re-mined to exactly the deployed height: a different block there, so diverged
    const d = await legacyDeploy()
    await d.chain.registry.replaceState(d.chain.id, d.before)
    await d.handle.send(await user.signTransaction({ type: 'eip1559', chainId: 31337, nonce: 1, to: B, value: 2n, gas: 21_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }))
    expect(Number((await head(d.handle)).number)).toBe(d.deployed.head)
    expect(await convertDeployed(d.chain.id, { registry: d.chain.registry, accounts: [user] })).toBe('diverged')
    expect(d.chain.registry.peek(d.chain.id)).toBe(d.handle)
    // the follow account is the cloud chain's admin: without its key, refused and nothing changes
    await expect(convertDeployed(d.chain.id, { registry: d.chain.registry, accounts: [stranger], force: true })).rejects.toThrow("Needs the chain admin's key")
    expect(d.handle.info.type).toBe('plain')
    await d.chain.registry.remove(d.chain.id)
    // not a deployed plain chain: refused
    const c = await browserChain()
    await expect(convertDeployed(c.chain.info.id, { registry: c.registry, accounts: [user] })).rejects.toThrow(/isn't a deployed plain chain/)
    await c.registry.remove(c.chain.info.id)
  })

  test('convertDeployed asks the cloud with the selected account first and stops at the first admin', async () => {
    const a = await legacyDeploy()
    const realFetch = globalThis.fetch
    const infos: string[] = [] // GET /chains/:id, one per account probed
    globalThis.fetch = ((u: any, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET' && new URL(String(u)).pathname === `/chains/${a.deployed.chainId}`) infos.push(String(u))
      return realFetch(u, init)
    }) as typeof fetch
    try {
      const others = Array.from({ length: 3 }, () => privateKeyToAccount(generatePrivateKey()))
      expect(await convertDeployed(a.chain.id, { registry: a.chain.registry, accounts: [...others, user], prefer: user.address })).toBe('converted')
      expect(infos.length).toBe(1)
    } finally { globalThis.fetch = realFetch }
    await a.chain.registry.remove(a.chain.id)
  })

  test('benchmark and sequencer chains are refused before anything is sent', async () => {
    const { registry, chain } = await browserChain()
    const seq = await registry.create('s', 'sequencer', [user.address])
    const steps: string[] = []
    await expect(deployChain({ chain: seq, account: user, code: 'x', client: new NodeClient(url, user), registry, onStep: (s) => steps.push(s) })).rejects.toThrow(/plain/)
    expect(steps).toEqual([])
    await seq.dispose()
    await chain.dispose()
  })
})

test('node URL: default, per-browser override, cleared back to default; blocked storage falls back to the default', () => {
  const g = globalThis as any
  expect(DEFAULT_NODE_URL).toBe('http://localhost:8799')
  expect(nodeUrl()).toBe(DEFAULT_NODE_URL) // no localStorage at all
  const m = new Map<string, string>()
  g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
  try {
    setNodeUrl('http://example.test:1')
    expect(nodeUrl()).toBe('http://example.test:1')
    setNodeUrl('')
    expect(nodeUrl()).toBe(DEFAULT_NODE_URL)
    g.localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
    expect(() => setNodeUrl('http://x')).not.toThrow()
    expect(nodeUrl()).toBe(DEFAULT_NODE_URL)
  } finally {
    delete g.localStorage
  }
})

test('Cloud sits under Setup after Chains; it renders the node and checks it; codes expire text', async () => {
  const { createElement: h } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { MemoryRouter } = await import('react-router-dom')
  const { groups, real } = await import('../src/App')
  const { AppState } = await import('../src/state')
  const { AppBarProvider } = await import('../src/state/appBar')
  const { expiresIn } = await import('../src/components/cloud/CodesPanel')
  expect(groups[0].items.map(([n]) => n)).toEqual(['Get started', 'Accounts', 'Chains', 'Cloud'])
  const html = renderToString(h(MemoryRouter, { initialEntries: ['/cloud'] }, h(AppState, null, h(AppBarProvider, null, real.Cloud!)))).replaceAll('<!-- -->', '')
  expect(html).toContain('Checking http://localhost:8799…')
  expect(html).toContain('Chains you follow')
  expect([expiresIn(100, 200), expiresIn(500, 200), expiresIn(200 + 7200, 200), expiresIn(200 + 2 * 86400, 200)]).toEqual(['expired', '5 min', '2 h', '2 days'])
})
