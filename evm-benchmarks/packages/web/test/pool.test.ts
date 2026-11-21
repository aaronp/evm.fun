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

// ---- Task 4: Swap / Add liquidity / Remove ----

test('form helpers: min at tolerance, approve exactly what is needed, percent of shares, new share %', async () => {
  const { minAt, approveFor, percentOf, newShareText, swapAfter } = await import('../src/pool/form')
  expect(minAt(1_253_690_000n, 50)).toBe(1_247_421_550n) // 1,253.69 USD at 0.5% → 1,247.42
  expect(minAt(1000n, 10)).toBe(999n); expect(minAt(1000n, 100)).toBe(990n); expect(minAt(999n, 50)).toBe(994n) // floor
  expect(approveFor(100n, 0n)).toBe(100n) // approve sets the allowance: the whole need, not the gap
  expect(approveFor(100n, 40n)).toBe(100n)
  expect(approveFor(100n, 100n)).toBe(0n)
  expect(approveFor(100n, undefined)).toBe(0n) // unknown yet: no button
  expect(percentOf(1001n, 25)).toBe(250n); expect(percentOf(1001n, 50)).toBe(500n); expect(percentOf(1001n, 75)).toBe(750n)
  expect(percentOf(1001n, 100)).toBe(1001n)
  expect(newShareText(s, 0n, s.totalShares)).toBe('50.00%')
  expect(newShareText({ ...s, totalShares: 0n }, 0n, 9000n)).toBe('90.00%') // first deposit: 1000 go to dEaD
  expect(swapAfter(s, true, 100_000n, 1_253_690_000n)).toEqual({ reserveBase: 10_100_000n, reserveQuote: 125_746_310_000n })
  expect(swapAfter(s, false, 1_253_690_000n, 100_000n)).toEqual({ reserveBase: 9_900_000n, reserveQuote: 128_253_690_000n })
})

test('fill the other side at the pool ratio so the contract pulls exactly that amount', async () => {
  const { quoteAdd } = await import('@evmb/pool')
  const { fillOther } = await import('../src/pool/form')
  const odd: PoolState = { ...s, reserveBase: 10_000_003n, reserveQuote: 127_000_000_017n, totalShares: 112_694_276_695_846_597_034_457n }
  for (const st of [s, odd, flipped])
    for (const v of [1n, 7n, 100_000n, 1_234_567n, 5_000_000n]) {
      const q = fillOther(st, 'base', v)
      const a = quoteAdd(st, v, q)
      expect(a.quoteUsed).toBe(q); expect(a.baseUsed).toBeLessThanOrEqual(v)
      const b = fillOther(st, 'quote', v * 12_700n)
      const c = quoteAdd(st, b, v * 12_700n)
      expect(c.baseUsed).toBe(b); expect(c.quoteUsed).toBeLessThanOrEqual(v * 12_700n)
    }
  expect(fillOther(s, 'base', 5_000_000n)).toBe(63_500_000_000n) // 50,000 GBP ↔ 63,500 USD
})

test('a revert reads as a sentence: Slippage names what you would get and your minimum', async () => {
  const { revertText } = await import('../src/pool/form')
  const usdT = { symbol: 'USD', decimals: 6 }
  expect(revertText({ error: 'Slippage', args: [1_253_690_000n, 1_260_000_000n] }, () => usdT))
    .toBe('Slippage — you would get 1,253.69 USD, below your minimum 1,260.00 USD.')
  const seen: bigint[][] = []
  revertText({ error: 'Slippage', args: [5n, 7n] }, (out, min) => (seen.push([out, min]), usdT))
  expect(seen).toEqual([[5n, 7n]]) // the side is chosen from both the payout and the minimum
  expect(revertText({ error: 'BadAmount', args: [] }, () => usdT)).toBe('BadAmount')
  expect(revertText({ error: 'ERC20InsufficientAllowance', args: ['0x01', 0n, 5n] }, () => usdT)).toBe('ERC20InsufficientAllowance(0x01, 0, 5)')
})

