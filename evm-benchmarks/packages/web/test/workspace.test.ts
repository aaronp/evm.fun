import { describe, test, expect } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { bookSchema, memoryStore, priceKey } from '@evmb/orderbook'
import { createKv, kv as appKv, type Kv } from '../src/store/kv'
import { ACCOUNTS_KEY, type Account } from '../src/store/accounts'
import { createChainRegistry, LIVE_MAX } from '../src/chain/registry'
import { createSnapshotStore } from '../src/chain/snapshots'
import { createContractsRegistry } from '../src/contracts/registry'
import { createWebAssets } from '../src/assets/registry'
import { ACTIVE_WALKTHROUGH, RUNS, SELECTED_CHAIN, buildWorkspace, encodeWorkspace, saveWorkspace } from '../src/workspace/build'
import { clearWorkspace } from '../src/workspace/clear'
import { NOT_KEEPING, loadWorkspace, newWorkspace, openWorkspace, selectionHash } from '../src/workspace/load'
import { syncDecision } from '../src/links'
import { checks, done, newRun, perform, record } from '../src/walkthrough/run'
import type { Run } from '../src/walkthrough/types'
import { validateWorkspace } from '../src/workspace/validate'
import type { WorkspaceFile } from '../src/workspace/types'
import { bundled } from '../walkthroughs'
import { encodeFunctionData } from 'viem'
import { AssetToken } from '@evmb/contracts'
import { claimCall, hashOf, lockCall, newSecret, readLock } from '@evmb/htlc'
import { createAnswers, createSecrets } from '../src/htlc/secrets'
import { deployContract } from '../src/swap/locate'
import { deployHashLock } from '../src/htlc/locate'
import { signAndSend } from '../src/tx/send'

const ENGINE = 'test-engine'
const KEY = `0x${'11'.repeat(32)}` as const
const acct = { label: 'alice', address: privateKeyToAccount(KEY).address, privateKey: KEY }
const B = '0x000000000000000000000000000000000000dEaD' as const
const sign = (nonce: number) => privateKeyToAccount(KEY).signTransaction({
  type: 'eip1559', chainId: 31337, nonce, to: B, value: 1n, gas: 21_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
})
const rec = { address: `0x${'12'.repeat(20)}` as const, name: 'Swap', abi: [], deployer: acct.address, txHash: `0x${'34'.repeat(32)}` as const }

function env(base: Kv = createKv()) {
  // kv as on a persistent browser (Bun has no IndexedDB, so a real kv is memory-only); `disk.kept = false` = it dropped to memory
  const disk = { kept: true }
  const kv: Kv = Object.create(base, { persistent: { get: () => disk.kept } })
  const stores = new Map<string, any>()
  const registry = createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
    purge: async (id: string) => void stores.delete(id),
  })
  const local = new Map<string, string>()
  const book = memoryStore(bookSchema)
  local.set(ACCOUNTS_KEY, JSON.stringify([acct]))
  const storage = { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k) }
  // accounts as the app keeps them: in storage (the app reloads after New/Open, and the accounts module re-reads it)
  const ws = { registry, kv, get accounts(): Account[] { return JSON.parse(local.get(ACCOUNTS_KEY) ?? '[]') }, book, storage, engine: ENGINE }
  const disposeAll = async () => { for (const c of await registry.list()) await registry.peek(c.id)?.dispose() }
  return { kv, disk, registry, local, book, ws, disposeAll }
}

