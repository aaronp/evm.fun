import { expect, test } from 'bun:test'
import { decodeFunctionData, encodeErrorResult, keccak256, zeroAddress, type Address, type Hex } from 'viem'
import { HashLock } from '@evmb/contracts'
import {
  canClaim, canRefund, claimCall, decodeHtlcError, hashLockAbi, hashOf, isSafe, lockCall, locksFor, newSecret, readLock, refundCall,
  swapReport, swapState, type Side,
} from '../src'
import { maker, other, taker, withChains, type K } from './chain'

const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const GBP = 100_000n // 1,000.00 GBP
const USD = 127_000_000n // 127 USD

test('embedded hashLockAbi equals the contracts package HashLock.abi', () => {
  expect(hashLockAbi as unknown).toEqual(HashLock.abi)
})

test('calls decode back; newSecret is 32 random bytes; hashOf is keccak256', () => {
  const l = lockCall(a(1), { token: a(2), amount: 5n, recipient: a(3), hash: `0x${'ab'.repeat(32)}`, timeoutBlock: 9n })
  expect(l.to).toBe(a(1))
  expect(decodeFunctionData({ abi: hashLockAbi, data: l.data }).args).toEqual(
    [a(2), 5n, a(3), `0x${'ab'.repeat(32)}`, 9n, '', zeroAddress, zeroAddress, 0n])
  const o = lockCall(a(1), { token: a(2), amount: 5n, recipient: a(3), hash: `0x${'ab'.repeat(32)}`, timeoutBlock: 9n,
    wantChain: 'sue', wantLock: a(4), wantToken: a(5), wantAmount: 7n })
  expect(decodeFunctionData({ abi: hashLockAbi, data: o.data }).args.slice(5)).toEqual(['sue', a(4), a(5), 7n])
  expect(decodeFunctionData({ abi: hashLockAbi, data: claimCall(a(1), 4n, `0x${'cd'.repeat(32)}`).data }))
    .toEqual({ functionName: 'claim', args: [4n, `0x${'cd'.repeat(32)}`] })
  expect(decodeFunctionData({ abi: hashLockAbi, data: refundCall(a(1), 9n).data })).toEqual({ functionName: 'refund', args: [9n] })
  const s = newSecret()
  expect(s).toMatch(/^0x[0-9a-f]{64}$/)
  expect(newSecret()).not.toBe(s)
  expect(hashOf(s)).toBe(keccak256(s))
})

test('isSafe: maker blocks left ≥ taker blocks left + margin', () => {
  expect(isSafe(100n, 0n, 90n, 0n)).toBe(true)
  expect(isSafe(100n, 0n, 91n, 0n)).toBe(false)
  expect(isSafe(150n, 50n, 1090n, 1000n)).toBe(true) // 100 left vs 90 left
  expect(isSafe(100n, 0n, 99n, 0n, 1n)).toBe(true)
  expect(isSafe(100n, 0n, 99n, 0n, 2n)).toBe(false)
})

type Env = Parameters<Parameters<typeof withChains>[0]>[0]
/** both sides with their current heads; B is 'sue' at lock.B unless overridden */
const sidesOf = (c: Env) => async (b: Partial<Side> = {}): Promise<[Side, Side]> => [
  { chain: 'dave', request: c.request.A, address: c.lock.A, head: await c.head('A'), fromBlock: c.deployed.A },
  { chain: 'sue', request: c.request.B, address: c.lock.B, head: await c.head('B'), fromBlock: c.deployed.B, ...b },
]
/** maker opens on A: GBP for USD on sue's HashLock, timeout = head A + `blocks` */
const open = async (c: Env, hash: Hex, blocks = 100n) => {
  const timeoutBlock = (await c.head('A')) + blocks
  const r = await c.send('A', maker, lockCall(c.lock.A, { token: c.gbp, amount: GBP, recipient: taker.address, hash, timeoutBlock,
    wantChain: 'sue', wantLock: c.lock.B, wantToken: c.usd, wantAmount: USD }))
  expect(r.status).toBe('success')
  return { ...r, timeoutBlock }
}
/** an answer on B (defaults: the taker locks USD to the maker, timeout = head B + `blocks`) */
const answer = async (c: Env, hash: Hex, o: { from?: typeof taker; token?: Address; amount?: bigint; to?: Address; at?: Address; blocks?: bigint } = {}) => {
  const timeoutBlock = (await c.head('B')) + (o.blocks ?? 50n)
  const r = await c.send('B', o.from ?? taker, lockCall(o.at ?? c.lock.B, { token: o.token ?? c.usd, amount: o.amount ?? USD,
    recipient: o.to ?? maker.address, hash, timeoutBlock }))
  expect(r.status).toBe('success')
  return { ...r, timeoutBlock }
}

