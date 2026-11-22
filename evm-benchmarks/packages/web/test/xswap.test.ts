import { test, expect } from 'bun:test'
import { encodeDeployData, encodeFunctionData, getAddress, zeroAddress, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AssetToken } from '@evmb/contracts'
import { canClaim, canRefund, claimCall, hashOf, lockCall, newSecret, refundCall, swapReport, type LockView, type SwapState } from '@evmb/htlc'
import { kv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'
import { signAndSend } from '../src/tx/send'
import { deployHashLock, hashLockAt, sidesFor } from '../src/htlc/locate'
import type { Account } from '../src/store/accounts'
import { actionsFor, actionText, chainLabel, countdown, defaults, maskSecret, parseBlocks, roleOf, safety, titleOf } from '../src/htlc/ui'

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const MAKER = a(1), TAKER = a(2), OTHER = a(3)
const lock = (over: Partial<LockView>): LockView => ({
  id: 1n, chain: 'A', address: a(9), sender: MAKER, recipient: TAKER, token: a(5), amount: 100n, hash: `0x${'ab'.repeat(32)}`,
  timeoutBlock: 100n, status: 'locked', closedBlock: 0n, secret: `0x${'00'.repeat(32)}`, wantChain: 'B', wantLock: a(8), wantToken: a(6), wantAmount: 127n, ...over,
})
/** A SwapState as swapState builds its flags: from canClaim/canRefund at each chain's head. */
function state(opening: LockView | undefined, answer: LockView | undefined, headA: bigint, headB: bigint): SwapState {
  return {
    opening, answer, phase: 'offered', blocksLeft: {},
    claimable: { ...(opening && { a: canClaim(opening, headA) }), ...(answer && { b: canClaim(answer, headB) }) },
    refundable: { ...(opening && { a: canRefund(opening, headA) }), ...(answer && { b: canRefund(answer, headB) }) },
  }
}
const answerOf = (over: Partial<LockView> = {}) => lock({ chain: 'B', sender: TAKER, recipient: MAKER, timeoutBlock: 50n, wantChain: '', wantLock: zeroAddress, wantToken: zeroAddress, wantAmount: 0n, ...over })

test('roleOf: maker of locks it sent, taker of locks addressed to it, else none', () => {
  expect(roleOf(lock({}), MAKER)).toBe('maker')
  expect(roleOf(lock({}), TAKER.toUpperCase().replace('0X', '0x'))).toBe('taker')
  expect(roleOf(lock({}), OTHER)).toBeUndefined()
  expect(roleOf(undefined, MAKER)).toBeUndefined()
})

test('button table: each role × phase × head vs timeout (Review Focus 4 edges: T−2 claims, T−1 refunds)', () => {
  const T = 100n, TB = 50n
  const rows: [string, SwapState, string, { secret?: boolean; b?: boolean }, string[]][] = [
    // offered: the taker can accept while A's lock is still claimable; the maker waits, then refunds
    ['offered, A far', state(lock({}), undefined, 10n, 0n), TAKER, { b: true }, ['accept']],
    ['offered, B chain not here', state(lock({}), undefined, 10n, 0n), TAKER, { b: false }, []],
    ['offered, A at T−2', state(lock({}), undefined, T - 2n, 0n), TAKER, { b: true }, ['accept']],
    ['offered, A at T−1', state(lock({}), undefined, T - 1n, 0n), TAKER, { b: true }, []],
    ['offered, maker before T−1', state(lock({}), undefined, T - 2n, 0n), MAKER, { secret: true, b: true }, []],
    ['offered, maker at T−1', state(lock({}), undefined, T - 1n, 0n), MAKER, { secret: true }, ['refundA']],
    ['offered, maker past T', state(lock({}), undefined, T + 5n, 0n), MAKER, {}, ['refundA']],
    // answered: the maker claims B with its secret until B's T−2; at B's T−1 the taker refunds instead
    ['answered, B at T−2', state(lock({}), answerOf(), 10n, TB - 2n), MAKER, { secret: true, b: true }, ['claimB']],
    ['answered, no secret here', state(lock({}), answerOf(), 10n, 0n), MAKER, { secret: false, b: true }, []],
    ['answered, B at T−1 (maker)', state(lock({}), answerOf(), 10n, TB - 1n), MAKER, { secret: true, b: true }, []],
    ['answered, B at T−1 (taker)', state(lock({}), answerOf(), 10n, TB - 1n), TAKER, { b: true }, ['refundB']],
    ['answered, B far (taker waits)', state(lock({}), answerOf(), 10n, 0n), TAKER, { b: true }, []],
    // B claimed: the taker claims A with the revealed secret until A's T−2
    ['claimedB, A at T−2', state(lock({}), answerOf({ status: 'claimed' }), T - 2n, 60n), TAKER, { b: true }, ['claimA']],
    ['claimedB, A at T−1 (taker lost)', state(lock({}), answerOf({ status: 'claimed' }), T - 1n, 60n), TAKER, { b: true }, []],
    ['claimedB, A at T−1 (maker refunds)', state(lock({}), answerOf({ status: 'claimed' }), T - 1n, 60n), MAKER, { secret: true, b: true }, ['refundA']],
    // closed: nothing left
    ['complete', state(lock({ status: 'claimed' }), answerOf({ status: 'claimed' }), T + 9n, 99n), TAKER, { b: true }, []],
    ['complete (maker)', state(lock({ status: 'claimed' }), answerOf({ status: 'claimed' }), T + 9n, 99n), MAKER, { secret: true, b: true }, []],
    ['refunded both', state(lock({ status: 'refunded' }), answerOf({ status: 'refunded' }), T + 9n, 99n), MAKER, { secret: true, b: true }, []],
    ['a stranger', state(lock({}), answerOf(), T - 1n, TB - 1n), OTHER, { secret: true, b: true }, []],
  ]
  for (const [name, s, who, has, want] of rows) expect([name, actionsFor(s, who, has) as string[]]).toEqual([name, want])
})

test('countdown agrees with the buttons at the edges; closed locks name their block', () => {
  const l = lock({ timeoutBlock: 100n })
  expect(countdown(l, 90n)).toBe('claimable for 9 more blocks · timeout block 100')
  expect(countdown(l, 98n)).toBe('claimable for 1 more block · timeout block 100')
  expect(countdown(l, 99n)).toBe('timeout block 100 · refundable now')
  expect(countdown(l, 120n)).toBe('timeout block 100 · refundable now')
  expect(countdown(lock({ status: 'claimed', closedBlock: 42n }), 120n)).toBe('claimed in block 42')
  expect(countdown(lock({ status: 'refunded', closedBlock: 101n }), 120n)).toBe('refunded in block 101')
})

test('copy: actions, title, chain labels, defaults, blocks, safety, masked secret', () => {
  const x = { amtA: '10.00', base: 'GBP', chainA: 'dave', amtB: '12.70', quote: 'USD', chainB: 'sue' }
  expect(actionText('make', x)).toBe('Lock 10.00 GBP on dave')
  expect(actionText('accept', x)).toBe('Lock 12.70 USD on sue to accept')
  expect(actionText('claimB', x)).toBe('Claim 12.70 USD on sue (reveals the secret)')
  expect(actionText('claimA', x)).toBe('Claim 10.00 GBP on dave')
  expect(actionText('refundA', x)).toBe('Refund')
  expect(actionText('refundB', x)).toBe('Refund')
  expect(titleOf('GBP', 'dave', 'USD', 'sue')).toBe('Cross-chain swap · GBP (dave) ⇄ USD (sue)')
  expect(titleOf()).toBe('Cross-chain swap')
  expect(chainLabel('c1', [{ id: 'c1', name: 'dave' }])).toBe('dave')
  expect(chainLabel('gone', [{ id: 'c1', name: 'dave' }])).toBe('chain not in this browser')
  expect(defaults).toEqual({ a: 100n, b: 50n })
  expect(parseBlocks('100')).toBe(100n)
  for (const t of ['', '0', '-1', '1.5', 'x']) expect(parseBlocks(t)).toEqual({ error: 'Enter a whole number of blocks (1 or more).' })
  // safe iff (T_A − headA) ≥ (T_B − headB) + 10
  expect(safety(160n, 60n, 90n, 0n, 'dave', 'sue')).toEqual({ safe: true, text: 'Safe: the maker’s lock has 100 blocks left on dave; yours would have 90 on sue, at least 10 fewer.' })
  const u = safety(160n, 60n, 91n, 0n, 'dave', 'sue')
  expect(u.safe).toBe(false)
  expect(u.text).toBe('Unsafe timeouts: the maker’s lock has 100 blocks left on dave; yours would have 91 on sue. Yours should end at least 10 blocks sooner (90 or fewer), or the maker could claim your side after theirs has timed out. Blocks are only a proxy for time across chains.')
  const s = newSecret()
  expect(maskSecret(s)).not.toContain(s.slice(2, 10))
  expect(maskSecret(s)).toMatch(/^0x•+$/)
})

// ---------- real chains ----------

const key = `0x${'11'.repeat(32)}` as const
const maker: Account = { label: 'alice', address: privateKeyToAccount(key).address, privateKey: key }
const key2 = `0x${'22'.repeat(32)}` as const
const taker: Account = { label: 'bob', address: privateKeyToAccount(key2).address, privateKey: key2 }
const people = [maker, taker]

function registry() {
  const stores = new Map<string, any>()
  return createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
  })
}
const tokenCall = (to: Address, functionName: 'approve' | 'transfer', args: [Address, bigint]) => ({ to, data: encodeFunctionData({ abi: AssetToken.abi, functionName, args }) })
async function ssr(node: (h: typeof import('react').createElement) => any) {
  const { createElement: h } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { MemoryRouter } = await import('react-router-dom')
  return renderToString(h(MemoryRouter, null, node(h))).replaceAll('<!-- -->', '')
}

