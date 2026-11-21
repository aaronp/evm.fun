import { test, expect } from 'bun:test'
import { bookSchema, memoryStore } from '@evmb/orderbook'
import { kv } from '../src/store/kv'
import { createAccounts } from '../src/store/accounts'
import { createChainRegistry } from '../src/chain/registry'
import { bundled } from '../walkthroughs'
import { install } from '../src/walkthrough/install'
import { loadRun } from '../src/walkthrough/runs'
import type { Env } from '../src/walkthrough/run'
import type { Walkthrough } from '../src/walkthrough/types'

function env(): Env {
  const stores = new Map<string, any>()
  const registry = createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
  })
  return { accounts: createAccounts(), registry, book: memoryStore(bookSchema) }
}
const disposeAll = async (e: Env) => { for (const c of await e.registry.list()) await e.registry.remove(c.id) }

for (const w of bundled) {
  test(`install ${w.id}: every step recorded and saved, every check passes`, async () => {
    const e = env()
    try {
      const seen: number[] = []
      const { run, failed } = await install(w, e, i => seen.push(i))
      expect(seen).toEqual(w.steps.map((_, i) => i))
      expect(Object.keys(run.steps).length).toBe(w.steps.length)
      expect(failed).toEqual([])
      expect((await loadRun(w.id))?.steps).toEqual(run.steps) // saved: Get started shows it done, the ribbon resumes it
    } finally { await disposeAll(e) }
  })
}

test('a failing step is named, and the run up to it is saved', async () => {
  const e = env()
  try {
    const w = structuredClone(bundled.find(x => x.id === 'gbp-usd')!) as Walkthrough
    const i = w.steps.findIndex(s => s.do === 'take')
    w.steps.splice(i - 1, 1) // drop Bob's approval: the take reverts, which this file doesn't expect
    const err = await install(w, e).then(() => undefined, (x: Error) => x.message)
    expect(err).toMatch(/^Step \d+ \(/)
    expect(Object.keys((await loadRun(w.id))!.steps).length).toBeGreaterThan(0)
  } finally { await disposeAll(e) }
})