test('claim path: offered → answered → claimedB → complete; report completed with both balance changes', () =>
  withChains(async c => {
    const sides = sidesOf(c)
    const secret = newSecret(), hash = hashOf(secret)
    const before = { mA: await c.bal('A', c.gbp, maker.address), tA: await c.bal('A', c.gbp, taker.address),
      mB: await c.bal('B', c.usd, maker.address), tB: await c.bal('B', c.usd, taker.address) }

    const o = await open(c, hash)
    let s = await swapState(...await sides(), hash)
    expect(s.phase).toBe('offered')
    expect(s.answer).toBeUndefined()
    expect(s.opening).toMatchObject({ id: 1n, chain: 'dave', address: c.lock.A, sender: maker.address, recipient: taker.address,
      token: c.gbp, amount: GBP, hash, timeoutBlock: o.timeoutBlock, status: 'locked', wantChain: 'sue', wantLock: c.lock.B,
      wantToken: c.usd, wantAmount: USD, lockedBlock: o.block, lockedTx: o.hash })
    expect(s.blocksLeft.a).toBe(o.timeoutBlock - (await c.head('A')))
    expect(s.blocksLeft.b).toBeUndefined()
    // the taker finds it by recipient; the maker by sender
    expect((await locksFor(c.request.A, c.lock.A, c.deployed.A, { recipient: taker.address })).map(l => l.id)).toEqual([1n])
    expect((await locksFor(c.request.A, c.lock.A, c.deployed.A, { sender: taker.address }))).toEqual([])
    expect((await locksFor(c.request.A, c.lock.A, c.deployed.A, { sender: maker.address, hash })).map(l => l.id)).toEqual([1n])
    expect(await readLock(c.request.A, c.lock.A, 1n, 'dave')).toMatchObject({ id: 1n, chain: 'dave', status: 'locked', amount: GBP })

    const an = await answer(c, hash)
    s = await swapState(...await sides(), hash)
    expect(s.phase).toBe('answered')
    expect(s.safe).toBe(true)
    expect(s.answer).toMatchObject({ id: 1n, chain: 'sue', sender: taker.address, recipient: maker.address, token: c.usd,
      amount: USD, timeoutBlock: an.timeoutBlock, status: 'locked', wantChain: '', lockedBlock: an.block })
    expect(s.blocksLeft.b).toBe(an.timeoutBlock - (await c.head('B')))
    let r = await swapReport(...await sides(), hash)
    expect(r.secret).toBeUndefined() // not before the B-side claim
    expect(JSON.stringify(r)).not.toContain(secret.slice(2))
    expect(r.outcome).toBe('stuck')
    expect(r.stillLocked).toEqual([{ chain: 'dave', id: '1', timeoutBlock: String(o.timeoutBlock) },
      { chain: 'sue', id: '1', timeoutBlock: String(an.timeoutBlock) }])

    const cb = await c.send('B', maker, claimCall(c.lock.B, 1n, secret))
    expect(cb.status).toBe('success')
    s = await swapState(...await sides(), hash)
    expect(s.phase).toBe('claimedB')
    expect(s.answer!.secret).toBe(secret) // the taker reads it from chain B
    r = await swapReport(...await sides(), hash)
    expect(r.secret).toBe(secret)

    const ca = await c.send('A', taker, claimCall(c.lock.A, 1n, s.answer!.secret))
    expect(ca.status).toBe('success')
    s = await swapState(...await sides(), hash)
    expect(s.phase).toBe('complete')
    r = await swapReport(...await sides(), hash)
    expect(r.outcome).toBe('completed')
    expect(r.unsafe).toBe(false)
    expect(r.secret).toBe(secret)
    expect(r.stillLocked).toEqual([])
    expect(r.steps).toEqual([
      { chain: 'dave', action: 'lock', side: 'maker', id: '1', tx: o.hash, block: String(o.block) },
      { chain: 'sue', action: 'lock', side: 'taker', id: '1', tx: an.hash, block: String(an.block) },
      { chain: 'sue', action: 'claim', side: 'maker', id: '1', tx: cb.hash, block: String(cb.block) },
      { chain: 'dave', action: 'claim', side: 'taker', id: '1', tx: ca.hash, block: String(ca.block) },
    ])
    expect(r.balanceChanges).toEqual([
      { chain: 'dave', holder: maker.address, token: c.gbp, delta: String(-GBP) },
      { chain: 'dave', holder: taker.address, token: c.gbp, delta: String(GBP) },
      { chain: 'sue', holder: taker.address, token: c.usd, delta: String(-USD) },
      { chain: 'sue', holder: maker.address, token: c.usd, delta: String(USD) },
    ])
    // the report's changes are the chains' real changes
    expect(await c.bal('A', c.gbp, maker.address)).toBe(before.mA - GBP)
    expect(await c.bal('A', c.gbp, taker.address)).toBe(before.tA + GBP)
    expect(await c.bal('B', c.usd, maker.address)).toBe(before.mB + USD)
    expect(await c.bal('B', c.usd, taker.address)).toBe(before.tB - USD)
    expect(r.opening).toMatchObject({ id: '1', chain: 'dave', amount: String(GBP), status: 'claimed', timeoutBlock: String(o.timeoutBlock) })
    expect(r.answer).toMatchObject({ id: '1', chain: 'sue', amount: String(USD), status: 'claimed' })
    expect((r.opening as any).secret).toBeUndefined() // the secret appears once, top level
    expect(() => JSON.stringify(r)).not.toThrow()
  }), 120_000)