/** Two chains (dave: GBP, sue: USD) with a HashLock each; bob holds USD. */
async function setup() {
  const reg = registry()
  const A = await reg.create('dave', 'plain', [maker.address, taker.address])
  const B = await reg.create('sue', 'plain', [maker.address, taker.address])
  const tok = async (h: typeof A, sym: string) => {
    const r = await signAndSend(h, maker, { data: encodeDeployData({ abi: AssetToken.abi, bytecode: AssetToken.bytecode, args: [sym, sym, 2, 1_000_000n, maker.address] }) })
    return getAddress(r.contractAddress!) as Address
  }
  const lockA = await deployHashLock(A, maker), lockB = await deployHashLock(B, maker)
  const gbp = await tok(A, 'GBP'), usd = await tok(B, 'USD')
  await signAndSend(B, maker, tokenCall(usd, 'transfer', [taker.address, 10_000n]))
  const assets = [
    { id: 'g', chainId: A.info.id, kind: 'erc20', address: gbp, symbol: 'GBP', name: 'GBP', decimals: 2 },
    { id: 'u', chainId: B.info.id, kind: 'erc20', address: usd, symbol: 'USD', name: 'USD', decimals: 2 },
  ] as any[]
  const chains = [{ id: A.info.id, name: 'dave' }, { id: B.info.id, name: 'sue' }]
  return { A, B, lockA, lockB, gbp, usd, assets, chains, dispose: async () => { await A.dispose(); await B.dispose() } }
}
const head = async (h: { request(m: string, p?: unknown[]): Promise<unknown> }) => BigInt((await h.request('eth_blockNumber', [])) as string)

