import { test, expect } from 'bun:test'
import { encodeDeployData, encodeFunctionData, getAddress, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AssetToken } from '@evmb/contracts'
import { bookSchema, memoryStore, type Level } from '@evmb/orderbook'
import { kv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'
import { contractsRegistry } from '../src/contracts/registry'
import { signAndSend } from '../src/tx/send'
import { deployVenue, openVenue, venueFor } from '../src/orderbook/locate'
import { walletOf } from '../src/orderbook/wallet'
import { depthPaths, sizeText, spreadOf } from '../src/orderbook/ui'
import type { Account } from '../src/store/accounts'

const key = `0x${'11'.repeat(32)}` as const
const me: Account = { label: 'me', address: privateKeyToAccount(key).address, privateKey: key }

function registry() {
  const stores = new Map<string, any>()
  return createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
  })
}

for (const [kind, name] of [['onchain', 'OrderBook'], ['offchain', 'Settlement']] as const) {
  test(`${kind}: no record → undefined; deployVenue adds one ${name} record venueFor finds; the newer of two wins`, async () => {
    const h = await registry().create('c', 'plain', [me.address])
    try {
      expect(await venueFor(h, kind)).toBeUndefined()
      let sent = 0
      const first = await deployVenue(h, kind, me, () => sent++)
      expect(sent).toBe(1)
      const recs = await contractsRegistry.list(h.info.id)
      expect(recs.map(r => r.name)).toEqual([name])
      expect(recs[0]).toMatchObject({ address: first, deployer: me.address })
      expect(await venueFor(h, kind)).toBe(first)
      const second = await deployVenue(h, kind, me)
      expect(await venueFor(h, kind)).toBe(second)
    } finally { await h.dispose() }
  })
}

test('a record with the right name but a foreign ABI is not a venue', async () => {
  const h = await registry().create('c', 'plain', [me.address])
  try {
    const at = await deployVenue(h, 'onchain', me)
    const [r] = await contractsRegistry.list(h.info.id)
    await contractsRegistry.replace(h.info.id, [{ ...r!, abi: AssetToken.abi as any[] }])
    expect(await venueFor(h, 'onchain')).toBeUndefined()
    expect(at).toBeTruthy()
  } finally { await h.dispose() }
})

test('deployVenue on a benchmark chain throws and records nothing', async () => {
  const reg = registry()
  const h = await reg.create('bench', 'plain', [me.address])
  try {
    reg.addEphemeral(h)
    await expect(deployVenue(h, 'offchain', me)).rejects.toThrow('Benchmark chains keep no contract records')
    expect(await contractsRegistry.list(h.info.id)).toEqual([])
  } finally { await h.dispose() }
})