test('refund path: no answer, expiring near the timeout, NotExpired fix, refundedA and refunded (maker)', () =>
  withChains(async c => {
    const sides = sidesOf(c)
    const hash = hashOf(newSecret())
    const before = await c.bal('A', c.gbp, maker.address)
    const o = await open(c, hash, 20n)
    expect((await swapState(...await sides(), hash)).phase).toBe('offered')
    // 11 blocks left → still offered; 10 left → expiring
    await c.mine('A', o.timeoutBlock - 11n - (await c.head('A')))
    expect((await swapState(...await sides(), hash)).phase).toBe('offered')
    await c.mine('A', 1)
    const s = await swapState(...await sides(), hash)
    expect(s.phase).toBe('expiring')
    expect(s.blocksLeft.a).toBe(10n)
    // the fix copy's block count is exact: advance n, then the refund lands at the timeout block
    const head = await c.head('A')
    const err = decodeHtlcError(await c.revertData('A', maker, refundCall(c.lock.A, 1n)), { chain: 'dave', head })!
    expect(err).toMatchObject({ name: 'NotExpired', args: { timeoutBlock: o.timeoutBlock } })
    const n = o.timeoutBlock - head - 1n
    expect(err.fix).toBe(`Advance dave ${n} blocks, then refund.`)
    await c.mine('A', n - 1n)
    expect((await c.send('A', maker, refundCall(c.lock.A, 1n))).status).toBe('reverted') // one block short
    const rf = await c.send('A', maker, refundCall(c.lock.A, 1n))
    expect(rf.status).toBe('success')
    expect(rf.block).toBe(o.timeoutBlock) // the reverted try mined at timeout − 1
    expect(await c.bal('A', c.gbp, maker.address)).toBe(before)

    expect((await swapState(...await sides(), hash)).phase).toBe('refundedA')
    const r = await swapReport(...await sides(), hash)
    expect(r.outcome).toBe('refunded (maker)')
    expect(r.answer).toBeUndefined()
    expect(r.unsafe).toBe(false)
    expect(r.balanceChanges).toEqual([]) // locked and refunded: net zero
    expect(r.steps).toEqual([
      { chain: 'dave', action: 'lock', side: 'maker', id: '1', tx: o.hash, block: String(o.block) },
      { chain: 'dave', action: 'refund', side: 'maker', id: '1', tx: rf.hash, block: String(rf.block) },
    ])
    // without B, the state still works
    expect((await swapState((await sides())[0], undefined, hash)).phase).toBe('refundedA')
  }), 120_000)