test('hashLockAt: the deploy block; sidesFor gives B only for the chain and HashLock the terms name', async () => {
  const s = await setup()
  try {
    const at = await hashLockAt(s.A)
    expect(at!.address).toBe(s.lockA)
    expect(at!.block).toBeGreaterThan(0n)
    const secret = newSecret(), hash = hashOf(secret)
    await signAndSend(s.A, maker, tokenCall(s.gbp, 'approve', [s.lockA, 1000n]))
    await signAndSend(s.A, maker, lockCall(s.lockA, { token: s.gbp, amount: 1000n, recipient: taker.address, hash, timeoutBlock: (await head(s.A)) + 100n,
      wantChain: s.B.info.id, wantLock: s.lockB, wantToken: s.usd, wantAmount: 1270n }))
    const sides = await sidesFor(s.A, s.B, hash)
    expect([sides.a?.address, sides.b?.address]).toEqual([s.lockA, s.lockB])
    expect((await sidesFor(s.A, s.A, hash)).b).toBeUndefined() // A is not the chain the terms name
    expect((await sidesFor(s.A, undefined, hash)).b).toBeUndefined()
  } finally { await s.dispose() }
}, 60_000)

test('swap report SSR: no secret before the claim (Review Focus 2); completed with the secret after; unsafe flag', async () => {
  const s = await setup()
  const { XSwapReportView } = await import('../src/pages/XSwapReport')
  try {
    const secret = newSecret(), hash = hashOf(secret)
    await signAndSend(s.A, maker, tokenCall(s.gbp, 'approve', [s.lockA, 1000n]))
    await signAndSend(s.A, maker, lockCall(s.lockA, { token: s.gbp, amount: 1000n, recipient: taker.address, hash, timeoutBlock: (await head(s.A)) + 100n,
      wantChain: s.B.info.id, wantLock: s.lockB, wantToken: s.usd, wantAmount: 1270n }))
    await signAndSend(s.B, taker, tokenCall(s.usd, 'approve', [s.lockB, 1270n]))
    await signAndSend(s.B, taker, lockCall(s.lockB, { token: s.usd, amount: 1270n, recipient: maker.address, hash, timeoutBlock: (await head(s.B)) + 50n }))
    const render = async () => {
      const sides = await sidesFor(s.A, s.B, hash)
      const r = await swapReport(sides.a!, sides.b, hash)
      return { r, html: await ssr(h => h(XSwapReportView, { r, chains: s.chains, people, assets: s.assets })) }
    }
    const before = await render()
    expect(before.r.outcome).toBe('stuck')
    expect(before.html).toContain('Cross-chain swap still locked')
    expect(before.html.toLowerCase()).not.toContain(secret.slice(2).toLowerCase())
    expect(JSON.stringify(before.r).toLowerCase()).not.toContain(secret.slice(2).toLowerCase())

    expect((await signAndSend(s.B, maker, claimCall(s.lockB, 1n, secret))).status).toBe('success')
    expect((await signAndSend(s.A, taker, claimCall(s.lockA, 1n, secret))).status).toBe('success')
    const after = await render()
    expect(after.r.outcome).toBe('completed')
    expect(after.r.unsafe).toBe(false)
    for (const t of ['Cross-chain swap completed', 'alice swapped 10.00 GBP on dave for 12.70 USD on sue with bob.', 'Balance changes',
      'dave · bob · GBP', 'sue · alice · USD', '+12.70', 'Secret', secret, 'alice locked #1 on dave', 'bob claimed #1 on dave'])
      expect(after.html).toContain(t)
    expect(after.html).not.toContain('unsafe timeouts')
  } finally { await s.dispose() }
}, 60_000)