test('Review Focus 3: a slippage revert on a real chain surfaces its decoded Slippage(out, min)', async () => {
  const { approveCall } = await import('@evmb/assets')
  const { addLiquidityCall, quoteSwap, readPool, swapCall } = await import('@evmb/pool')
  const { poolTx } = await import('../src/pool/locate')
  const h = await registry().create('c', 'plain', [me.address])
  try {
    const tok = async (sym: string, dp: number) => {
      const r = await signAndSend(h, me, { data: encodeDeployData({ abi: AssetToken.abi, bytecode: AssetToken.bytecode, args: [sym, sym, dp, 10n ** 15n, me.address] }) })
      return getAddress(r.contractAddress!) as Address
    }
    const g = await tok('GBP', 2), u = await tok('USD', 6)
    const pool = await deployPool(h, me, g, u)
    const asset = (address: Address, decimals: number) => ({ address, decimals, kind: 'erc20' }) as any
    for (const [t, d, v] of [[g, 2, 10_000_000n], [u, 6, 127_000_000_000n]] as const) await signAndSend(h, me, approveCall(asset(t, d), pool, v))
    expect((await poolTx(h, me, addLiquidityCall(pool, 10_000_000n, 127_000_000_000n, 0n), () => ({ symbol: 'LP', decimals: 18 }))).error).toBeUndefined()
    await signAndSend(h, me, approveCall(asset(g, 2), pool, 100_000n))
    const q = quoteSwap(await readPool(h.request, pool), g, 100_000n, 50)
    const r = await poolTx(h, me, swapCall(pool, g, 100_000n, q.out + 1n), () => ({ symbol: 'USD', decimals: 6 }))
    expect(r.hash).toBeDefined()
    const { exactText } = await import('../src/swap/ui')
    expect(r.error).toBe(`Reverted: Slippage — you would get ${exactText(q.out, 6)} USD, below your minimum ${exactText(q.out + 1n, 6)} USD.`)
    const ok = await poolTx(h, me, swapCall(pool, g, 100_000n, q.minOut), () => ({ symbol: 'USD', decimals: 6 }))
    expect(ok.error).toBeUndefined(); expect(ok.hash).toBeDefined()
  } finally { await h.dispose() }
}, 60_000)

test('Review Focus 5: an empty pool shows only Add liquidity, both amounts free, with the initial price', async () => {
  const { createElement: h } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { PoolTabs } = await import('../src/components/PoolTabs')
  const { MemoryRouter } = await import('react-router-dom')
  const { AppState } = await import('../src/state')
  const shell = (el: any) => h(MemoryRouter, null, h(AppState, null, el)) // the tabs read the chain and location (request fixes)
  const GBP = { id: 'g', chainId: 'c', kind: 'erc20', symbol: 'GBP', name: 'GBP', decimals: 2, address: gbp } as any
  const USD = { id: 'u', chainId: 'c', kind: 'erc20', symbol: 'USD', name: 'USD', decimals: 6, address: usd } as any
  const props = { base: GBP, quote: USD, funds: () => ({}), busy: false, onApprove: async () => undefined, onSwap: async () => undefined, onAdd: async () => undefined, onRemove: async () => undefined, onAfter: () => {} }
  const empty = renderToString(shell(h(PoolTabs, { ...props, s: { ...s, reserveBase: 0n, reserveQuote: 0n, totalShares: 0n } })))
  expect(empty).toContain('Add liquidity'); expect(empty).toContain('Initial price')
  expect(empty).not.toContain('>Swap<'); expect(empty).not.toContain('>Remove<'); expect(empty).not.toContain('You pay')
  expect(empty).not.toMatch(/readonly|readOnly/)
  const live = renderToString(shell(h(PoolTabs, { ...props, s })))
  for (const t of ['>Swap<', 'Add liquidity', '>Remove<', 'You pay', 'You receive (estimate)', 'Your price', 'Price impact', 'Fee (0.30%)', 'Slippage tolerance', '0.1%', '0.5%', '1%', 'Minimum received',
    'Reverts if you would get less than the minimum — e.g. if someone else trades first and moves the price.']) expect(live).toContain(t)
  expect(live).toMatch(/aria-pressed="true"[^>]*>0\.5%/) // default tolerance
})