test('refunds on both sides → refundedBoth; taker-only refund while A is locked → refundedB, outcome stuck', () =>
  withChains(async c => {
    const sides = sidesOf(c)
    const hash = hashOf(newSecret())
    const o = await open(c, hash, 40n)
    const an = await answer(c, hash, { blocks: 15n })
    await c.mine('B', an.timeoutBlock - 1n - (await c.head('B')))
    expect((await c.send('B', taker, refundCall(c.lock.B, 1n))).status).toBe('success')
    let s = await swapState(...await sides(), hash)
    expect(s.phase).toBe('refundedB')
    let r = await swapReport(...await sides(), hash)
    expect(r.outcome).toBe('stuck')
    expect(r.stillLocked).toEqual([{ chain: 'dave', id: '1', timeoutBlock: String(o.timeoutBlock) }])
    expect(r.balanceChanges).toEqual([
      { chain: 'dave', holder: maker.address, token: c.gbp, delta: String(-GBP) },
      { chain: 'dave', holder: c.lock.A, token: c.gbp, delta: String(GBP) },
    ])
    await c.mine('A', o.timeoutBlock - 1n - (await c.head('A')))
    expect((await c.send('A', maker, refundCall(c.lock.A, 1n))).status).toBe('success')
    s = await swapState(...await sides(), hash)
    expect(s.phase).toBe('refundedBoth')
    r = await swapReport(...await sides(), hash)
    expect(r.outcome).toBe('refunded (both)')
    expect(r.steps.map(x => `${x.chain} ${x.action} ${x.side}`)).toEqual(
      ['dave lock maker', 'sue lock taker', 'sue refund taker', 'dave refund maker'])
  }), 120_000)

test('taker misses the window (safe timeouts): claimedB not masked by expiring, flags at 2 and 1 blocks left, taker lost', () =>
  withChains(async c => {
    const sides = sidesOf(c)
    const secret = newSecret(), hash = hashOf(secret)
    const o = await open(c, hash, 40n)
    const an = await answer(c, hash, { blocks: 15n })
    let s = await swapState(...await sides(), hash)
    expect(s.safe).toBe(true)
    expect(s.claimable).toEqual({ a: true, b: true })
    expect(s.refundable).toEqual({ a: false, b: false })
    expect((await c.send('B', maker, claimCall(c.lock.B, 1n, secret))).status).toBe('success')
    expect(s = await swapState(...await sides(), hash)).toMatchObject({ phase: 'claimedB', claimable: { a: true, b: false }, refundable: { a: false, b: false } })
    // the taker is slow: A runs down to 2 blocks left (inside the expiring margin), claimedB still wins
    await c.mine('A', o.timeoutBlock - 2n - (await c.head('A')))
    s = await swapState(...await sides(), hash)
    expect(s).toMatchObject({ phase: 'claimedB', blocksLeft: { a: 2n }, claimable: { a: true }, refundable: { a: false } })
    await c.mine('A', 1)
    s = await swapState(...await sides(), hash)
    expect(s).toMatchObject({ phase: 'claimedB', blocksLeft: { a: 1n }, claimable: { a: false }, refundable: { a: true } })
    // the flags agree with the chain: a claim sent now mines at the timeout block and reverts (eth_call at 'latest'
    // runs at the head, so it would still pass); the refund after it succeeds
    const late = await c.send('A', taker, claimCall(c.lock.A, 1n, secret))
    expect([late.status, late.block]).toEqual(['reverted', o.timeoutBlock])
    expect((await c.send('A', maker, refundCall(c.lock.A, 1n))).status).toBe('success')
    expect((await swapState(...await sides(), hash)).phase).toBe('refundedA')
    const r = await swapReport(...await sides(), hash)
    expect(r.outcome).toBe('taker lost')
    expect(r.unsafe).toBe(false)
    expect(r.balanceChanges).toEqual([
      { chain: 'sue', holder: taker.address, token: c.usd, delta: String(-USD) },
      { chain: 'sue', holder: maker.address, token: c.usd, delta: String(USD) },
    ])
    void an
  }), 120_000)

