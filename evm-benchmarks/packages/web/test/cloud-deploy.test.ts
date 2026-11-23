import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ChainHost, handle, type ChainHandleLike } from '@evmb/node/src/router'
import { NodeClient, NodeError, generateCode, inviteTx, setupTxs } from '@evmb/node/src/client'
import { bunSql } from '@evmb/node/test/bunSql'
import { freshDump, wasm } from '@evmb/node/scripts/bootstrap'
import { createKv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'
import { deployChain } from '../src/cloud/deploy'
import { nodeUrl, setNodeUrl, DEFAULT_NODE_URL } from '../src/cloud/node'

// The worker stand-in: packages/node's own router over in-process ChainHosts on bun:sqlite.
const admin = privateKeyToAccount(generatePrivateKey())
const user = privateKeyToAccount(generatePrivateKey())
const B = '0x000000000000000000000000000000000000dEaD' as const
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

/** A browser registry (memory persistence) with one plain chain where `user` has sent a tx. */
async function browserChain() {
  const stores = new Map<string, any>()
  const kv = createKv()
  const registry = createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
    purge: async (id: string) => void stores.delete(id),
  })
  const chain = await registry.create('mine', 'plain', [user.address])
  await chain.send(await user.signTransaction({ type: 'eip1559', chainId: 31337, nonce: 0, to: B, value: 7n, gas: 21_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }))
  return { registry, kv, chain }
}
const head = async (c: { request(m: string, p?: unknown[]): Promise<unknown> }) => ((await c.request('eth_getBlockByNumber', ['latest', false])) as { hash: string; number: string })

describe('deployChain', () => {
  test('deploys, replaces the local chain, head hash matches, records deployed', async () => {
    const { registry, kv, chain } = await browserChain()
    const code = generateCode()
    await issue(code)
    const r = await deployChain({ chain, account: user, code, client: new NodeClient(url, user), registry, onStep: () => {} })
    const h = await head(chain)
    expect(h.hash).toBe(r.head.hash)
    expect(Number(h.number)).toBe(r.head.number)
    expect(await chain.approach.getBalance(B)).toBe(7n) // the browser's state came back with the set-up block on top
    expect(r.url).toBe(`${url}/chains/${r.chainId}`)
    const want = { nodeUrl: url, chainId: r.chainId, head: r.head.number }
    expect(chain.info.deployed).toMatchObject(want)
    expect((await kv.get<any>('chains', chain.info.id)).deployed).toMatchObject(want)
    expect((await registry.list())[0]!.lastHeight).toBe(r.head.number)
    expect((await new NodeClient(url, user).info(r.chainId)).admin.toLowerCase()).toBe(user.address.toLowerCase())
    // deployed once: refused before any step, code unspent
    const steps: string[] = [], again = generateCode()
    await issue(again)
    await expect(deployChain({ chain, account: user, code: again, client: new NodeClient(url, user), registry, onStep: (s) => steps.push(s) })).rejects.toThrow(`Already deployed as ${r.chainId}`)
    expect(steps).toEqual([])
    expect((await adminClient().codes()).find((c) => c.redeemed.length === 0 && c.usesLeft === 1)).toBeTruthy()
    await chain.dispose()
  })

  test('a refused code leaves the local chain unchanged (same head hash, no deployed field); another code then works', async () => {
    const { registry, kv, chain } = await browserChain()
    const before = await head(chain)
    const e = await deployChain({ chain, account: user, code: 'not-a-real-code', client: new NodeClient(url, user), registry, onStep: () => {} }).catch((x) => x)
    expect(e).toBeInstanceOf(NodeError)
    expect(e.status).toBe(403)
    expect(await head(chain)).toEqual(before)
    expect(chain.info.deployed).toBeUndefined()
    expect((await kv.get<any>('chains', chain.info.id)).deployed).toBeUndefined()
    const code = generateCode()
    await issue(code)
    const r = await deployChain({ chain, account: user, code, client: new NodeClient(url, user), registry, onStep: () => {} })
    expect((await head(chain)).hash).toBe(r.head.hash)
    await chain.dispose()
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
    await chain.dispose()
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
    const flaky = { setDeployed: registry.setDeployed, replaceState: async (id: string, d: unknown) => { if (++calls === 1) throw new Error('disk full'); return registry.replaceState(id, d) } }
    const code = generateCode()
    await issue(code)
    const e = await deployChain({ chain, account: user, code, client: new NodeClient(url, user), registry: flaky, onStep: () => {} }).catch((x) => x)
    expect(e.message).toMatch(/^Deployed as [0-9a-f-]{36} \(http:\/\/localhost:\d+\/chains\/[0-9a-f-]{36}\), but your browser copy couldn't be matched: disk full$/)
    expect(e.step).toBe('replace')
    expect(e.chainId).toBeTruthy()
    expect(calls).toBe(2) // the rollback ran
    expect(await head(chain)).toEqual(before)
    expect((await kv.get<any>('chains', chain.info.id)).deployed).toBeUndefined()
    // a rollback that fails too is surfaced, not swallowed
    const broken = { setDeployed: registry.setDeployed, replaceState: async () => { throw new Error('gone') } }
    const code2 = generateCode()
    await issue(code2)
    const e2 = await deployChain({ chain, account: user, code: code2, client: new NodeClient(url, user), registry: broken as any, onStep: () => {} }).catch((x) => x)
    expect(e2.message).toMatch(/couldn't be matched: gone; putting your browser copy back failed too: gone$/)
    await chain.dispose()
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
  expect(html).toContain('Your deployed chains')
  expect([expiresIn(100, 200), expiresIn(500, 200), expiresIn(200 + 7200, 200), expiresIn(200 + 2 * 86400, 200)]).toEqual(['expired', '5 min', '2 h', '2 days'])
})
