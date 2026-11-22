import { describe, test, expect } from 'bun:test'
import { readdirSync } from 'node:fs'
import { erc20Abi, type Address, type Hex } from 'viem'
import { bookSchema, memoryStore } from '@evmb/orderbook'
import { kv } from '../src/store/kv'
import { createAccounts } from '../src/store/accounts'
import { createChainRegistry } from '../src/chain/registry'
import { readContract } from '../src/tx/send'
import { bundled } from '../walkthroughs'
import { validate } from '../src/walkthrough/validate'
import { amount } from '../src/walkthrough/resolve'
import { checks, done, initialInputs, newRun, perform, poolOutputs, record, venueOf, type Env } from '../src/walkthrough/run'
import { clearRun, loadRun, saveRun } from '../src/walkthrough/runs'
import type { Outputs, Run, Step, Walkthrough } from '../src/walkthrough/types'

// Contract and asset records go through the shared kv singleton, so the chain registry uses it too.
function env(): Env {
  const stores = new Map<string, any>()
  const registry = createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
  })
  // one order-book store per env, as the app has one IndexedDB: a reload (loadRun) keeps it
  return { accounts: createAccounts(), registry, book: memoryStore(bookSchema) }
}
// Chains are listed from the shared kv, so each test removes (disposes and forgets) every chain it made.
const disposeAll = async (e: Env) => { for (const c of await e.registry.list()) await e.registry.remove(c.id) }
const byId = (id: string) => bundled.find(w => w.id === id)!
const chainOf = (e: Env, run: Run) => e.registry.open((run.values.chain as Outputs['chain']).id)
const height = async (e: Env, run: Run) => Number(BigInt((await (await chainOf(e, run)).request('eth_blockNumber', [])) as string))

/** The headless runner: skip done steps, else perform and record; then the step is done and its checks pass. */
async function runSteps(w: Walkthrough, e: Env, run: Run, upto = w.steps.length): Promise<Run> {
  for (const step of w.steps.slice(0, upto)) {
    if (await done(w, step, e, run)) continue
    run = record(w, run, step, await perform(w, step, e, run))
    expect(await done(w, step, e, run)).toBe(true)
    for (const c of await checks(w, step, e, run)) expect({ step: step.id, ...c }).toMatchObject({ pass: true })
  }
  return run
}