test('maker lost: A claimed (secret leaked), B refunded; A claimed with no answer reads completed', () =>
  withChains(async c => {
    const sides = sidesOf(c)
    const secret = newSecret(), hash = hashOf(secret)
    await open(c, hash, 40n)
    const an = await answer(c, hash, { blocks: 15n })
    expect((await c.send('A', taker, claimCall(c.lock.A, 1n, secret))).status).toBe('success')
    expect((await swapState(...await sides(), hash)).phase).toBe('complete')
    await c.mine('B', an.timeoutBlock - 1n - (await c.head('B')))
    expect((await c.send('B', taker, refundCall(c.lock.B, 1n))).status).toBe('success')
    expect((await swapReport(...await sides(), hash)).outcome).toBe('maker lost')
    // the same chains read without B: A claimed is completed
    const [sa] = await sides()
    expect((await swapState(sa, undefined, hash)).phase).toBe('complete')
    expect((await swapReport(sa, undefined, hash)).outcome).toBe('completed')
  }), 120_000)

test('stray locks never pair (Review Focus 3): third account, wrong token/amount/recipient, other HashLock, offer-shaped, other chain', () =>
  withChains(async c => {
    const sides = sidesOf(c)
    const secret = newSecret(), hash = hashOf(secret)
    await open(c, hash)
    const lockB2 = await c.deploy('B', HashLock, [])
    await c.erc('B', taker, c.usd, 'approve', [lockB2, 2n ** 255n])
    await answer(c, hash, { from: other }) // a third account, same hash, right terms
    await answer(c, hash, { token: c.eur }) // wrong token
    await answer(c, hash, { amount: USD - 1n }) // short amount
    await answer(c, hash, { to: other.address }) // wrong recipient
    await answer(c, hash, { at: lockB2 }) // right terms on a HashLock the offer didn't name
    // an offer-shaped lock (terms set) is not an answer
    await c.send('B', taker, lockCall(c.lock.B, { token: c.usd, amount: USD, recipient: maker.address, hash,
      timeoutBlock: (await c.head('B')) + 50n, wantChain: 'dave', wantLock: c.lock.A, wantToken: c.gbp, wantAmount: GBP }))
    await answer(c, keccak256('0x01')) // right parties and terms, another hash
    let s = await swapState(...await sides(), hash)
    expect(s.phase).toBe('offered')
    expect(s.answer).toBeUndefined()
    expect(s.safe).toBeUndefined()
    // the right answer on B2 doesn't count even when B is pointed at B2
    expect((await swapState(...await sides({ address: lockB2 }), hash)).answer).toBeUndefined()

    const right = await answer(c, hash, { amount: USD + 1n }) // more than asked is fine
    s = await swapState(...await sides(), hash)
    expect(s.phase).toBe('answered')
    expect(s.answer).toMatchObject({ id: 7n, amount: USD + 1n, lockedTx: right.hash })
    // the same answer read as another chain doesn't pair
    expect((await swapState(...await sides({ chain: 'bob' }), hash)).answer).toBeUndefined()
    const r = await swapReport(...await sides(), hash)
    expect(r.steps.map(x => `${x.chain}#${x.id}`)).toEqual(['dave#1', 'sue#7'])
    expect(r.stillLocked.map(x => `${x.chain}#${x.id}`)).toEqual(['dave#1', 'sue#7'])
    // claiming a stray (the third account's lock pays the maker too) doesn't move the swap's phase
    await c.send('B', maker, claimCall(c.lock.B, 1n, secret))
    expect((await swapState(...await sides(), hash)).phase).toBe('answered')
  }), 120_000)