test('refund path: early refund → tx report NotExpired "Advance … then refund"; late claim → Expired; refunded report', async () => {
  const s = await setup()
  const { loadTxReport, TxReportView, XSwapReportView } = await import('../src/pages/XSwapReport')
  try {
    const secret = newSecret(), hash = hashOf(secret)
    await signAndSend(s.A, maker, tokenCall(s.gbp, 'approve', [s.lockA, 1000n]))
    const T = (await head(s.A)) + 5n
    await signAndSend(s.A, maker, lockCall(s.lockA, { token: s.gbp, amount: 1000n, recipient: taker.address, hash, timeoutBlock: T,
      wantChain: s.B.info.id, wantLock: s.lockB, wantToken: s.usd, wantAmount: 1270n }))
    const early = await signAndSend(s.A, maker, refundCall(s.lockA, 1n))
    expect(early.status).toBe('reverted')
    const n = T - (await head(s.A)) - 1n
    const r1 = await loadTxReport(s.A.request, early.hash, 'dave')
    expect(r1).toMatchObject({ ok: false, action: 'refund', id: 1n, error: { name: 'NotExpired', fix: `Advance dave ${n} blocks, then refund.` } })
    const html1 = await ssr(h => h(TxReportView, { r: r1, chainName: 'dave', people, assets: s.assets }))
    for (const t of ['Refund #1 failed', 'Reverted · NotExpired', `Advance dave ${n} blocks, then refund.`, 'Back to cross-chain swap', 'revert NotExpired(timeoutBlock: '])
      expect(html1).toContain(t)

    await s.A.mine(Number(T - (await head(s.A))))
    expect(await head(s.A)).toBe(T) // the claim lands at T + 1: past the timeout
    const late = await signAndSend(s.A, taker, claimCall(s.lockA, 1n, secret))
    const r2 = await loadTxReport(s.A.request, late.hash, 'dave')
    expect(r2).toMatchObject({ ok: false, action: 'claim', error: { name: 'Expired', fix: `The lock expired at block ${T}; it can no longer be claimed. The sender can refund it.` } })
    const html2 = await ssr(h => h(TxReportView, { r: r2, chainName: 'dave', people, assets: s.assets }))
    expect(html2).toContain('Claim #1 failed')
    expect(html2.toLowerCase()).not.toContain(secret.slice(2).toLowerCase()) // the tx carries it; the report doesn't show it

    const ok = await signAndSend(s.A, maker, refundCall(s.lockA, 1n))
    expect(ok.status).toBe('success')
    const r3 = await loadTxReport(s.A.request, ok.hash, 'dave')
    expect(r3).toMatchObject({ ok: true, action: 'refund', id: 1n, logs: ['Refunded #1'] })

    const sides = await sidesFor(s.A, s.B, hash)
    const rep = await swapReport(sides.a!, sides.b, hash)
    expect(rep.outcome).toBe('refunded (maker)')
    const html = await ssr(h => h(XSwapReportView, { r: rep, chains: s.chains, people, assets: s.assets }))
    for (const t of ['Cross-chain swap refunded', 'Nobody answered; alice got 10.00 GBP back on dave.', 'refunded (maker)', 'alice refunded #1 on dave', 'no balance changed'])
      expect(html).toContain(t)
    expect(html.toLowerCase()).not.toContain(secret.slice(2).toLowerCase())
  } finally { await s.dispose() }
}, 60_000)