describe('buildWorkspace', () => {
  test('includes accounts, saved chains with ids, records, snapshots, walkthroughs, order-book rows, selection — not benchmark chains', async () => {
    const e = env()
    const a = await e.registry.create('alpha', 'plain', [acct.address])
    await a.send(await sign(0))
    const b = await e.registry.create('beta', 'sequencer', [])
    const bench = await e.registry.create('bench', 'plain', [])
    await e.kv.del('chains', bench.info.id) // as addEphemeral leaves it: live, never stored
    bench.info.ephemeral = true
    await createContractsRegistry(e.kv).add(a.info.id, rec)
    await createWebAssets(e.kv).add({ id: 'gbp', chainId: a.info.id, kind: 'erc20', address: rec.address, symbol: 'GBP', name: 'Pound', decimals: 6, origin: 'launched', mintable: true, addedAt: 'now' } as any)
    const snaps = createSnapshotStore(e.kv)
    const snap = await snaps.take(a, 'first')
    await snaps.take(bench, 'bench snap')
    const edit = { ...bundled[0]!, title: 'Edited' }
    await e.kv.set('walkthroughEdits', edit.id, edit)
    const run = { walkthrough: edit.id, started: 'now', edited: true, values: {}, steps: {} }
    await e.kv.set('walkthroughRuns', edit.id, run)
    e.local.set('evmb.walkthrough.active', edit.id)
    e.local.set('evmb.selectedChain', b.info.id)
    e.local.set('evmb.theme', 'dark') // per-browser: never in the file
    const order = {
      id: `0x${'01'.repeat(32)}`, scope: a.info.id, venue: rec.address, owner: acct.address, base: B, quote: rec.address, side: 'sell',
      priceKey: priceKey('sell', 5n), seq: 1, price: 5n, amount: 7n, sig: '0x12', time: 'now',
      order: { maker: acct.address, base: B, quote: rec.address, side: 1, price: 5n, amount: 7n, nonce: 1n, expiry: 9n },
    }
    await e.book.put('orders', 'o1', order)
    await e.book.put('meta', 'seq', 1)

    const f = await buildWorkspace({ ...e.ws, account: acct.address })
    expect(f.format).toBe('evm.fun/workspace')
    expect(f.version).toBe(1)
    expect(f.engine).toBe(ENGINE)
    expect(f.accounts).toEqual([acct])
    expect(f.chains.map(c => [c.id, c.chain.name, c.chain.type])).toEqual([[a.info.id, 'alpha', 'plain'], [b.info.id, 'beta', 'sequencer']])
    const fa = f.chains[0]!
    expect(fa.format).toBe('evm.fun/chain')
    expect(fa.contracts.map(c => c.address)).toEqual([rec.address])
    expect(fa.assets?.map(x => x.symbol)).toEqual(['GBP'])
    expect(f.snapshots.map(s => s.id)).toEqual([snap.id])
    expect(f.walkthroughs.edits).toEqual([edit])
    expect(f.walkthroughs.runs).toEqual([run])
    expect(f.activeWalkthrough).toBe(edit.id)
    expect(f.selection).toEqual({ chain: b.info.id, account: acct.address })
    expect(f.orderbook).toContainEqual({ table: 'orders', key: 'o1', value: order })
    expect(f.orderbook).toContainEqual({ table: 'meta', key: 'seq', value: 1 })
    expect(JSON.stringify(f, (_k, v) => typeof v === 'bigint' ? String(v) : v)).not.toContain('evmb.theme')

    // the encoded file validates and the chain's state survives (1 block, bigint price kept)
    const text = encodeWorkspace(f)
    const r = validateWorkspace(text, { engine: ENGINE, crossEngineOk: false })
    if (!('ok' in r)) throw new Error(r.errors.join('\n'))
    expect(r.ok.chains[0]!.id).toBe(a.info.id)
    expect((r.ok.orderbook.find(x => x.key === 'o1')!.value as any).price).toBe(5n)
    expect(r.ok.chains[0]!.dump).toEqual(fa.dump)
    await e.disposeAll()
  })

  test(`${LIVE_MAX + 1} chains build one at a time; live chains stay live, closed ones stay closed`, async () => {
    const e = env()
    const ids: string[] = []
    for (let i = 0; i <= LIVE_MAX; i++) {
      const h = await e.registry.create('c' + i, 'plain', [])
      ids.push(h.info.id)
      if (i < 3) await e.registry.close(h.info.id) // three closed, six live
    }
    expect(e.registry.liveCount()).toBe(LIVE_MAX - 2)
    const f = await buildWorkspace(e.ws)
    expect(f.chains.map(c => c.id)).toEqual(ids)
    expect(e.registry.liveCount()).toBe(LIVE_MAX - 2)
    expect(ids.map(id => !!e.registry.peek(id))).toEqual(ids.map((_, i) => i >= 3))
    await e.disposeAll()
  })
})

describe('buildWorkspace at the cap and during an open', () => {
  test(`${LIVE_MAX} live chains + a saved one: build succeeds and exactly the original ${LIVE_MAX} stay live`, async () => {
    const e = env()
    const closed = await e.registry.create('closed', 'plain', [acct.address])
    await closed.send(await sign(0))
    await e.registry.close(closed.info.id)
    const liveIds: string[] = []
    for (let i = 0; i < LIVE_MAX; i++) liveIds.push((await e.registry.create('c' + i, 'plain', [])).info.id)
    const f = await buildWorkspace(e.ws)
    expect(f.chains.map(c => c.id)).toEqual([closed.info.id, ...liveIds])
    expect((f.chains[0]!.dump as any).blocks.length).toBeGreaterThan(1) // the closed chain's real state
    expect(e.registry.liveCount()).toBe(LIVE_MAX)
    expect(liveIds.every(id => e.registry.peek(id))).toBe(true)
    expect(e.registry.peek(closed.info.id)).toBeUndefined()
    await expect(e.registry.open(closed.info.id)).rejects.toThrow(/already running/) // normal opens keep the cap
    await e.disposeAll()
  })

  test('a chain the app is opening while build runs stays live', async () => {
    const e = env()
    const h = await e.registry.create('c', 'plain', [])
    await e.registry.close(h.info.id)
    const opening = e.registry.open(h.info.id) // app-style open, not awaited
    const [f, opened] = await Promise.all([buildWorkspace(e.ws), opening])
    expect(f.chains.map(c => c.id)).toEqual([h.info.id])
    expect(e.registry.peek(h.info.id)).toBe(opened)
    expect(Number(BigInt(await opened.request('eth_blockNumber') as string))).toBe(0) // not disposed
    await e.disposeAll()
  })

  test('an app open a few microtasks after withChain starts never runs a second node beside fn', async () => {
    const e = env()
    const h = await e.registry.create('c', 'plain', [])
    await e.registry.close(h.info.id)
    const id = h.info.id
    for (let ticks = 0; ticks < 12; ticks++) {
      let seen: unknown = 'unset', node: unknown
      const w = e.registry.withChain(id, async t => {
        node = t
        await new Promise(r => setTimeout(r, 5)) // long enough for a racing open to finish building
        seen = e.registry.peek(id)
      })
      for (let i = 0; i < ticks; i++) await Promise.resolve()
      const o = e.registry.open(id)
      await Promise.all([w, o])
      expect([ticks, seen === undefined || seen === node]).toEqual([ticks, true])
      await e.registry.close(id)
    }
    await e.disposeAll()
  })

  test('an open that starts during a transient dump waits for it and gets its own live node', async () => {
    const e = env()
    const h = await e.registry.create('c', 'plain', [])
    await e.registry.close(h.info.id)
    let during: Promise<unknown> | undefined
    await e.registry.withChain(h.info.id, async t => {
      during = e.registry.open(h.info.id)
      await new Promise(r => setTimeout(r, 5))
      expect(e.registry.peek(h.info.id)).toBeUndefined() // still waiting for the transient
      return t.approach.snapshot!()
    })
    const opened = await during
    expect(e.registry.peek(h.info.id)).toBe(opened as any)
    await e.disposeAll()
  })
})

