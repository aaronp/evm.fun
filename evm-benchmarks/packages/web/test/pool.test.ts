import { test, expect } from 'bun:test'
import { encodeDeployData, getAddress, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AssetToken } from '@evmb/contracts'
import type { PoolActivity, PoolState } from '@evmb/pool'
import { book, type Offer } from '@evmb/swap'
import { kv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'
import { contractsRegistry } from '../src/contracts/registry'
import { signAndSend } from '../src/tx/send'
import { deployPool, poolFor } from '../src/pool/locate'
import { activityRow, curve, kText, lpText, offersText, poolPriceText, poolRef, shareText, worth } from '../src/pool/ui'
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

test('poolFor finds a (USD, GBP) pool for GBP/USD; deployPool refuses the pair in either order (Studio path)', async () => {
  const h = await registry().create('c', 'plain', [me.address])
  try {
    const tok = async (sym: string, dp: number) => {
      const r = await signAndSend(h, me, { data: encodeDeployData({ abi: AssetToken.abi, bytecode: AssetToken.bytecode, args: [sym, sym, dp, 10n ** 15n, me.address] }) })
      return getAddress(r.contractAddress!) as Address
    }
    const gbp = await tok('GBP', 2), usd = await tok('USD', 6)
    expect(await poolFor(h, gbp, usd)).toBeUndefined()
    let sent = 0
    const pool = await deployPool(h, me, usd, gbp, () => sent++)
    expect(sent).toBe(1)
    expect(await poolFor(h, gbp, usd)).toBe(pool)
    expect(await poolFor(h, usd, gbp)).toBe(pool)
    await expect(deployPool(h, me, gbp, usd)).rejects.toThrow(`already has a pool for this pair at ${pool}`)
    await expect(deployPool(h, me, usd, gbp)).rejects.toThrow('already has a pool')
    expect((await contractsRegistry.list(h.info.id)).filter(r => r.name === 'Pool').map(r => r.address)).toEqual([pool])
  } finally { await h.dispose() }
}, 60_000)

test('deployPool on a benchmark chain throws and records nothing', async () => {
  const reg = registry()
  const h = await reg.create('bench', 'plain', [me.address])
  try {
    reg.addEphemeral(h)
    const a = getAddress('0x00000000000000000000000000000000000000a1'), b = getAddress('0x00000000000000000000000000000000000000b2')
    await expect(deployPool(h, me, a, b)).rejects.toThrow('Benchmark chains keep no contract records')
    expect(await contractsRegistry.list(h.info.id)).toEqual([])
  } finally { await h.dispose() }
})

const gbp = getAddress('0x00000000000000000000000000000000000000a1'), usd = getAddress('0x00000000000000000000000000000000000000b2')
// the screenshot's pool: 100,000 GBP (2 dp) and 127,000 USD (6 dp), seen as GBP/USD
const s: PoolState = { address: gbp, base: gbp, quote: usd, baseDecimals: 2, quoteDecimals: 6, reserveBase: 10_000_000n, reserveQuote: 127_000_000_000n, totalShares: 112_694_276_695_846_597_034_423n }
const flipped: PoolState = { ...s, base: usd, quote: gbp, baseDecimals: 6, quoteDecimals: 2, reserveBase: s.reserveQuote, reserveQuote: s.reserveBase }

test('prices from the reserves as a rational, 4 dp half-up — also with a 2 dp quote token; Trade header reference', () => {
  expect(poolPriceText(s)).toBe('1.2700')
  expect(poolPriceText(flipped)).toBe('0.7874') // 100000/127000 = 0.787401…; orderbook units (GBP cents per USD) would say 0.78
  expect(poolPriceText({ ...s, reserveQuote: 125_369_000_005n })).toBe('1.2537') // 1.25369000005 → half-up
  expect(poolPriceText({ ...s, reserveBase: 0n, reserveQuote: 0n })).toBe('—')
  expect(poolRef(s)).toBe('pool 1.2700')
  expect(poolRef({ ...s, reserveBase: 0n, reserveQuote: 0n })).toBeUndefined()
  expect(poolRef(undefined)).toBeUndefined()
})

test('k in whole units, LP half-up 2 dp, share %, worth at pool price', () => {
  expect(kText(s)).toBe('12,700,000,000')
  expect(lpText(56_347_138_347_923_298_517_211n)).toBe('56,347.14')
  expect(lpText(56_347_134_999_999_999_999_999n)).toBe('56,347.13')
  expect(shareText(1n, 2n)).toBe('50.00%')
  expect(shareText(1n, 3n)).toBe('33.33%')
  expect(shareText(2n, 3n)).toBe('66.67%')
  expect(shareText(0n, 0n)).toBe('0.00%')
  expect(worth(s, 5_000_000n, 63_500_000_000n)).toBe(127_000_000_000n) // 50,000 GBP at 1.27 + 63,500 USD
  expect(worth({ ...s, reserveBase: 0n }, 0n, 0n)).toBe(0n)
})

test('curve: x·y = k sampled over a range around now; widened to include the after point', () => {
  const c = curve(s)!
  expect(c.now).toEqual({ x: 100_000, y: 127_000 })
  expect(c.x0).toBeLessThan(100_000); expect(c.x1).toBeGreaterThan(100_000); expect(c.y1).toBeGreaterThan(127_000)
  expect(c.points.length).toBeGreaterThan(20)
  expect(c.points[0]![0]).toBeCloseTo(c.x0); expect(c.points.at(-1)![0]).toBeCloseTo(c.x1)
  expect(c.points[0]![1]).toBeCloseTo(c.y1)
  for (const [x, y] of c.points) expect(x * y / 12_700_000_000).toBeCloseTo(1, 9)
  for (let i = 1; i < c.points.length; i++) expect(c.points[i]![0]).toBeGreaterThan(c.points[i - 1]![0])
  const far = curve(s, { reserveBase: 1_000_000_000n, reserveQuote: 1_270_000_000n })! // 10,000,000 GBP in
  expect(far.after).toEqual({ x: 10_000_000, y: 1_270 })
  expect(far.x1).toBeGreaterThan(10_000_000)
  expect(curve({ ...s, reserveBase: 0n, reserveQuote: 0n })).toBeUndefined()
})

test('activity rows in the page order (a reversed pool maps its amounts); swaps name in → out', () => {
  const name = (a: string) => (a === me.address ? 'me' : 'tester')
  const assets = { base: { symbol: 'GBP', decimals: 2, address: gbp }, quote: { symbol: 'USD', decimals: 6, address: usd } }
  const add: PoolActivity = { kind: 'add', who: me.address, base: 5_000_000n, quote: 63_500_000_000n, shares: 56_347_138_347_923_298_517_211n, tx: '0x01', block: 1n }
  expect(activityRow(add, s, assets, name)).toEqual({ kind: 'add', text: 'me · 50,000.00 GBP + 63,500.00 USD', lp: '+56,347.14 LP' })
  // a (USD, GBP) pool reports USD first
  const rev: PoolActivity = { ...add, kind: 'remove', base: 63_500_000_000n, quote: 5_000_000n }
  expect(activityRow(rev, flipped, assets, name)).toEqual({ kind: 'remove', text: 'me · 50,000.00 GBP + 63,500.00 USD', lp: '−56,347.14 LP' })
  const swap: PoolActivity = { kind: 'swap', who: '0x0000000000000000000000000000000000000001', base: 0n, quote: 0n, tokenIn: gbp, amountIn: 100_000n, amountOut: 1_253_690_000n, tx: '0x02', block: 2n }
  expect(activityRow(swap, s, assets, name)).toEqual({ kind: 'swap', text: 'tester · 1,000.00 GBP → 1,253.69 USD' })
})

test('Swap offers (step 2): best bid · ask for the pair, or none', () => {
  const o = (id: bigint, giveToken: Address, giveAmt: bigint, getToken: Address, getAmt: bigint): Offer =>
    ({ id, maker: me.address, giveToken, giveAmt, getToken, getAmt, status: 'open' } as Offer)
  const t = (address: Address, decimals: number) => ({ address, decimals })
  expect(offersText(undefined)).toBe('none')
  expect(offersText(book([], t(gbp, 2), t(usd, 6)))).toBe('none')
  const b = book([o(1n, usd, 126_960_000n, gbp, 10_000n), o(2n, gbp, 10_000n, usd, 127_000_000n)], t(gbp, 2), t(usd, 6))
  expect(offersText(b)).toBe('bid 1.2696 · ask 1.2700')
  expect(offersText(book([o(2n, gbp, 10_000n, usd, 127_000_000n)], t(gbp, 2), t(usd, 6)))).toBe('bid — · ask 1.2700')
})

test('Pool sits under Markets between Swap and Trade; without a chain it says "Select a chain first."', async () => {
  const { createElement: h } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { MemoryRouter } = await import('react-router-dom')
  const { groups, real } = await import('../src/App')
  const { AppState } = await import('../src/state')
  const { AppBarProvider } = await import('../src/state/appBar')
  expect(groups.find(g => g.label === 'Markets')!.items.map(([n]) => n)).toEqual(['Assets', 'Swap', 'Pool', 'Trade'])
  const html = renderToString(h(MemoryRouter, { initialEntries: ['/pool'] }, h(AppState, null, h(AppBarProvider, null, real.Pool!))))
  expect(html).toContain('Select a chain first.')
})