test('unsafe pair → safe false and the report flag; headAAtAnswer judges with A’s real head', () =>
  withChains(async c => {
    const sides = sidesOf(c)
    let hash = hashOf(newSecret())
    await open(c, hash, 30n) // maker: 29 blocks left after its lock
    await answer(c, hash, { blocks: 50n }) // taker: 49 left
    expect((await swapState(...await sides(), hash)).safe).toBe(false)
    expect((await swapReport(...await sides(), hash)).unsafe).toBe(true)

    // second swap: safe at the lock blocks, but A advanced 60 blocks before B answered
    hash = hashOf(newSecret())
    await open(c, hash, 100n)
    await c.mine('A', 60)
    await answer(c, hash, { blocks: 50n })
    const [sa, sb] = await sides()
    expect((await swapState(sa, sb, hash)).safe).toBe(false) // judged with the heads now
    expect((await swapReport(sa, sb, hash)).unsafe).toBe(false) // the proxy: each from its own lock block
    expect((await swapReport(sa, sb, hash, { headAAtAnswer: sa.head })).unsafe).toBe(true)
  }), 120_000)

test('decodeHtlcError decodes every HashLock and ERC-20 error from real revert data, with fix copy', () =>
  withChains(async c => {
    const secret = newSecret(), hash = hashOf(secret)
    const T = (await c.head('A')) + 30n
    const d = async (k: K, from: typeof maker, call: { to: Address; data: Hex }, ctx?: Parameters<typeof decodeHtlcError>[1]) =>
      decodeHtlcError(await c.revertData(k, from, call), ctx)
    const lk = (amount: bigint) => lockCall(c.lock.A, { token: c.gbp, amount, recipient: taker.address, hash, timeoutBlock: T })

    expect(await d('A', maker, lk(0n))).toEqual({ name: 'BadLock', args: {},
      fix: 'Check the lock: a non-zero amount and recipient, a timeout after the current block, and for an offer the wanted token and HashLock.' })
    expect(await d('A', maker, claimCall(c.lock.A, 9n, secret))).toEqual({ name: 'NotLocked', args: { id: 9n, status: 0 },
      fix: 'There is no lock #9 on this HashLock.' })
    await c.send('A', maker, lk(GBP))
    expect(await d('A', maker, claimCall(c.lock.A, 1n, secret))).toEqual({ name: 'NotRecipient', args: {},
      fix: 'Only the lock’s recipient can claim it. Act as the recipient.' })
    expect(await d('A', taker, claimCall(c.lock.A, 1n, `0x${'cd'.repeat(32)}`))).toEqual({ name: 'BadSecret', args: {},
      fix: 'The secret doesn’t match the lock’s hash. Use the secret revealed by the claim on the other chain.' })
    expect(await d('A', taker, refundCall(c.lock.A, 1n))).toEqual({ name: 'NotSender', args: {},
      fix: 'Only the lock’s sender can refund it. Act as the sender.' })
    expect(await d('A', maker, refundCall(c.lock.A, 1n))).toEqual({ name: 'NotExpired', args: { timeoutBlock: T },
      fix: `Refund from block ${T}.` }) // no chain/head given
    await c.mine('A', T - (await c.head('A')))
    expect(await d('A', taker, claimCall(c.lock.A, 1n, secret))).toEqual({ name: 'Expired', args: { timeoutBlock: T },
      fix: `The lock expired at block ${T}; it can no longer be claimed. The sender can refund it.` })
    await c.send('A', maker, refundCall(c.lock.A, 1n))
    expect(await d('A', maker, refundCall(c.lock.A, 1n))).toMatchObject({ name: 'NotLocked', args: { id: 1n, status: 3 },
      fix: 'Lock #1 was already refunded.' })

    // ERC-20: the taker holds no GBP on A and hasn't approved
    const T2 = (await c.head('A')) + 30n
    const tl = lockCall(c.lock.A, { token: c.gbp, amount: 500n, recipient: maker.address, hash, timeoutBlock: T2 })
    expect(await d('A', taker, tl, { token: c.gbp })).toEqual({ name: 'ERC20InsufficientAllowance',
      args: { spender: c.lock.A, allowance: 0n, needed: 500n },
      fix: `Approve HashLock to spend at least {amount:${c.gbp}:500}, then lock again.` })
    await c.erc('A', taker, c.gbp, 'approve', [c.lock.A, 10n ** 9n])
    expect(await d('A', taker, tl)).toEqual({ name: 'ERC20InsufficientBalance',
      args: { sender: taker.address, balance: 0n, needed: 500n },
      fix: 'Get at least 500 into the sender’s wallet, then lock again.' })
  }), 120_000)