describe('registry', () => {
  test('close disposes a live chain without deleting it; it opens again with its state', async () => {
    const e = env()
    const h = await e.registry.create('c', 'plain', [acct.address])
    await h.send(await sign(0))
    await e.registry.close(h.info.id)
    expect(e.registry.peek(h.info.id)).toBeUndefined()
    expect((await e.registry.list()).map(c => c.id)).toEqual([h.info.id])
    const again = await e.registry.open(h.info.id)
    expect(again).not.toBe(h)
    expect(Number(BigInt(await again.request('eth_blockNumber') as string))).toBe(1)
    await e.registry.close('missing') // no-op
    await e.disposeAll()
  })

  test('createFrom keeps a given id, and refuses one that exists without touching it', async () => {
    const e = env()
    const h = await e.registry.create('c', 'plain', [])
    const dump = await h.approach.snapshot!()
    const source = { kind: 'import', fileName: 'w.json', height: 0 } as const
    const kept = await e.registry.createFrom(dump, { name: 'k', type: 'plain', contracts: [rec], source, id: 'kept-id' })
    expect(kept.info.id).toBe('kept-id')
    expect(await e.kv.get('chains', 'kept-id')).toBeDefined()
    await expect(e.registry.createFrom(dump, { name: 'x', type: 'plain', contracts: [], source, id: h.info.id })).rejects.toThrow(/already exists/)
    expect(e.registry.peek(h.info.id)).toBe(h)
    expect((await e.registry.list()).map(c => c.name)).toEqual(['c', 'k'])
    const fresh = await e.registry.createFrom(dump, { name: 'f', type: 'plain', contracts: [], source })
    expect(fresh.info.id).not.toBe('kept-id')
    await e.disposeAll()
  })
})

