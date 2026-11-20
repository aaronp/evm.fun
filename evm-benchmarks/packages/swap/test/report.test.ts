import { expect, test } from 'bun:test'
import { AssetToken, Swap } from '@evmb/contracts'
import create from '@evmb/approach-02-seq-memory'
import { encodeDeployData, encodeFunctionData, keccak256, type Address, type Hex } from 'viem'
import { fillText, precedes, takeReport, type TakeReport } from '../src'
import { maker, other, taker, withSwap } from './chain'

const erc = AssetToken.abi
const GIVE = 50_000n // 500.00 GBP
const GET = 635_000_000n // 635.00 USD

/** maker offers 500.00 GBP for 635.00 USD as #1 */
const offer = async (c: Parameters<Parameters<typeof withSwap>[0]>[0]) => {
  await c.send(maker, c.gbp, erc, 'approve', [c.swap, GIVE])
  await c.send(maker, c.swap, Swap.abi, 'makeOffer', [c.gbp, GIVE, c.usd, GET])
}
const marks = (r: TakeReport) => r.steps.map(s => s.mark)
const blockOf = async (request: (m: string, p: unknown[]) => Promise<unknown>, h: Hex) =>
  BigInt(((await request('eth_getTransactionReceipt', [h])) as { blockNumber: Hex }).blockNumber)

