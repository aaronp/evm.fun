import { describe, test, expect } from 'bun:test'
import { readdirSync } from 'node:fs'
import { erc20Abi, type Address } from 'viem'
import { kv } from '../src/store/kv'
import { createAccounts } from '../src/store/accounts'
import { createChainRegistry } from '../src/chain/registry'
import { readContract } from '../src/tx/send'
import { bundled } from '../walkthroughs'
import { validate } from '../src/walkthrough/validate'
import { amount } from '../src/walkthrough/resolve'
import { checks, done, initialInputs, newRun, perform, record, type Env } from '../src/walkthrough/run'
import { clearRun, loadRun, saveRun } from '../src/walkthrough/runs'
import type { Outputs, Run, Walkthrough } from '../src/walkthrough/types'

// Contract and asset records go through the shared kv singleton, so the chain registry uses it too.
function env(): Env {
  const stores = new Map<string, any>()
  const registry = createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
  })
  return { accounts: createAccounts(), registry }
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