describe('bundled walkthroughs run headless', () => {
  test('every walkthroughs/*.json is bundled (so tested)', () => {
    const files = readdirSync(new URL('../walkthroughs', import.meta.url)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort()
    expect(files).toEqual(bundled.map(w => w.id).sort())
  })
  for (const w of bundled) {
    test(w.id, async () => {
      expect('ok' in validate(w)).toBe(true)
      const e = env()
      try {
        const run = await runSteps(w, e, newRun(w))
        expect(Object.keys(run.steps)).toEqual(w.steps.map(s => s.id))
        expect(run.edited).toBe(false)
      } finally { await disposeAll(e) }
    }, 60_000)
  }

  test('take-without-approval: the take reverts with ERC20InsufficientAllowance and the offer stays Open', async () => {
    const w = byId('take-without-approval')
    const e = env()
    try {
      const run = await runSteps(w, e, newRun(w))
      expect(run.steps.take!.outputs).toMatchObject({ reverted: true, error: 'ERC20InsufficientAllowance' })
      const take = w.steps.find(s => s.id === 'take')!
      const res = await checks(w, take, e, run)
      expect(res.find(r => 'offer' in r.check)).toMatchObject({ pass: true, actual: 'Open' })
    } finally { await disposeAll(e) }
  }, 60_000)
})

describe('runner', () => {
  test('resume from a saved run repeats no transaction', async () => {
    const w = byId('gbp-usd')
    const e = env()
    try {
      let run = await runSteps(w, e, newRun(w), 6) // accounts, chain, two tokens, Swap
      await saveRun(run)
      const h0 = await height(e, run)
      run = (await loadRun(w.id))!
      expect(run.values.swap).toBeDefined()
      run = await runSteps(w, e, run) // no second deploy: only aliceOk, offer, bobOk, take send
      expect(await height(e, run) - h0).toBe(4)
      await saveRun(run)
      run = await runSteps(w, e, (await loadRun(w.id))!) // finished run: nothing repeats, even the spent approvals
      expect(await height(e, run) - h0).toBe(4)
      await clearRun(w.id)
      expect(await loadRun(w.id)).toBeUndefined()
    } finally { await disposeAll(e) }
  }, 60_000)

  test('an existing label is reused, not duplicated', async () => {
    const w = byId('gbp-usd')
    const e = env()
    const alice = e.accounts.create('alice')
    const out = await perform(w, w.steps[0]!, e, newRun(w))
    expect(out).toEqual({ label: 'alice', address: alice.address })
    expect(e.accounts.list()).toHaveLength(1)
  })

  test('chain name taken: Example 2, then Example 3, and the second run starts with no allowance', async () => {
    const w = byId('gbp-usd')
    const e = env()
    try {
      await e.registry.create('Example', 'plain', [])
      // bob's USD allowance to the run's Swap, read on the run's own chain
      const bobAllowance = async (run: Run) => readContract(await chainOf(e, run), amount(run, '1 $USD').asset.address, erc20Abi, 'allowance',
        [(run.values.bob as Outputs['account']).address, (run.values.swap as Outputs['deploySwap']).address])
      const one = await runSteps(w, e, newRun(w), 9) // through bobOk: bob's approval is unspent on run one's chain
      expect((one.values.chain as Outputs['chain']).name).toBe('Example 2')
      expect(await bobAllowance(one)).toBe(1270_000000n)
      let two = await runSteps(w, e, newRun(w), 8) // up to and including the offer
      expect((two.values.chain as Outputs['chain']).name).toBe('Example 3')
      expect((two.values.chain as Outputs['chain']).id).not.toBe((one.values.chain as Outputs['chain']).id)
      // same addresses on both chains (same deployer and nonces), so this only passes if run two reads its own chain
      expect(await bobAllowance(two)).toBe(0n)
      expect(await done(w, w.steps.find(s => s.id === 'bobOk')!, e, two)).toBe(false)
      two = await runSteps(w, e, two)
      expect(two.steps.take!.outputs).toMatchObject({ reverted: false })
    } finally { await disposeAll(e) }
  }, 60_000)

  test('initialInputs: namespaced ids, actual addresses, exact price; approve uses its before step', async () => {
    const w = byId('gbp-usd')
    const e = env()
    try {
      const run = await runSteps(w, e, newRun(w), 6)
      const step = (id: string) => w.steps.find(s => s.id === id)!
      const alice = (run.values.alice as Outputs['account']).address
      expect(initialInputs(w, step('alice'), run)).toEqual({ 'account.label': 'alice' })
      expect(initialInputs(w, step('chain'), run, ['Example'])).toEqual({ 'chain.name': 'Example 2' })
      expect(initialInputs(w, step('gbp'), run)).toEqual({
        'launch.name': 'Pound', 'launch.symbol': 'GBP', 'launch.decimals': '2', 'launch.supply': '1000000', 'launch.issuer': alice,
      })
      const offer = { 'offer.side': 'ask', 'offer.amount': '1000', 'offer.price': '1.27' }
      expect(initialInputs(w, step('offer'), run)).toEqual(offer)
      expect(initialInputs(w, step('aliceOk'), run)).toEqual(offer)
    } finally { await disposeAll(e) }
  }, 60_000)

  test('record with an edited input sets edited, and $GBP then resolves to the EUR token', () => {
    const w = byId('gbp-usd')
    let run = newRun(w)
    const alice = { label: 'alice', address: '0x00000000000000000000000000000000000000a1' as Address }
    run = record(w, run, w.steps[0]!, alice, { 'account.label': 'alice' })
    expect(run.edited).toBe(false)
    expect(run.values.alice).toEqual(alice)
    const chain = w.steps.find(s => s.id === 'chain')!
    const filled = initialInputs(w, chain, run, ['Example']) // what the ribbon filled: the suffixed name
    expect(record(w, run, chain, { id: 'c', name: 'Example 2' }, filled, filled).edited).toBe(false)
    expect(record(w, run, chain, { id: 'c', name: 'Example 2' }, filled).edited).toBe(true) // default initial is unsuffixed
    const gbp = w.steps.find(s => s.id === 'gbp')!
    const eur = { address: '0x00000000000000000000000000000000000000e0' as Address, symbol: 'EUR', name: 'Pound', decimals: 2 }
    const inputs = { ...initialInputs(w, gbp, run), 'launch.symbol': 'EUR' }
    const next = record(w, run, gbp, eur, inputs)
    expect(next.edited).toBe(true)
    expect(run.edited).toBe(false) // a new run, not a mutation
    expect(next.steps.gbp!.inputs['launch.symbol']).toBe('EUR')
    expect(amount(next, '1000 $GBP')).toEqual({ asset: eur, raw: 100000n })
  })

  test('an unresolved $name names the step and the key', async () => {
    const w = byId('gbp-usd')
    const e = env()
    await expect(perform(w, w.steps.find(s => s.id === 'chain')!, e, newRun(w))).rejects.toThrow('Step chain: $alice has no value yet')
  })
})

describe('order-book walkthroughs', () => {
  const at = (w: Walkthrough, id: string) => w.steps.findIndex(s => s.id === id)
  const aliceOrders = async (e: Env, run: Run) => {
    const v = await venueOf(await chainOf(e, run), run.values.book as Outputs['deployVenue'], e.book!)
    return v.orders({ owner: (run.values.alice as Outputs['account']).address })
  }

  for (const kind of ['onchain', 'offchain'] as const) {
    test(`${kind}: outputs, then Review Focus 5 — reloaded after Alice's first order, the run finishes without placing it again`, async () => {
      const w = byId(`gbp-usd-book-${kind}`)
      const e = env()
      try {
        let run = await runSteps(w, e, newRun(w), at(w, 'ask1') + 1)
        expect(run.values.book).toMatchObject({ venue: kind })
        expect((run.values.ask1 as Outputs['placeOrder']).orderId).toBeDefined()
        expect(run.values.ask1).toMatchObject({ filled: '0' })
        await saveRun(run)
        const h0 = await height(e, run)
        run = (await loadRun(w.id))!
        expect(await done(w, w.steps[at(w, 'ask1')]!, e, run)).toBe(true)
        run = await runSteps(w, e, run)
        // on-chain: aliceOk2, ask2, bobOk, buy; off-chain: ask2 is only signed, so aliceOk2, bobOk and the settle
        expect(await height(e, run) - h0).toBe(kind === 'onchain' ? 4 : 3)
        const mine = await aliceOrders(e, run)
        expect(mine.map(o => [o.status, o.filled])).toEqual([['filled', 100000n], ['partial', 50000n]])
        expect(run.steps.buy!.outputs).toMatchObject({ filled: '150000', tx: expect.stringMatching(/^0x/) })
        await clearRun(w.id)
      } finally { await disposeAll(e) }
    }, 60_000)

    test(`${kind}: cancelOrder cancels Alice's partly filled ask, and its check says so`, async () => {
      const w = structuredClone(byId(`gbp-usd-book-${kind}`)) as Walkthrough
      w.steps.push({
        id: 'cancel', do: 'cancelOrder', title: 'Alice cancels', text: 'Alice takes back the rest.', args: { from: '$alice', order: '$ask2' },
        expect: [{ order: '$ask2', status: 'cancelled', filled: '500 $GBP' }],
      })
      expect('ok' in validate(w)).toBe(true)
      const e = env()
      try {
        let run = await runSteps(w, e, newRun(w))
        const cancel = w.steps.at(-1)!
        expect(initialInputs(w, cancel, run)).toEqual({ 'cancel.order': (run.values.ask2 as Outputs['placeOrder']).orderId! })
        expect((await aliceOrders(e, run)).map(o => o.status)).toEqual(['filled', 'cancelled'])
        const h = await height(e, run)
        run = await runSteps(w, e, run) // done: nothing repeats
        expect(await height(e, run)).toBe(h)
      } finally { await disposeAll(e) }
    }, 60_000)
  }

  test('initialInputs for a placeOrder and the approve before it', async () => {
    const w = byId('gbp-usd-book-onchain')
    const e = env()
    try {
      const run = await runSteps(w, e, newRun(w), at(w, 'book') + 1)
      const order = { 'order.side': 'buy', 'order.type': 'limit', 'order.price': '1.28', 'order.amount': '1500' }
      expect(initialInputs(w, w.steps[at(w, 'buy')]!, run)).toEqual(order)
      expect(initialInputs(w, w.steps[at(w, 'bobOk')]!, run)).toEqual(order)
      expect(await done(w, w.steps[at(w, 'book')]!, e, run)).toBe(true)
      expect(await done(w, w.steps[at(w, 'ask1')]!, e, run)).toBe(false)
    } finally { await disposeAll(e) }
  }, 60_000)
})

describe('pool walkthrough', () => {
  const w = byId('gbp-usd-pool')
  const at = (id: string) => w.steps.findIndex(s => s.id === id)
  const bal = async (e: Env, run: Run, token: string, who: string) => readContract(await chainOf(e, run), amount(run, `1 $${token}`).asset.address, erc20Abi, 'balanceOf', [(run.values[who] as Outputs['account']).address]) as Promise<bigint>

  test('outputs: transfer tx, pool address, add shares and k, swap out at the quote; reloaded after the add, finishes without re-adding', async () => {
    const e = env()
    try {
      let run = await runSteps(w, e, newRun(w), at('add') + 1)
      expect(await bal(e, run, 'GBP', 'bob')).toBe(100000n)
      expect((run.steps.send!.outputs as Outputs['transfer']).tx).toMatch(/^0x/) // (toMatchObject with a matcher would write the matcher into the run)
      expect((run.values.pool as Outputs['deployPool']).address).toMatch(/^0x/)
      const add = run.steps.add!.outputs as Outputs['addLiquidity']
      expect(add.k).toBe(String(10_000_000n * 127_000_000_000n)) // reserves right after the first deposit
      expect(BigInt(add.shares)).toBeGreaterThan(0n)
      await saveRun(run)
      const h0 = await height(e, run)
      run = (await loadRun(w.id))!
      expect(await done(w, w.steps[at('add')]!, e, run)).toBe(true)
      run = await runSteps(w, e, run)
      expect(await height(e, run) - h0).toBe(2) // bobOk, swap: no second add
      expect(run.steps.swap!.outputs).toMatchObject({ out: '1253690703' })
      expect(await bal(e, run, 'USD', 'bob')).toBe(1253690703n)
      const [, k] = await checks(w, w.steps[at('swap')]!, e, run)
      expect(k).toMatchObject({ pass: true, actual: expect.stringContaining('grew') })
      // k is read at the add's own block: re-reading the add after the swap still gives the post-add reserves
      expect((await poolOutputs(await chainOf(e, run), 'addLiquidity', add.tx)).k).toBe(add.k)
      await clearRun(w.id)
    } finally { await disposeAll(e) }
  }, 60_000)

  test('kGrew before the swap: pass false, "did not grow"', async () => {
    const e = env()
    try {
      const run = await runSteps(w, e, newRun(w), at('bobOk') + 1)
      const [, k] = await checks(w, w.steps[at('swap')]!, e, run)
      expect(k).toMatchObject({ pass: false })
      expect(k!.actual).toContain('did not grow')
    } finally { await disposeAll(e) }
  }, 60_000)

  test("removeLiquidity: half of Alice's shares come back as both tokens", async () => {
    const pw = structuredClone(w) as Walkthrough
    pw.steps.push({ id: 'rm', do: 'removeLiquidity', title: 'x', text: 'x', args: { from: '$alice', pool: '$pool', percent: 50 } })
    const e = env()
    try {
      const run = await runSteps(pw, e, newRun(pw))
      const out = run.steps.rm!.outputs as Outputs['removeLiquidity']
      expect(BigInt(out.base)).toBeGreaterThan(5_000_000n) // reserves 10,100,000 / 125,746,309,297 after the swap
      expect(BigInt(out.quote)).toBeGreaterThan(62_800_000_000n)
      expect(initialInputs(pw, pw.steps.at(-1)!, run)).toEqual({ 'pool.tab': 'remove', 'remove.percent': '50' })
    } finally { await disposeAll(e) }
  }, 60_000)

  test('initialInputs: the add, its approves, the swap and the transfer', async () => {
    const e = env()
    try {
      const run = await runSteps(w, e, newRun(w), at('pool') + 1)
      const add = { 'pool.tab': 'add', 'add.base': '100000', 'add.quote': '127000' }
      expect(initialInputs(w, w.steps[at('add')]!, run)).toEqual(add)
      expect(initialInputs(w, w.steps[at('aliceUsd')]!, run)).toEqual(add)
      const gbp = amount(run, '1 $GBP').asset.address
      expect(initialInputs(w, w.steps[at('swap')]!, run)).toEqual({ 'pool.tab': 'swap', 'swap.pay': gbp, 'swap.amount': '1000', 'swap.slippage': '50' })
      expect(initialInputs(w, w.steps[at('send')]!, run)).toEqual({ 'send.to': (run.values.bob as Outputs['account']).address, 'send.amount': '1000' })
      expect(await done(w, w.steps[at('aliceGbp')]!, e, run)).toBe(false)
    } finally { await disposeAll(e) }
  }, 60_000)
})

// ---------- cross-chain swap (two chains) ----------

describe('cross-chain swap walkthroughs', () => {
  const same = (x?: string | null, y?: string | null) => !!x && !!y && x.toLowerCase() === y.toLowerCase()
  const XSWAP = ['deployHashLock', 'lockFunds', 'claimLock', 'refundLock', 'advanceBlocks']
  /** an xswap step, or an approve before one: it runs on /xswap */
  const onXSwap = (w: Walkthrough, s: Step) => XSWAP.includes(s.do) || (s.do === 'approve' && w.steps.find(x => x.id === s.args?.before)?.do === 'lockFunds')
  const idOf = (run: Run, k: string) => (run.values[k] as Outputs['chain']).id
  const addrOf = (run: Run, k: string) => (run.values[k] as { address: Address }).address
  /** who the page acts as: the step's `from`, else the nearest earlier step's */
  const actor = (w: Walkthrough, i: number) => String(w.steps.slice(0, i + 1).reverse().find(s => s.args?.from)!.args!.from).slice(1)
  const tagOf = (html: string, id: string) => new RegExp(`<[a-z]+[^>]*data-wizard="${id.replace('.', '\\.')}"[^>]*>`).exec(html)?.[0]

  /** What /xswap reads for `path`, with the page's own helpers, as XSwapPanels props. */
  async function pageState(e: Env, path: string) {
    const { tokensOf, walletOf, makerSecret } = await import('../src/pages/XSwap')
    const { hashLockAt, headOf, sidesFor } = await import('../src/htlc/locate')
    const { secrets } = await import('../src/htlc/secrets')
    const { roleOf } = await import('../src/htlc/ui')
    const { swapState } = await import('@evmb/htlc')
    const p = new URL(path, 'http://x').searchParams
    const A = await e.registry.open(p.get('chain')!), B = await e.registry.open(p.get('chainB')!)
    const people = e.accounts.list(), acting = people.find(x => same(x.address, p.get('as')))
    const [tokA, tokB, lockA, lockB, headA, headB] = await Promise.all([tokensOf(A), tokensOf(B), hashLockAt(A), hashLockAt(B), headOf(A), headOf(B)])
    const base = tokA.find(t => same(t.address, p.get('base'))), quote = tokB.find(t => same(t.address, p.get('quote')))
    const hash = (p.get('hash') || undefined) as Hex | undefined
    const sides = hash && lockA ? await sidesFor(A, B, hash) : undefined
    const st = sides?.a && hash ? { ...await swapState(sides.a, sides.b, hash), b: !!sides.b } : undefined
    const secret = await makerSecret(roleOf(st?.opening, acting?.address), hash, secrets.get)
    const walletA = lockA && base && acting ? await walletOf(A, base.address as Address, acting.address, lockA.address) : {}
    const o = st?.opening
    const walletB = o && acting ? await walletOf(B, o.wantToken, acting.address, o.wantLock) : {}
    return {
      chainA: A, chainB: B, chains: [A.info, B.info], people, acting, tokA, tokB, base, quote, lockA, lockB, headA, headB, st, walletA, walletB, secret,
      working: false, mineErr: {},
    }
  }

  /** Review Focus 1 at one step: the path, the fields filled on the page, its pulsing button, and what pressing it calls. */
  async function onPage(w: Walkthrough, i: number, run: Run, e: Env) {
    const { createElement: h } = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { MemoryRouter } = await import('react-router-dom')
    const { AppState } = await import('../src/state')
    const { WizardProvider, useWizard } = await import('../src/walkthrough/wizard')
    const { binding, lastRegistered, pageChain } = await import('../src/walkthrough/bindings')
    const { XSwapPanels } = await import('../src/pages/XSwap')
    const step = w.steps[i]!, b = binding(step, w), path = b.path(run)
    const url = new URL(path, 'http://x'), p = url.searchParams
    const [kA, kB] = ['dave', 'sue']
    const where = { step: step.id, path }
    expect({ ...where, page: url.pathname }).toEqual({ ...where, page: '/xswap' })
    expect({ ...where, chain: p.get('chain'), chainB: p.get('chainB'), as: p.get('as')?.toLowerCase(), base: p.get('base'), quote: p.get('quote') }).toEqual({
      ...where, chain: idOf(run, kA), chainB: idOf(run, kB), as: addrOf(run, actor(w, i)).toLowerCase(), base: addrOf(run, 'GBP'), quote: addrOf(run, 'USD'),
    })
    expect(pageChain(w, step, run)).toBe(idOf(run, kA)) // the wizard selects chain A for every step on /xswap
    if (run.steps.offer) expect(p.get('hash')).toBe((run.steps.offer.outputs as Outputs['lockFunds']).hash)

    const s = await pageState(e, path), calls: unknown[][] = []
    const rec = (...c: unknown[]) => async () => void calls.push(c)
    const on = {
      deploy: (x: 'A' | 'B') => rec('deploy', x)(), mine: (x: 'A' | 'B', n: number) => rec('mine', x, n)(),
      approveMake: (n: bigint) => rec('approveMake', n)(), make: (t: unknown) => rec('make', t)(),
      approveAccept: () => rec('approveAccept')(), accept: (tb: bigint) => rec('accept', tb)(), act: (a: string) => rec('act', a)(),
    }
    let c: ReturnType<typeof useWizard> = null
    const Probe = () => { c = useWizard(); return null }
    const html = renderToString(h(MemoryRouter, null, h(AppState, null, h(WizardProvider, { seed: { w, run, index: i } },
      h('div', null, h(XSwapPanels, { ...s, on } as any), h(Probe)))))).replaceAll('<!-- -->', '')
    const init = initialInputs(w, step, run)
    for (const f of b.fields) {
      const tag = tagOf(html, f)
      expect({ ...where, f, on: !!tag?.includes('data-wz-on') }).toEqual({ ...where, f, on: true })
      if (tag!.startsWith('<select')) expect(html).toMatch(new RegExp(`data-wizard="${f}"[^>]*>(<option[^>]*>[^<]*</option>)*?<option value="${init[f]}" selected=""`))
      else expect({ ...where, f, value: /value="([^"]*)"/.exec(tag!)?.[1] }).toEqual({ ...where, f, value: init[f] })
    }
    const act = b.actions.at(-1)!
    expect({ ...where, pressed: lastRegistered(b.actions, c!.actions) }).toEqual({ ...where, pressed: act })
    expect({ ...where, pulse: !!tagOf(html, act)?.includes('data-wz-pulse') }).toEqual({ ...where, pulse: true })
    await c!.actions.get(act)!()
    const B = (k?: unknown) => (String(k).slice(1) === kA ? 'A' : 'B')
    const want = ({
      deployHashLock: () => ['deploy', B(step.args!.chain)],
      advanceBlocks: () => ['mine', B(step.args!.chain), step.args!.blocks],
      claimLock: () => ['act', `claim${B(step.args!.chain)}`],
      refundLock: () => ['act', `refund${B(step.args!.chain)}`],
      approve: () => (w.steps.find(x => x.id === step.args!.before)!.args!.swap ? ['approveAccept'] : ['approveMake', amount(run, String(step.args!.amount)).raw]),
      lockFunds: () => step.args!.swap ? ['accept', s.headB + BigInt(step.args!.timeout as number)] : ['make', {
        amount: amount(run, String(step.args!.amount)).raw, want: amount(run, String(step.args!.for)).raw,
        taker: addrOf(run, String(step.args!.to).slice(1)), timeoutBlock: s.headA + BigInt(step.args!.timeout as number),
      }],
    } as Record<string, () => unknown[]>)[step.do]!()
    expect({ ...where, calls }).toEqual({ ...where, calls: [want] })
    return html
  }

  /** Runs `w` headless; at each /xswap step checks the page first (Review Focus 1). */
  async function runOnPages(w: Walkthrough, e: Env) {
    let run = newRun(w)
    const pages: Record<string, string> = {}
    for (const [i, step] of w.steps.entries()) {
      if (onXSwap(w, step)) pages[step.id] = await onPage(w, i, run, e)
      run = record(w, run, step, await perform(w, step, e, run))
      expect({ step: step.id, done: await done(w, step, e, run) }).toEqual({ step: step.id, done: true })
      for (const c of await checks(w, step, e, run)) expect({ step: step.id, ...c }).toMatchObject({ pass: true })
    }
    return { run, pages }
  }
  async function reportOf(e: Env, run: Run) {
    const { sidesFor } = await import('../src/htlc/locate')
    const { answers } = await import('../src/htlc/secrets')
    const { swapReport } = await import('@evmb/htlc')
    const hash = (run.steps.offer!.outputs as Outputs['lockFunds']).hash
    const s = await sidesFor(await e.registry.open(idOf(run, 'dave')), await e.registry.open(idOf(run, 'sue')), hash)
    const at = await answers.get(hash)
    return swapReport(s.a!, s.b, hash, at ? { headAAtAnswer: BigInt(at) } : {})
  }
  const balance = async (e: Env, run: Run, chain: string, token: string, who: string) =>
    readContract(await e.registry.open(idOf(run, chain)), addrOf(run, token), erc20Abi, 'balanceOf', [addrOf(run, who)]) as Promise<bigint>

  test('claim: every step on the real page (Review Focus 1); completed, Bob has 1,000 GBP on dave and Alice 1,270 USD on sue', async () => {
    const w = byId('gbp-usd-xswap'), e = env()
    try {
      const { run, pages } = await runOnPages(w, e)
      expect(Object.keys(pages)).toEqual(['lockDave', 'lockSue', 'aliceOk', 'offer', 'bobOk', 'answer', 'aliceClaims', 'bobClaims'])
      expect(pages.answer).not.toContain('Lock anyway')
      expect(await balance(e, run, 'dave', 'GBP', 'bob')).toBe(100000n)
      expect(await balance(e, run, 'sue', 'USD', 'alice')).toBe(1270_000000n)
      const r = await reportOf(e, run)
      expect([r.outcome, r.unsafe]).toEqual(['completed', false])
      // the run never holds the secret (it is shown in the ribbon's JSON and saved in files' runs)
      expect(JSON.stringify(run).toLowerCase()).not.toContain(r.secret!.slice(2).toLowerCase())
      // done: nothing repeats on either chain
      const heads = async () => Promise.all(['dave', 'sue'].map(async k => (await e.registry.open(idOf(run, k))).request('eth_blockNumber', [])))
      const h0 = await heads()
      await runSteps(w, e, run)
      expect(await heads()).toEqual(h0)
    } finally { await disposeAll(e) }
  }, 120_000)

  test('refund: Bob never answers; past the timeout Alice refunds; refunded (maker)', async () => {
    const w = byId('gbp-usd-xswap-refund'), e = env()
    try {
      const { run, pages } = await runOnPages(w, e)
      expect(Object.keys(pages)).toEqual(['lockDave', 'lockSue', 'aliceOk', 'offer', 'wait', 'refund'])
      expect(await balance(e, run, 'dave', 'GBP', 'alice')).toBe(100_000_000n)
      expect((await reportOf(e, run)).outcome).toBe('refunded (maker)')
    } finally { await disposeAll(e) }
  }, 120_000)

  test('unsafe: Bob must press "Lock anyway"; Alice claims late and refunds: taker lost, report unsafe', async () => {
    const w = byId('gbp-usd-xswap-unsafe'), e = env()
    try {
      const { run, pages } = await runOnPages(w, e)
      expect(pages.answer).toMatch(/data-wizard="xswap\.accept"[^>]*>Lock anyway</)
      expect(pages.answer).toContain('Unsafe timeouts')
      expect(await balance(e, run, 'dave', 'GBP', 'alice')).toBe(100_000_000n)
      expect(await balance(e, run, 'sue', 'USD', 'alice')).toBe(1270_000000n)
      expect(await balance(e, run, 'dave', 'GBP', 'bob')).toBe(0n)
      const r = await reportOf(e, run)
      expect([r.outcome, r.unsafe]).toEqual(['taker lost', true])
    } finally { await disposeAll(e) }
  }, 120_000)

  test('headless, an unsafe answer without "unsafe": true is refused, as the page asks for "Lock anyway"', async () => {
    const w = structuredClone(byId('gbp-usd-xswap-unsafe')) as Walkthrough
    delete w.steps.find(s => s.id === 'answer')!.args!.unsafe
    const e = env()
    try {
      await expect(runSteps(w, e, newRun(w))).rejects.toThrow(/unsafe timeouts/i)
    } finally { await disposeAll(e) }
  }, 60_000)

  test('validation: a step naming an unknown chain key, or no chain where there are two, is refused', () => {
    const w = byId('gbp-usd-xswap')
    const errs = (f: (w: Walkthrough) => void) => { const c = structuredClone(w) as Walkthrough; f(c); const r = validate(c); return 'errors' in r ? r.errors.map(x => `${x.step} · ${x.field} — ${x.message}`) : [] }
    expect(errs(() => {})).toEqual([])
    expect(errs(c => { c.steps.find(s => s.id === 'offer')!.args!.chain = '$nope' })).toContain('offer · chain — $nope is not a declared key')
    expect(errs(c => { c.steps.find(s => s.id === 'offer')!.args!.chain = '$alice' })).toContain('offer · chain — $alice is not a chain')
    expect(errs(c => { delete c.steps.find(s => s.id === 'gbp')!.args!.chain })).toContain('gbp · chain — Name the chain ($dave or $sue): this walkthrough has two')
    expect(errs(c => { c.steps.find(s => s.id === 'answer')!.args!.swap = 'nope' })).toContain('answer · swap — swap must be the id of an earlier lockFunds that opens a swap')
    expect(errs(c => { c.steps.find(s => s.id === 'bobClaims')!.expect = [{ report: 'offer', outcome: 'won' } as any] })).toContain('bobClaims · expect — Unknown outcome won')
    expect(errs(c => { c.steps.find(s => s.id === 'offer')!.args!.for = '1270 $GBP' })).toContain('offer · for — for must be an asset on the other chain')
  })
})