describe('validateWorkspace', () => {
  const opts = { engine: ENGINE, crossEngineOk: false }
  let base: WorkspaceFile | undefined
  const good = async () => {
    if (base) return structuredClone(base)
    const e = env()
    const h = await e.registry.create('alpha', 'plain', [])
    await createSnapshotStore(e.kv).take(h)
    await e.kv.set('walkthroughEdits', bundled[0]!.id, bundled[0])
    base = await buildWorkspace(e.ws)
    await e.disposeAll()
    return structuredClone(base)
  }
  const errs = (f: unknown) => {
    const r = validateWorkspace(typeof f === 'string' ? f : encodeWorkspace(f as WorkspaceFile), opts)
    return 'errors' in r ? r.errors : []
  }

  test('a built file is ok', async () => {
    expect(errs(await good())).toEqual([])
  })

  test('refuses a bad envelope', async () => {
    expect(errs('{')[0]).toMatch(/JSON/)
    expect(errs('[]')[0]).toMatch(/object/)
    expect(errs({ ...(await good()), format: 'evm.fun/chain' })[0]).toMatch(/format/)
    expect(errs({ ...(await good()), version: 2 })[0]).toMatch(/newer/)
    expect(errs({ ...(await good()), accounts: 'x' })[0]).toMatch(/accounts/)
    expect(errs({ ...(await good()), orderbook: [1] })[0]).toMatch(/orderbook\[0\]/)
    expect(errs({ ...(await good()), walkthroughs: { edits: [], runs: [null] } })[0]).toMatch(/runs\[0\]/)
    expect(errs({ ...(await good()), selection: { chain: 'nope' } })[0]).toMatch(/selection/)
  })

  test('refuses bad accounts: label, hex, key ↔ address', async () => {
    const f = await good()
    expect(errs({ ...f, accounts: [{ ...acct, label: 'x'.repeat(201) }] })[0]).toMatch(/accounts\[0\]\.label/)
    expect(errs({ ...f, accounts: [{ ...acct, privateKey: '0x12' }] })[0]).toMatch(/accounts\[0\]\.privateKey/)
    expect(errs({ ...f, accounts: [{ ...acct, address: B }] })[0]).toMatch(/does not match/)
    expect(errs({ ...f, accounts: [acct, acct] })[0]).toMatch(/duplicate/i)
  })

  test('refuses a bad chain with a message naming it', async () => {
    const f = await good()
    f.chains[0]!.dump = { nope: 1 }
    expect(errs(f)[0]).toMatch(/^Chain "alpha": Invalid dump/)
    const g = await good()
    g.chains.push({ ...g.chains[0]!, chain: { name: 'twin', type: 'plain' } })
    expect(errs(g).join()).toMatch(/duplicate chain id/i)
    const h = await good()
    h.chains[0]!.id = '../x'
    expect(errs(h)[0]).toMatch(/id/)
    const k = await good()
    k.engine = 'other'
    k.chains[0]!.engine = 'other'
    expect(errs(k).join()).toMatch(/Engine mismatch/)
  })

  test('refuses runs the wizard could not read', async () => {
    const run = { walkthrough: 'w', started: 'now', edited: false, values: { k: { address: B } }, steps: { s1: { inputs: {}, outputs: {}, at: 'now' } } }
    const f = await good()
    expect(errs({ ...f, walkthroughs: { edits: [], runs: [run] } })).toEqual([])
    for (const bad of [{ steps: undefined }, { values: [] }, { started: 1 }, { edited: 'no' }, { steps: { s1: null } }, { steps: { s1: { at: 'x' } } }, { steps: { s1: { inputs: {}, at: 'now' } } }])
      expect(errs({ ...f, walkthroughs: { edits: [], runs: [{ ...run, ...bad }] } })[0]).toMatch(/walkthroughs\.runs\[0\]/)
  })

  test('order-book rows: real orders/attempts/meta pass; rows missing what the indexes and UI read are refused', async () => {
    const A = acct.address, V = `0x${'ab'.repeat(20)}`
    const order = {
      id: `0x${'01'.repeat(32)}`, scope: 'chain-1', venue: V, owner: A, base: B, quote: V, side: 'sell', priceKey: priceKey('sell', 5n),
      seq: 1, price: 5n, amount: 10n, order: { maker: A, base: B, quote: V, side: 1, price: 5n, amount: 10n, nonce: 1n, expiry: 9n },
      sig: '0x1234', time: 'now',
    }
    const attempt = { scope: 'chain-1', venue: V, owner: A, seq: 1, time: 'now', input: {}, status: 'success', tx: `0x${'02'.repeat(32)}`, block: 3n }
    const rows = (o: unknown, a: unknown = attempt, m: unknown = 1) =>
      [{ table: 'orders', key: 'k', value: o }, { table: 'attempts', key: 'a', value: a }, { table: 'meta', key: 'orders:x', value: m }]
    const f = await good()
    expect(errs({ ...f, orderbook: rows(order) })).toEqual([])
    expect(errs({ ...f, orderbook: rows({ ...order, closed: { filled: 2n, cancelled: true } }) })).toEqual([])
    for (const bad of [{ scope: 1 }, { venue: 'x' }, { side: 'up' }, { priceKey: priceKey('sell', 6n) }, { price: 5 }, { amount: '10' }, { seq: 1.5 },
      { order: { ...order.order, nonce: 1 } }, { closed: { filled: 1 } }, { base: undefined }])
      expect(errs({ ...f, orderbook: rows({ ...order, ...bad }) })[0]).toMatch(/orderbook\[0\]/)
    for (const bad of [{ status: 'odd' }, { owner: 'x' }, { block: 3 }, { seq: -1 }, { scope: undefined }])
      expect(errs({ ...f, orderbook: rows(order, { ...attempt, ...bad }) })[0]).toMatch(/orderbook\[1\]/)
    expect(errs({ ...f, orderbook: rows(order, attempt, 'x') })[0]).toMatch(/orderbook\[2\]/)
  })

  test('refuses snapshots of chains not in the file, bad snapshot dumps, and invalid walkthrough edits', async () => {
    const f = await good()
    f.snapshots[0]!.chainId = 'other'
    expect(errs(f)[0]).toMatch(/snapshots\[0\].*not in this file/)
    const g = await good()
    g.snapshots[0]!.dump = 1
    expect(errs(g)[0]).toMatch(/snapshots\[0\]/)
    const h = await good()
    h.walkthroughs.edits = [{ ...bundled[0]!, steps: 'x' } as any]
    expect(errs(h)[0]).toMatch(/walkthroughs\.edits\[0\]/)
  })

  test('secrets: an older file without them is ok (none); a secret under the wrong hash or malformed hex refuses the file', async () => {
    const f = await good()
    expect(f.secrets).toEqual([])
    const { secrets: _, ...older } = f
    const r = validateWorkspace(encodeWorkspace(older as WorkspaceFile), opts)
    expect('ok' in r && r.ok.secrets).toEqual([])
    const secret = newSecret(), entry = { hash: hashOf(secret), secret, chain: f.chains[0]!.id, lockId: '1' }
    expect(errs({ ...f, secrets: [entry, { ...entry, lockId: '' }] })).toEqual([])
    expect(errs({ ...f, secrets: [{ ...entry, hash: hashOf(newSecret()) }] })[0]).toMatch(/secrets\[0\]/)
    for (const bad of [{ secret: '0x12' }, { hash: '0xzz' }, { secret: 7 }, { chain: 1 }, { chain: '' }, { chain: 'a/b' }, { chain: 'x'.repeat(101) }, { lockId: '01' }, { lockId: 'x' }, { lockId: 1 }])
      expect(errs({ ...f, secrets: [entry, { ...entry, ...bad }] })[0]).toMatch(/secrets\[1\]/)
    expect(errs({ ...f, secrets: {} })[0]).toMatch(/secrets/)
  })

  test('answers (A\'s head when B answered): absent = none; malformed rows refuse the file', async () => {
    const f = await good()
    expect(f.answers).toEqual([])
    const { answers: _, ...older } = f
    const r = validateWorkspace(encodeWorkspace(older as WorkspaceFile), opts)
    expect('ok' in r && r.ok.answers).toEqual([])
    const entry = { hash: hashOf(newSecret()), headA: '42' }
    expect(errs({ ...f, answers: [entry, { ...entry, headA: '0' }] })).toEqual([])
    for (const bad of [{ hash: '0x12' }, { headA: 42 }, { headA: '042' }, { headA: '-1' }, { headA: '' }])
      expect(errs({ ...f, answers: [entry, { ...entry, ...bad }] })[0]).toMatch(/answers\[1\]/)
    expect(errs({ ...f, answers: {} })[0]).toMatch(/answers/)
  })
})