test('a fork keeps its own venue records and its off-chain rows keyed by its own chain id; walletOf sends and signs', async () => {
  const reg = registry()
  const p = await reg.create('parent', 'plain', [me.address])
  try {
    const settlement = await deployVenue(p, 'offchain', me)
    const tok = async (sym: string, dec: number) => {
      const r = await signAndSend(p, me, { data: encodeDeployData({ abi: AssetToken.abi, bytecode: AssetToken.bytecode, args: [sym, sym, dec, 10n ** 12n, me.address] }) })
      return getAddress(r.contractAddress!) as Address
    }
    const gbp = await tok('GBP', 2), usd = await tok('USD', 6)
    await signAndSend(p, me, { to: gbp, data: encodeFunctionData({ abi: AssetToken.abi, functionName: 'approve', args: [settlement, 10n ** 12n] }) })

    const f = await reg.createFrom(await p.approach.snapshot!(), {
      name: 'fork', type: 'plain', contracts: await contractsRegistry.list(p.info.id),
      source: { kind: 'snapshot', snapshotName: 's', fromChainName: 'parent', height: 0 },
    })
    try {
      expect(await venueFor(f, 'offchain')).toBe(settlement)
      const store = memoryStore(bookSchema) // one store for both chains, as the app's bookStore
      const onFork = (await openVenue(f, 'offchain', store))!, onParent = (await openVenue(p, 'offchain', store))!
      const market = { base: gbp, quote: usd }
      await onFork.place(walletOf(f, me), { market, side: 'sell', type: 'limit', price: 1_270_000n, amount: 50_000n })
      expect((await onFork.orders({ owner: me.address })).map(o => [o.side, o.amount, o.status])).toEqual([['sell', 50_000n, 'open']])
      expect(await onParent.orders({ owner: me.address })).toEqual([])
      expect((await onFork.book(market)).asks.map(l => [l.price, l.size])).toEqual([[1_270_000n, 50_000n]])
      expect((await onParent.book(market)).asks).toEqual([])

      // the fork's own OrderBook: recorded on the fork only; walletOf's sendTransaction gives the receipt the venue needs
      const book = await deployVenue(f, 'onchain', me)
      expect(await venueFor(p, 'onchain')).toBeUndefined()
      expect(await venueFor(f, 'onchain')).toBe(book)
      await signAndSend(f, me, { to: gbp, data: encodeFunctionData({ abi: AssetToken.abi, functionName: 'approve', args: [book, 10n ** 12n] }) })
      const ob = (await openVenue(f, 'onchain', store))!
      const r = await ob.place(walletOf(f, me), { market, side: 'sell', type: 'limit', price: 1_280_000n, amount: 1_000n })
      expect(r.tx).toMatch(/^0x/)
      expect((await ob.book(market)).asks.map(l => [l.price, l.size])).toEqual([[1_280_000n, 1_000n]])
    } finally { await f.dispose() }
  } finally { await p.dispose() }
}, 60_000)

test('Trade sits under Markets after Swap; without a chain it says "Select a chain first."', async () => {
  const { createElement: h } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { MemoryRouter } = await import('react-router-dom')
  const { groups, real } = await import('../src/App')
  const { AppState } = await import('../src/state')
  const { AppBarProvider } = await import('../src/state/appBar')
  expect(groups.find(g => g.label === 'Markets')!.items.map(([n]) => n)).toEqual(['Assets', 'Swap', 'Trade'])
  const html = renderToString(h(MemoryRouter, { initialEntries: ['/trade'] }, h(AppState, null, h(AppBarProvider, null, real.Trade!))))
  expect(html).toContain('Select a chain first.')
})

const lv = (price: bigint, size: bigint, total: bigint): Level => ({ price, size, total, orders: 1 })

test('spreadOf: best ask - best bid, in bps of the mid to 1 dp; none without both sides', () => {
  expect(spreadOf([lv(12698n, 1n, 1n)], [lv(12703n, 1n, 1n)])).toEqual({ spread: 5n, bps: '3.9' })
  expect(spreadOf([lv(10000n, 1n, 1n)], [lv(10100n, 1n, 1n)])).toEqual({ spread: 100n, bps: '99.5' })
  expect(spreadOf([], [lv(1n, 1n, 1n)])).toBeUndefined()
})

test('depthPaths: mid at the centre, step areas from the best level outwards, edges labelled', () => {
  const d = depthPaths([lv(100n, 1n, 1n), lv(90n, 2n, 3n)], [lv(110n, 3n, 3n)])!
  // mid 105, half-width 15 + 6% → 89.1 .. 120.9 over x 10..550; y = 200 - cum/3 * 175
  expect(d.lo).toBe(89n)
  expect(d.hi).toBe(121n)
  expect(d.bid).toBe('M195.1 200 L195.1 200.0 L195.1 141.7 L25.3 141.7 L25.3 25.0 L10 25.0')
  expect(d.ask).toBe('M364.9 200 L364.9 200.0 L364.9 25.0 L550 25.0')
  expect(d.bidFill).toBe(`${d.bid} L10 200 Z`)
  expect(d.askFill).toBe(`${d.ask} L550 200 Z`)
  expect(depthPaths([], [])).toBeUndefined()
  expect(depthPaths([lv(100n, 1n, 1n)], [])!.ask).toBeUndefined()
})

test('sizeText: whole sizes without decimals, fractions to 2 dp', () => {
  expect(sizeText(100_000n, 2)).toBe('1,000')
  expect(sizeText(50n, 2)).toBe('0.50')
})