test('successful take: steps, balance changes, gas', () =>
  withSwap(async c => {
    await offer(c)
    await c.send(taker, c.usd, erc, 'approve', [c.swap, GET])
    const h = await c.tx(taker, c.swap, Swap.abi, 'take', [1n])
    const r = await takeReport(c.request, h)
    expect(r).toMatchObject({ outcome: 'taken', tx: h, swap: c.swap, taker: taker.address, block: await blockOf(c.request, h), txIndex: 0 })
    expect(r.offer).toMatchObject({ id: 1n, maker: maker.address, status: 'filled' })
    expect(r.reason).toBeUndefined()
    expect(r.gasUsed).toBeGreaterThan(0n)
    expect(marks(r)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
    expect(r.steps.every(s => s.ok)).toBe(true)
    expect(r.steps.map(s => [s.title, s.evidence])).toEqual([
      ['Offer #1 made', 'earlier · OfferMade'],
      [`take(1) sent by {name:${taker.address}}`, `block ${r.block}`],
      [`Pay leg · {amount:${c.usd}:${GET}}`, 'transferFrom'],
      [`Deliver leg · {amount:${c.gbp}:${GIVE}}`, 'transfer'],
      ['Offer closed', 'OfferTaken'],
    ])
    expect(r.balanceChanges).toHaveLength(4)
    expect(r.balanceChanges).toEqual(expect.arrayContaining([
      { holder: taker.address, token: c.gbp, delta: GIVE },
      { holder: taker.address, token: c.usd, delta: -GET },
      { holder: maker.address, token: c.usd, delta: GET },
      { holder: c.swap, token: c.gbp, delta: -GIVE },
    ]))
    expect(r.logs).toContain(`OfferTaken(id: 1, taker: {name:${taker.address}})`)
    const names: Record<string, string> = { [taker.address]: 'tester', [maker.address]: 'me', [c.swap]: 'Swap' }
    const fmt = {
      name: (a: Address) => names[a] ?? a,
      symbol: (t: Address) => (t === c.usd ? 'USD' : 'GBP'),
      amount: (v: bigint, t: Address) => `${t === c.usd ? Number(v) / 1e6 : Number(v) / 100} ${t === c.usd ? 'USD' : 'GBP'}`,
      price: () => '1.2700',
    }
    expect(fillText(r.summary, fmt)).toBe('tester paid 635 USD and received 500 GBP from escrow, atomically in one transaction.')
    expect(r.title).toBe('Offer #1 taken')
    expect(r.pill).toBe('Settled · 1 transaction')
    expect(r.fix).toBeUndefined()
  }), 60_000)

test('short allowance: decoded error, fix copy, nothing moved (reconstructed at latest without state history)', () =>
  withSwap(async c => {
    await offer(c)
    await c.send(taker, c.usd, erc, 'approve', [c.swap, GET - 1n])
    const h = await c.tx(taker, c.swap, Swap.abi, 'take', [1n])
    const r = await takeReport(c.request, h)
    expect(r).toMatchObject({ outcome: 'reverted', reason: 'allowance', reconstructedNow: true, balanceChanges: [] })
    expect(r.error).toMatchObject({ name: 'ERC20InsufficientAllowance', args: { spender: c.swap, allowance: GET - 1n, needed: GET } })
    expect(r.error!.raw).toMatch(/^0xfb8f41b2/)
    expect(marks(r)).toEqual(['ok', 'ok', 'fail', 'skip', 'undo'])
    expect(r.steps[2]).toMatchObject({ title: 'Pay leg reverted', evidence: 'transferFrom', ok: false })
    expect(r.steps[2]!.detail).toBe(`ERC20InsufficientAllowance(\n  spender:   {name:${c.swap}},\n  allowance: {amount:${c.usd}:${GET - 1n}},\n  needed:    {amount:${c.usd}:${GET}}\n)`)
    expect(r.fix!.text).toBe(`Approve Swap to spend at least {amount:${c.usd}:${GET}} from {name:${taker.address}}, then take the offer again. It is still open at the same price.`)
    expect(r.pill).toBe('Reverted · allowance')
    expect(r.offer.status).toBe('open')
  }), 60_000)

test('short allowance replayed at the parent block when the node keeps state history', () =>
  withSwap(async c => {
    await offer(c)
    const h = await c.tx(taker, c.swap, Swap.abi, 'take', [1n])
    await c.send(taker, c.usd, erc, 'approve', [c.swap, GET]) // a replay at latest would now succeed
    const r = await takeReport(c.request, h)
    expect(r.reason).toBe('allowance')
    expect(r.reconstructedNow).toBeUndefined()
    expect(r.error).toMatchObject({ name: 'ERC20InsufficientAllowance', args: { allowance: 0n, needed: GET } })
  }, { stateHistory: 64 }), 60_000)

test('short balance: ERC20InsufficientBalance', () =>
  withSwap(async c => {
    await c.send(maker, c.gbp, erc, 'approve', [c.swap, 100n])
    await c.send(maker, c.swap, Swap.abi, 'makeOffer', [c.gbp, 100n, c.usd, 6_000_000_000n]) // taker holds 5,000 USD
    await c.send(taker, c.usd, erc, 'approve', [c.swap, 10n ** 10n])
    const r = await takeReport(c.request, await c.tx(taker, c.swap, Swap.abi, 'take', [1n]))
    expect(r).toMatchObject({ outcome: 'reverted', reason: 'balance', balanceChanges: [] })
    expect(r.error).toMatchObject({ name: 'ERC20InsufficientBalance', args: { sender: taker.address, balance: 5_000_000_000n, needed: 6_000_000_000n } })
    expect(marks(r)).toEqual(['ok', 'ok', 'fail', 'skip', 'undo'])
  }), 60_000)

test('take after cancel: reason cancelled, winner is the cancel tx', () =>
  withSwap(async c => {
    await offer(c)
    const cancel = await c.tx(maker, c.swap, Swap.abi, 'cancel', [1n])
    await c.send(taker, c.usd, erc, 'approve', [c.swap, GET])
    const r = await takeReport(c.request, await c.tx(taker, c.swap, Swap.abi, 'take', [1n]))
    expect(r).toMatchObject({ outcome: 'reverted', reason: 'cancelled', error: { name: 'OfferNotOpen', args: { id: 1n, status: 3 } } })
    expect(r.winner).toEqual({ block: await blockOf(c.request, cancel), tx: cancel, sameBlock: false })
    expect(r.reconstructedNow).toBeUndefined()
    expect(marks(r)).toEqual(['ok', 'ok', 'fail', 'skip', 'undo'])
    expect(r.steps[1]!.title).toBe(`{name:${maker.address}} cancelled #1`)
    expect(r.steps[2]!.detail).toBe('OfferNotOpen(\n  id:     1,\n  status: Cancelled\n)')
  }), 60_000)

test('take after another take in an earlier block: reason filled, winner named', () =>
  withSwap(async c => {
    await offer(c)
    await c.send(maker, c.usd, erc, 'transfer', [other.address, GET])
    await c.send(other, c.usd, erc, 'approve', [c.swap, GET])
    const won = await c.tx(other, c.swap, Swap.abi, 'take', [1n])
    await c.send(taker, c.usd, erc, 'approve', [c.swap, GET])
    const r = await takeReport(c.request, await c.tx(taker, c.swap, Swap.abi, 'take', [1n]))
    expect(r).toMatchObject({ outcome: 'reverted', reason: 'filled', error: { name: 'OfferNotOpen', args: { id: 1n, status: 2 } } })
    expect(r.winner).toEqual({ taker: other.address, block: await blockOf(c.request, won), tx: won, sameBlock: false })
    expect(r.steps[1]).toMatchObject({ title: 'Someone else took #1 first', evidence: `block ${r.winner!.block}` })
  }), 60_000)

test('same block (approach 02, manual mining): the second take reports filled by the first', async () => {
  const a = create({ workers: '1' })
  try {
    await a.setup({ prefund: { [maker.address]: 10n ** 21n, [taker.address]: 10n ** 21n, [other.address]: 10n ** 21n } })
    const nonce = new Map<string, number>()
    const sign = (acct: typeof maker, to: Address | undefined, data: Hex) => {
      const n = nonce.get(acct.address) ?? 0
      nonce.set(acct.address, n + 1)
      return acct.signTransaction({
        type: 'eip1559', chainId: 31337, nonce: n, ...(to && { to }), data,
        gas: 3_000_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
      })
    }
    const run = async (raws: Hex[]) => {
      await a.submit(raws)
      return a.awaitSettled(raws.map(r => keccak256(r)))
    }
    const deploy = async (c: { abi: any; bytecode: Hex }, args: unknown[]) =>
      (await run([await sign(maker, undefined, encodeDeployData({ abi: c.abi, bytecode: c.bytecode, args }))]))[0]!.contractAddress!
    const call = (acct: typeof maker, to: Address, abi: any, functionName: string, args: unknown[]) =>
      sign(acct, to, encodeFunctionData({ abi, functionName, args }))
    const gbp = await deploy(AssetToken, ['British Pound', 'GBP', 2, 1_000_000n, maker.address])
    const usd = await deploy(AssetToken, ['US Dollar', 'USD', 6, 10_000_000_000n, maker.address])
    const swap = await deploy(Swap, [])
    const setup = await run([
      await call(maker, usd, erc, 'transfer', [taker.address, GET]),
      await call(maker, usd, erc, 'transfer', [other.address, GET]),
      await call(maker, gbp, erc, 'approve', [swap, GIVE]),
      await call(maker, swap, Swap.abi, 'makeOffer', [gbp, GIVE, usd, GET]),
      await call(taker, usd, erc, 'approve', [swap, GET]),
      await call(other, usd, erc, 'approve', [swap, GET]),
    ])
    expect(setup.map(r => r.status)).toEqual(Array(6).fill('success'))
    const first = await call(other, swap, Swap.abi, 'take', [1n])
    const second = await call(taker, swap, Swap.abi, 'take', [1n])
    expect((await run([first, second])).map(r => r.status)).toEqual(['success', 'reverted'])
    const request = (m: string, p: unknown[]) => a.request!(m, p)
    const [b1, b2] = await Promise.all([blockOf(request, keccak256(first)), blockOf(request, keccak256(second))])
    expect(b1).toBe(b2)
    const r = await takeReport(request, keccak256(second))
    expect(r).toMatchObject({ outcome: 'reverted', reason: 'filled', txIndex: 1 })
    expect(r.winner).toEqual({ taker: other.address, block: b1, tx: keccak256(first), sameBlock: true })
    expect(r.steps[1]!.evidence).toBe(`earlier in block ${b1}`)
    // the winner is the offer's own stored taker and block, not a log reconstruction
    expect(r.winner!.taker).toBe(r.offer.taker)
    expect(r.winner!.block).toBe(r.offer.filledBlock!)
  } finally {
    await a.dispose()
  }
}, 60_000)

test('precedes orders by block, then tx index', () => {
  const p = (block: bigint, txIndex: number) => ({ block, txIndex })
  expect(precedes(p(1n, 5), p(2n, 0))).toBe(true)
  expect(precedes(p(2n, 0), p(1n, 5))).toBe(false)
  expect(precedes(p(3n, 0), p(3n, 1))).toBe(true)
  expect(precedes(p(3n, 1), p(3n, 0))).toBe(false)
  expect(precedes(p(3n, 1), p(3n, 1))).toBe(false)
})

test('a tx that is not take(id) is refused', () =>
  withSwap(async c => {
    const h = await c.tx(maker, c.gbp, erc, 'approve', [c.swap, 1n])
    await expect(takeReport(c.request, h)).rejects.toThrow('Not a Swap take')
  }), 60_000)

test('fillText substitutes names, symbols, amounts and prices', () => {
  const A = '0x00000000000000000000000000000000000000aA' as Address
  const fmt = { name: () => 'me', symbol: () => 'USD', amount: (v: bigint) => `${v}u`, price: (...a: unknown[]) => a.join('/') }
  expect(fillText(`{name:${A}} has {amount:${A}:12} {symbol:${A}} at {price:${A}:1:${A}:2}`, fmt))
    .toBe(`me has 12u USD at ${A}/1/${A}/2`)
})

test('latest fallback: an offer filled after the revert is not reported as the reason', () =>
  withSwap(async c => {
    await offer(c)
    const h = await c.tx(taker, c.swap, Swap.abi, 'take', [1n]) // no allowance
    await c.send(maker, c.usd, erc, 'transfer', [other.address, GET])
    await c.send(other, c.usd, erc, 'approve', [c.swap, GET])
    await c.send(other, c.swap, Swap.abi, 'take', [1n])
    const r = await takeReport(c.request, h)
    expect(r).toMatchObject({ reason: 'other', reconstructedNow: true })
    expect(r.winner).toBeUndefined()
    expect(r.summary).toBe('The reason couldn’t be reconstructed: offer #1 has since been filled, so replaying the take now fails differently. Nothing moved.')
  }), 60_000)

test('allowance revert on an offer filled since: no "still open" copy', () =>
  withSwap(async c => {
    await offer(c)
    const h = await c.tx(taker, c.swap, Swap.abi, 'take', [1n])
    await c.send(maker, c.usd, erc, 'transfer', [other.address, GET])
    await c.send(other, c.usd, erc, 'approve', [c.swap, GET])
    await c.send(other, c.swap, Swap.abi, 'take', [1n])
    const r = await takeReport(c.request, h)
    expect(r.reason).toBe('allowance')
    const text = [r.summary, r.fix!.text, ...r.steps.map(s => s.body)].join('\n')
    expect(text).not.toContain('still open')
    expect(text).not.toContain('still there')
    expect(r.summary).toContain('Offer #1 has since been filled.')
    expect(r.fix).toEqual({ text: 'Offer #1 has since been filled. Pick another offer from the book, or make your own at this price.', label: 'Choose another offer' })
  }, { stateHistory: 64 }), 60_000)

test('a replay that fails for another reason is surfaced', () =>
  withSwap(async c => {
    await offer(c)
    const h = await c.tx(taker, c.swap, Swap.abi, 'take', [1n])
    const request = (m: string, p: unknown[]) =>
      m === 'eth_call' && p[1] !== 'latest' ? Promise.reject(new Error('boom')) : c.request(m, p)
    const r = await takeReport(request, h)
    expect(r).toMatchObject({ reason: 'other', error: { name: 'ReplayFailed', args: { message: 'boom' } } })
    expect(r.reconstructedNow).toBeUndefined()
  }), 60_000)