/** A file compared as data: the save/export times differ by design. */
const same = (f: WorkspaceFile) => JSON.parse(encodeWorkspace({ ...f, savedAt: '', chains: f.chains.map(c => ({ ...c, exportedAt: '' })) }))
const PER_BROWSER = { 'evmb.theme': 'dark', 'evmb.explorerView': 'list', 'evmb.fisheye': '{"on":true}', 'evmb.walkthrough.layout': 'vertical', 'evmb.walkthrough.focus': '1', 'evmb.notice.workspaceKeys': '1' }
const valid = (text: string) => {
  const r = validateWorkspace(text, { engine: ENGINE, crossEngineOk: false })
  if (!('ok' in r)) throw new Error(r.errors.join('\n'))
  return r.ok
}
/** Every workspace part is empty (per-browser keys are not part of it). */
async function expectEmpty(e: ReturnType<typeof env>) {
  expect(await e.registry.list()).toEqual([])
  expect(e.registry.liveCount()).toBe(0)
  expect(await e.kv.list('snapshots')).toEqual([])
  expect(await e.kv.list('walkthroughEdits')).toEqual([])
  expect(await e.kv.list(RUNS)).toEqual([])
  expect(await createSecrets(e.kv).all()).toEqual([])
  for (const t of Object.keys(bookSchema)) expect(await e.book.entries(t)).toEqual([])
  for (const k of [ACCOUNTS_KEY, SELECTED_CHAIN, ACTIVE_WALKTHROUGH]) expect(e.local.get(k)).toBeUndefined()
}
/** Two saved chains with a tx, records, a snapshot, an edit, a run, a book row; the second selected. */
async function populated(e: ReturnType<typeof env>, names = ['x', 'y']) {
  const hs = []
  for (const n of names) hs.push(await e.registry.create(n, 'plain', [acct.address]))
  await hs[0]!.send(await sign(0))
  await createContractsRegistry(e.kv).add(hs[0]!.info.id, rec)
  await createSnapshotStore(e.kv).take(hs[0]!, 'snap')
  await e.kv.set('walkthroughEdits', bundled[0]!.id, { ...bundled[0]!, title: 'Mine' })
  await e.kv.set(RUNS, bundled[0]!.id, { walkthrough: bundled[0]!.id, started: 'now', edited: true, values: {}, steps: {} })
  e.local.set(ACTIVE_WALKTHROUGH, bundled[0]!.id)
  e.local.set(SELECTED_CHAIN, hs.at(-1)!.info.id)
  await e.book.put('meta', 'seq', 3)
  return hs
}