test('decodeHtlcError: claimed NotLocked, OZ guard errors, Error/Panic, unknown data', () => {
  const nl = encodeErrorResult({ abi: hashLockAbi, errorName: 'NotLocked', args: [2n, 2] })
  expect(decodeHtlcError(nl)!.fix).toBe('Lock #2 was already claimed.')
  expect(decodeHtlcError(encodeErrorResult({ abi: hashLockAbi, errorName: 'SafeERC20FailedOperation', args: [a(7)] })))
    .toEqual({ name: 'SafeERC20FailedOperation', args: { token: a(7) }, fix: 'The token transfer failed: the token is not a standard ERC-20.' })
  expect(decodeHtlcError(encodeErrorResult({ abi: hashLockAbi, errorName: 'ReentrancyGuardReentrantCall' })))
    .toEqual({ name: 'ReentrancyGuardReentrantCall', args: {}, fix: 'HashLock refused a reentrant call.' })
  const abi = [
    { type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] },
    { type: 'error', name: 'Panic', inputs: [{ name: 'code', type: 'uint256' }] },
  ] as const
  expect(decodeHtlcError(encodeErrorResult({ abi, errorName: 'Error', args: ['nope'] }))).toEqual({ name: 'Error', args: { message: 'nope' }, fix: 'The transaction reverted: nope' })
  expect(decodeHtlcError(encodeErrorResult({ abi, errorName: 'Panic', args: [0x11n] }))).toEqual({ name: 'Panic', args: { code: 0x11n }, fix: 'The contract panicked (code 17).' })
  expect(decodeHtlcError('0x')).toBeUndefined()
  expect(decodeHtlcError('0xdeadbeef')).toBeUndefined()
  // a zero-block advance reads as "refund now"
  const ne = encodeErrorResult({ abi: hashLockAbi, errorName: 'NotExpired', args: [10n] })
  expect(decodeHtlcError(ne, { chain: 'dave', head: 9n })!.fix).toBe('Refund now: the next block on dave is the timeout block.')
  expect(decodeHtlcError(ne, { chain: 'dave', head: 7n })!.fix).toBe('Advance dave 2 blocks, then refund.')
  expect(decodeHtlcError(ne, { chain: 'dave', head: 8n })!.fix).toBe('Advance dave 1 block, then refund.')
})

test('canClaim / canRefund: a tx mines at head + 1', () => {
  const l = { status: 'locked', timeoutBlock: 10n } as const
  expect([canClaim(l, 8n), canRefund(l, 8n)]).toEqual([true, false]) // blocksLeft 2
  expect([canClaim(l, 9n), canRefund(l, 9n)]).toEqual([false, true]) // blocksLeft 1
  expect([canClaim({ ...l, status: 'claimed' }, 0n), canRefund({ ...l, status: 'refunded' }, 20n)]).toEqual([false, false])
})