// ---------- page ----------

test('Cross-chain swap sits under Markets after Swap; without a chain both pages say "Select a chain first."', async () => {
  const { createElement: h } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { MemoryRouter } = await import('react-router-dom')
  const { groups, real } = await import('../src/App')
  const { AppState } = await import('../src/state')
  const { AppBarProvider } = await import('../src/state/appBar')
  const { XSwapReport } = await import('../src/pages/XSwapReport')
  const markets = groups.find(g => g.label === 'Markets')!.items.map(([n]) => n)
  expect(markets.indexOf('Cross-chain swap')).toBe(markets.indexOf('Swap') + 1)
  for (const [path, el] of [['/xswap', real['Cross-chain swap']!], ['/xswap/report?hash=0x12', h(XSwapReport)]] as const)
    expect(renderToString(h(MemoryRouter, { initialEntries: [path] }, h(AppState, null, h(AppBarProvider, null, el))))).toContain('Select a chain first.')
})

test('Claim/Refund panel: the taker never sees the secret (Review Focus 2); the maker sees it masked with "Reveal"', async () => {
  const { ClaimRefund } = await import('../src/components/xswap/ClaimRefund')
  const secret = newSecret()
  const copy = { amtA: '10.00', base: 'GBP', chainA: 'dave', amtB: '12.70', quote: 'USD', chainB: 'sue' }
  const props = { copy, busy: false, onAction: async () => undefined, secret }
  const taker = await ssr(h => h(ClaimRefund, { ...props, role: 'taker', actions: ['claimA', 'refundB'] }))
  expect(taker.toLowerCase()).not.toContain(secret.slice(2).toLowerCase())
  for (const t of ['Claim 10.00 GBP on dave', 'Refund']) expect(taker).toContain(t)
  expect(taker).not.toContain('Reveal')
  const mk = await ssr(h => h(ClaimRefund, { ...props, role: 'maker', actions: ['claimB'] }))
  expect(mk.toLowerCase()).not.toContain(secret.slice(2).toLowerCase())
  for (const t of ['Claim 12.70 USD on sue (reveals the secret)', 'Reveal', maskSecret(secret)]) expect(mk).toContain(t)
})