describe('New / Open / Save', () => {
  test('Review Focus 1: save → clear → load restores everything with ids; the walkthrough resumes and a ?chain= link resolves', async () => {
    const e = env(appKv) // the walkthrough runner keeps contract records in the app's kv
    const w = bundled.find(x => x.id === 'gbp-usd-book-offchain')!
    const people = {
      list: () => e.ws.accounts,
      create(label: string) {
        const k = generatePrivateKey(), a = { label, address: privateKeyToAccount(k).address, privateKey: k }
        e.local.set(ACCOUNTS_KEY, JSON.stringify([...e.ws.accounts, a]))
        return a
      },
    }
    const wenv = { accounts: people, registry: e.registry, book: e.book }
    const upto = w.steps.findIndex(s => s.id === 'ask2') + 1
    let run: Run = newRun(w)
    for (const step of w.steps.slice(0, upto)) if (!await done(w, step, wenv, run)) run = record(w, run, step, await perform(w, step, wenv, run))
    const chainId = (run.values.chain as { id: string }).id
    await e.kv.set(RUNS, w.id, run)
    e.local.set(ACTIVE_WALKTHROUGH, w.id)
    e.local.set(SELECTED_CHAIN, chainId)
    const snap = await createSnapshotStore(e.kv).take(e.registry.peek(chainId)!, 'mid-walkthrough')
    const before = await buildWorkspace({ ...e.ws, account: e.ws.accounts.at(-1)!.address })
    expect(before.orderbook.filter(r => r.table === 'orders').length).toBe(2)

    await clearWorkspace(e.ws)
    await expectEmpty(e)

    await loadWorkspace(valid(encodeWorkspace(before)), e.ws)
    expect((await e.registry.list()).map(c => c.id)).toEqual(before.chains.map(c => c.id))
    expect(same(await buildWorkspace({ ...e.ws, account: before.selection?.account }))).toEqual(same(before))
    expect((await createSnapshotStore(e.kv).list(chainId)).map(s => s.id)).toEqual([snap.id])
    expect(e.registry.peek(chainId)).toBeDefined() // the selection stays open
    // a link to the chain resolves
    const d = syncDecision({ chain: chainId }, { loading: false }, {}, { chains: (await e.registry.list()).map(c => c.id), accounts: e.ws.accounts })
    expect([d.chain, d.notices]).toEqual([chainId, []])
    // the walkthrough resumes: same active id and run, finished steps still done, and the rest runs to the end
    expect(e.local.get(ACTIVE_WALKTHROUGH)).toBe(w.id)
    let resumed = (await e.kv.get<Run>(RUNS, w.id))!
    expect(resumed).toEqual(run)
    for (const step of w.steps.slice(0, upto)) expect([step.id, await done(w, step, wenv, resumed)]).toEqual([step.id, true])
    for (const step of w.steps.slice(upto)) {
      resumed = record(w, resumed, step, await perform(w, step, wenv, resumed))
      for (const c of await checks(w, step, wenv, resumed)) expect({ step: step.id, ...c }).toMatchObject({ pass: true })
    }
    await clearWorkspace(e.ws)
  }, 60_000)

  test('Review Focus 2: a file whose third chain fails to load leaves the previous workspace exactly as it was', async () => {
    const src = env()
    const made = []
    for (const n of ['a', 'b', 'c', 'd']) made.push(await src.registry.create(n, 'plain', []))
    const bad = await buildWorkspace(src.ws)
    ;(bad.chains[2]!.dump as any).blocks = [{}] // passes the validator, fails in the engine
    const text = encodeWorkspace(bad)
    valid(text)
    await src.disposeAll()

    const e = env()
    await populated(e)
    for (const [k, v] of Object.entries(PER_BROWSER)) e.local.set(k, v)
    const before = await buildWorkspace({ ...e.ws, account: acct.address })
    const r = await openWorkspace(text, { ...e.ws, account: acct.address })
    if (!('error' in r)) throw new Error('expected a failure')
    expect(r.error).toMatch(/"c"/)
    expect(r.failedText).toBe(text)
    expect(r.restoreError).toBeUndefined()
    expect(same(valid(r.previousText!))).toEqual(same(before))
    expect((await e.registry.list()).map(c => c.name)).toEqual(['x', 'y'])
    expect(same(await buildWorkspace({ ...e.ws, account: acct.address }))).toEqual(same(before))
    for (const [k, v] of Object.entries(PER_BROWSER)) expect(e.local.get(k)).toBe(v)
    await e.disposeAll()
  })

  test('a restore that fails too is reported, never thrown', async () => {
    const e = env()
    await populated(e)
    const other = env()
    await other.registry.create('z', 'plain', [])
    const text = encodeWorkspace(await buildWorkspace(other.ws))
    await other.disposeAll()
    e.registry.createFrom = async () => { throw new Error('disk full') }
    const r = await openWorkspace(text, e.ws)
    expect(r).toMatchObject({ error: expect.stringMatching(/disk full/), restoreError: expect.stringMatching(/disk full/), failedText: text })
    await e.disposeAll()
  })

  test('an invalid file is refused before anything changes', async () => {
    const e = env()
    await populated(e)
    const before = await buildWorkspace(e.ws)
    const r = await openWorkspace('{"format":"nope"}', e.ws)
    expect('errors' in r && r.errors.length > 0).toBe(true)
    expect(same(await buildWorkspace(e.ws))).toEqual(same(before))
    await e.disposeAll()
  })

  test(`Review Focus 3: a file with ${LIVE_MAX + 1} chains opens one at a time; only the selection stays live`, async () => {
    const src = env()
    for (let i = 0; i <= LIVE_MAX; i++) await src.registry.close((await src.registry.create('c' + i, 'plain', [])).info.id)
    const ids = (await src.registry.list()).map(c => c.id)
    src.local.set(SELECTED_CHAIN, ids[4]!)
    const f = await buildWorkspace(src.ws)
    await src.disposeAll()

    const e = env()
    await populated(e)
    const r = await openWorkspace(encodeWorkspace(f), e.ws)
    expect(r).toEqual({ ok: true })
    expect((await e.registry.list()).map(c => c.id)).toEqual(ids)
    expect(e.registry.liveCount()).toBe(1)
    expect(e.registry.peek(ids[4]!)).toBeDefined()
    expect(e.local.get(SELECTED_CHAIN)).toBe(ids[4])
    expect(same(await buildWorkspace(e.ws))).toEqual(same(f))
    await e.disposeAll()
  })

  test('Review Focus 5: per-browser keys are untouched by New and Open', async () => {
    const e = env()
    await populated(e)
    for (const [k, v] of Object.entries(PER_BROWSER)) e.local.set(k, v)
    const f = await buildWorkspace(e.ws)
    for (const k of Object.keys(PER_BROWSER)) expect(encodeWorkspace(f)).not.toContain(k)
    expect(await newWorkspace(e.ws)).toEqual({ ok: true })
    await expectEmpty(e)
    for (const [k, v] of Object.entries(PER_BROWSER)) expect(e.local.get(k)).toBe(v)
    expect(await openWorkspace(encodeWorkspace(f), e.ws)).toEqual({ ok: true })
    for (const [k, v] of Object.entries(PER_BROWSER)) expect(e.local.get(k)).toBe(v)
    await e.disposeAll()
  })

  test('xswap Review Focus 5: Save → New → Open keeps a secret and its lock; the maker can still claim', async () => {
    const e = env()
    const [h] = await populated(e, ['a'])
    const token = await deployContract(h!, acct, 'GBP', AssetToken, undefined, ['GBP', 'GBP', 2, 1000n, acct.address])
    const lock = await deployHashLock(h!, acct)
    await signAndSend(h!, acct, { to: token, data: encodeFunctionData({ abi: AssetToken.abi, functionName: 'approve', args: [lock, 100n] }) })
    const secret = newSecret(), hash = hashOf(secret), headNow = BigInt((await h!.request('eth_blockNumber', [])) as string)
    await createSecrets(e.kv).put(hash, { secret, chain: h!.info.id, lockId: '' })
    expect((await signAndSend(h!, acct, lockCall(lock, { token, amount: 100n, recipient: acct.address, hash, timeoutBlock: headNow + 100n }))).status).toBe('success')
    await createSecrets(e.kv).put(hash, { secret, chain: h!.info.id, lockId: '1' })
    await createAnswers(e.kv).put(hash, 7n)
    const { text } = await saveWorkspace(e.ws)
    expect(valid(text).secrets).toEqual([{ hash, secret, chain: h!.info.id, lockId: '1' }])
    expect(valid(text).answers).toEqual([{ hash, headA: '7' }])
    expect(await newWorkspace(e.ws)).toEqual({ ok: true })
    await expectEmpty(e)
    expect(await openWorkspace(text, e.ws)).toEqual({ ok: true })
    const kept = (await createSecrets(e.kv).get(hash))!
    expect(kept).toEqual({ secret, chain: h!.info.id, lockId: '1' })
    expect(await createAnswers(e.kv).get(hash)).toBe('7')
    const c = await e.registry.open(kept.chain)
    expect((await readLock((m, p) => c.request(m, p), lock, BigInt(kept.lockId))).status).toBe('locked')
    expect((await signAndSend(c, acct, claimCall(lock, BigInt(kept.lockId), kept.secret))).status).toBe('success')
    await e.disposeAll()
  }, 30_000)

  test('benchmark chains are cleared too', async () => {
    const e = env()
    const bench = await e.registry.create('bench', 'plain', [])
    await e.kv.del('chains', bench.info.id)
    bench.info.ephemeral = true
    await createSnapshotStore(e.kv).take(bench)
    await clearWorkspace(e.ws)
    await expectEmpty(e)
    expect(await bench.request('eth_blockNumber').then(() => 'alive', () => 'disposed')).toBe('disposed')
  })

  test('"Save first" downloads the same file Save does, then New clears / Open replaces', async () => {
    const e = env()
    await populated(e)
    const saved = await saveWorkspace(e.ws)
    expect(saved.name).toMatch(/^workspace-\d{4}-\d{2}-\d{2}\.json$/)
    const got: { name: string; text: string }[] = []
    expect(await newWorkspace(e.ws, { download: x => void got.push(x) })).toEqual({ ok: true })
    expect(got.map(g => g.name)).toEqual([saved.name])
    expect(same(valid(got[0]!.text))).toEqual(same(valid(saved.text)))
    await expectEmpty(e)

    expect(await openWorkspace(saved.text, e.ws)).toEqual({ ok: true }) // back to the saved one
    const other = env()
    await other.registry.create('z', 'plain', [])
    const text = encodeWorkspace(await buildWorkspace(other.ws))
    await other.disposeAll()
    expect(await openWorkspace(text, e.ws, { download: x => void got.push(x) })).toEqual({ ok: true })
    expect(same(valid(got[1]!.text))).toEqual(same(valid(saved.text)))
    expect((await e.registry.list()).map(c => c.name)).toEqual(['z'])
    await e.disposeAll()
  })

  test('a failure while saving reads as a Save error', async () => {
    const e = env()
    const h = await e.registry.create('x', 'plain', [])
    await e.registry.close(h.info.id)
    e.registry.withChain = async () => { throw new Error('8 chains are already running') }
    await expect(saveWorkspace(e.ws)).rejects.toThrow("Couldn't save: 8 chains are already running")
    await e.disposeAll()
  })

  test('a snapshot taken before assets were kept saves with assets: [] and the file opens', async () => {
    const e = env()
    await populated(e)
    const snaps = createSnapshotStore(e.kv)
    const [s] = await snaps.list((await e.registry.list())[0]!.id)
    const { assets: _, ...legacy } = s!
    await snaps.put(legacy as any)
    const f = valid((await saveWorkspace(e.ws)).text)
    expect(f.snapshots[0]!.assets).toEqual([])
    await e.disposeAll()
  })

  test("Save refuses a file Open would refuse (a legacy run), naming why", async () => {
    const e = env()
    await e.kv.set(RUNS, 'old', { walkthrough: 'old' })
    await expect(saveWorkspace(e.ws)).rejects.toThrow(/^Couldn't save: the file wouldn't open: walkthroughs\.runs\[0\]/)
    await e.disposeAll()
  })

  test('New and Open re-check busy right before clearing: refused with the reason, nothing changed', async () => {
    const e = env()
    await populated(e)
    const before = await buildWorkspace(e.ws)
    const busy = () => 'A walkthrough is installing'
    expect(await newWorkspace(e.ws, { busy })).toEqual({ error: 'A walkthrough is installing: nothing was cleared. Try again when it finishes.' })
    expect(await openWorkspace(encodeWorkspace(before), e.ws, { busy })).toEqual({ error: 'A walkthrough is installing: nothing was changed. Try again when it finishes.' })
    expect(same(await buildWorkspace(e.ws))).toEqual(same(before))
    await e.disposeAll()
  })

  test('Open keeps the chain list order and heights', async () => {
    const src = env()
    const hs = await populated(src, ['c', 'a', 'b'])
    const text = (await saveWorkspace(src.ws)).text
    const heights = await Promise.all(hs.map(async h => Number(BigInt(await h.request('eth_blockNumber', []) as string))))
    await src.disposeAll()
    const e = env()
    expect(await openWorkspace(text, e.ws)).toEqual({ ok: true })
    const list = await e.registry.list()
    expect(list.map(c => c.name)).toEqual(['c', 'a', 'b'])
    expect(list.map(c => c.lastHeight)).toEqual(heights)
    expect(heights[0]).toBeGreaterThan(0)
    await e.disposeAll()
  })

  test("a chain's source from the file is rebuilt with only its known fields", async () => {
    const src = env()
    await src.registry.create('x', 'plain', [])
    const f = await buildWorkspace(src.ws)
    await src.disposeAll()
    f.chains[0]!.source = { kind: 'import', fileName: 'x.json', height: 0, extra: '<b>' } as any
    const e = env()
    expect(await openWorkspace(encodeWorkspace(f), e.ws)).toEqual({ ok: true })
    expect((await e.registry.list())[0]!.source).toEqual({ kind: 'import', fileName: 'x.json', height: 0 })
    await e.disposeAll()
  })

  test('New and Open are refused up front when this browser keeps nothing; nothing changes', async () => {
    const e = env()
    await populated(e)
    const before = await buildWorkspace(e.ws)
    e.disk.kept = false
    expect(await newWorkspace(e.ws)).toEqual({ error: NOT_KEEPING })
    expect(await openWorkspace(encodeWorkspace(before), e.ws)).toEqual({ error: NOT_KEEPING })
    expect(same(await buildWorkspace(e.ws))).toEqual(same(before))
    e.disk.kept = true
    const ws = { ...e.ws, book: Object.assign(Object.create(e.book), { persistent: false }) } // the order book fell back to memory
    expect(await newWorkspace(ws)).toEqual({ error: NOT_KEEPING })
    expect(same(await buildWorkspace(e.ws))).toEqual(same(before))
    await e.disposeAll()
  })

  test('kv dropping to memory part-way through an Open is a failure offering both downloads, never {ok}', async () => {
    const other = env()
    for (const n of ['a', 'b', 'c']) await other.registry.create(n, 'plain', [])
    const text = encodeWorkspace(await buildWorkspace(other.ws))
    await other.disposeAll()
    const e = env()
    await populated(e)
    const before = await buildWorkspace({ ...e.ws, account: acct.address })
    const set = e.kv.set
    let n = 0
    e.kv.set = (...a) => { if (++n === 3) e.disk.kept = false; return set(...a) } // the write "succeeds" — in memory
    const r = await openWorkspace(text, { ...e.ws, account: acct.address })
    if (!('error' in r)) throw new Error('expected a failure')
    expect(r.error).toMatch(/stopped keeping data/)
    expect(r.failedText).toBe(text)
    expect(same(valid(r.previousText!))).toEqual(same(before))
    expect(r.restoreError).toMatch(/stopped keeping data/) // restored into memory only: the download is the way back
    // New the same way
    const e2 = env()
    await populated(e2)
    e2.registry.remove = async () => { e2.disk.kept = false } // the clear "succeeds" in memory
    const r2 = await newWorkspace(e2.ws)
    expect(r2).toMatchObject({ error: expect.stringMatching(/stopped keeping data/), previousText: expect.any(String) })
    await e.disposeAll(); await e2.disposeAll()
  })

  test('clear removes the storage keys first; a best-effort clear carries on past errors; orphan records go too', async () => {
    const e = env()
    const [x, y] = await populated(e)
    await createContractsRegistry(e.kv).add('gone-chain', rec) // records of a chain no longer stored
    const remove = e.registry.remove
    e.registry.remove = async id => { if (id === x!.info.id) throw new Error('locked'); return remove(id) }
    await expect(clearWorkspace(e.ws)).rejects.toThrow('locked')
    expect(e.local.get(ACCOUNTS_KEY)).toBeUndefined() // the storage keys went before any chain
    expect(e.registry.peek(y!.info.id)).toBeDefined() // nothing after the failure
    await clearWorkspace(e.ws, { bestEffort: true })
    expect(e.registry.peek(y!.info.id)).toBeUndefined() // carried on past x
    expect(e.registry.peek(x!.info.id)).toBeUndefined() // the failing one is closed instead, so its id can load again
    expect(await e.registry.list()).toEqual([]) // and its rows went with the rest of kv
    expect(await createContractsRegistry(e.kv).list('gone-chain')).toEqual([])
    expect(await e.kv.list('snapshots')).toEqual([])
    e.registry.remove = remove
    await e.disposeAll()
  })

  test("a chain whose dispose throws doesn't block the restore: the previous workspace loads fully", async () => {
    const other = env()
    await other.registry.create('z', 'plain', [])
    const text = encodeWorkspace(await buildWorkspace(other.ws))
    await other.disposeAll()
    const e = env()
    const [, y] = await populated(e)
    const before = await buildWorkspace({ ...e.ws, account: acct.address })
    const dispose = y!.dispose.bind(y)
    y!.dispose = async () => { throw new Error('stuck') }
    const r = await openWorkspace(text, { ...e.ws, account: acct.address })
    expect(r).toMatchObject({ error: expect.stringMatching(/stuck/) })
    expect((r as { restoreError?: string }).restoreError).toBeUndefined()
    expect(same(await buildWorkspace({ ...e.ws, account: acct.address }))).toEqual(same(before))
    await e.disposeAll()
    await dispose()
  })

  test('after Open the address carries the loaded selection, not a stale ?chain=', () => {
    const accounts = [acct]
    expect(selectionHash('#/swap?chain=old&as=bob&x=1', { chain: 'new', account: acct.address }, accounts)).toBe('#/swap?chain=new&as=alice')
    expect(selectionHash('#/assets?asset=gbp&chain=old', { chain: 'new' }, accounts)).toBe('#/assets?chain=new') // the old workspace's details go
    expect(selectionHash('#/chains/tx/0xabc', undefined, accounts)).toBe('#/chains')
    expect(selectionHash('#/swap?chain=old&as=bob', undefined, accounts)).toBe('#/swap')
    expect(selectionHash('', { chain: 'c' }, accounts)).toBe('#/?chain=c')
  })
})