test('links: the URL sync keeps chainB (and the swap) when it rewrites chain/as; a chain-B fix comes back to chain A', async () => {
  const { syncDecision, withParams } = await import('../src/links')
  const { requestFix } = await import('../src/fix')
  const d = syncDecision({ chain: null, as: null }, { chain: 'A', account: maker.address, loading: false }, {}, { chains: ['A', 'B'], accounts: people })
  expect(withParams('/xswap?chainB=B&hash=0x12&base=0x1', d.url!)).toBe('/xswap?chainB=B&hash=0x12&base=0x1&chain=A&as=alice')
  const usd = { id: 'u', chainId: 'B', kind: 'erc20', address: a(6), symbol: 'USD', name: 'USD', decimals: 2, issuer: maker.address } as any
  const fix = requestFix({ chainId: 'B', backChain: 'A', asset: usd, issuer: maker.address, recipient: taker.address, need: 500n, have: 0n, issuerHas: 1000n, back: '/xswap?chain=A&chainB=B', accounts: people })!
  expect(fix.label).toBe('Request 5 USD from alice')
  const sp = new URLSearchParams(fix.href.split('?')[1])
  expect([sp.get('chain'), sp.get('back')]).toEqual(['B', '/xswap?chain=A&chainB=B&as=bob'])
})

test('M4: a tx report\'s crumb returns to the swap through its safe `back`, as the fix link does', async () => {
  const { crumbTo } = await import('../src/pages/XSwapReport')
  const back = '/xswap?chain=A&chainB=B&hash=0x12&as=bob'
  expect(crumbTo(new URLSearchParams({ tx: '0xab', chain: 'B', back }))).toBe(back)
  expect(crumbTo(new URLSearchParams({ tx: '0xab', chain: 'B', back: '//evil.example' }))).toBe('/xswap')
  expect(crumbTo(new URLSearchParams({ hash: '0x12', chain: 'A', chainB: 'B' }))).toBe('/xswap?hash=0x12&chainB=B')
})

test('M6 (Review Focus 2): the page reads the secret only for the maker — the taker\'s view never asks kv, and so never shows it', async () => {
  const { makerSecret, XSwapPanels } = await import('../src/pages/XSwap')
  const secret = newSecret(), hash = hashOf(secret), asked: string[] = []
  const kv = async (h: Hex) => { asked.push(h); return { secret, chain: 'A', lockId: '1' } } // a mock secrets kv that has it
  expect(await makerSecret('taker', hash, kv)).toBeUndefined()
  expect(await makerSecret(undefined, hash, kv)).toBeUndefined()
  expect(asked).toEqual([])
  expect(await makerSecret('maker', hash, kv)).toBe(secret)
  expect(asked).toEqual([hash])
  // the page's panels as the taker sees them, even when handed the secret: never rendered
  const opening = lock({ hash, sender: MAKER, recipient: TAKER }), answer = answerOf({ hash, status: 'claimed', secret })
  const st = { ...state(opening, answer, 10n, 60n), b: true }
  const asTaker = { label: 'bob', address: TAKER }
  const html = await ssr(h => h(XSwapPanels, {
    chainA: { info: { id: 'A', name: 'dave' } }, chainB: { info: { id: 'B', name: 'sue' } }, chains: [{ id: 'A', name: 'dave' }, { id: 'B', name: 'sue' }],
    people: [{ label: 'alice', address: MAKER }, asTaker], acting: asTaker, tokA: [], tokB: [], lockA: { address: a(9), block: 1n }, lockB: { address: a(8), block: 1n },
    headA: 10n, headB: 60n, st, walletA: {}, walletB: {}, secret, working: false, mineErr: {}, on: {},
  } as any))
  expect(html).toContain('You are the taker')
  expect(html.toLowerCase()).not.toContain(secret.slice(2).toLowerCase())
})
