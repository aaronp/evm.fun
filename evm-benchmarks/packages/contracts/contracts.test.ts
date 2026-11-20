import {expect, test} from 'bun:test'
import {createNode} from 'webevm'
import {createPublicClient, createWalletClient, custom, getAddress, parseEventLogs, type Address} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {AssetToken, AtomicSwap, MintableToken, OrderBook, Swap} from './index.ts'

const fnNames = (abi: readonly {type: string; name?: string}[]) =>
  abi.filter((x) => x.type === 'function').map((x) => x.name)

test('MintableToken abi has mint, transfer, approve, balanceOf', () => {
  expect(fnNames(MintableToken.abi)).toEqual(expect.arrayContaining(['mint', 'transfer', 'approve', 'balanceOf']))
})
test('AtomicSwap abi has swap', () => {
  expect(fnNames(AtomicSwap.abi)).toContain('swap')
})
test('bytecode is non-empty hex', () => {
  for (const c of [MintableToken, AtomicSwap, AssetToken]) expect(c.bytecode).toMatch(/^0x[0-9a-f]{100,}$/)
})

const issuer = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`)
type Account = typeof issuer

async function withAsset(
  fn: (c: {
    read: (functionName: string, args?: unknown[]) => Promise<unknown>
    send: (from: Account, functionName: string, args: unknown[]) => Promise<{status: string}>
  }) => Promise<void>,
) {
  const node = await createNode({
    chainId: 31337,
    miningConfig: {type: 'auto'},
    initialBalances: {[issuer.address]: 10n ** 21n, [other.address]: 10n ** 21n},
  })
  try {
    const transport = custom({request: ({method, params}: any) => node.request({method, params}) as any})
    const pub = createPublicClient({transport})
    const wallet = (account: Account) => createWalletClient({account, transport})
    const hash = await wallet(issuer).deployContract({
      abi: AssetToken.abi,
      bytecode: AssetToken.bytecode,
      args: ['British Pound', 'GBP', 2, 1_000_000_000n, issuer.address],
      chain: null,
    })
    const address = (await pub.waitForTransactionReceipt({hash})).contractAddress!
    const read = (functionName: string, args: unknown[] = []) =>
      pub.readContract({address, abi: AssetToken.abi, functionName, args} as any)
    const send = async (from: Account, functionName: string, args: unknown[]) => {
      // gas is fixed so a revert is mined (status 'reverted') instead of failing estimation
      const h = await wallet(from).writeContract({address, abi: AssetToken.abi, functionName, args, chain: null, gas: 200_000n} as any)
      return pub.waitForTransactionReceipt({hash: h})
    }
    await fn({read, send})
  } finally {
    await node.dispose()
  }
}

test('AssetToken: decimals, supply, issuer balance and owner from the constructor', () =>
  withAsset(async ({read}) => {
    expect(await read('decimals')).toBe(2)
    expect(await read('totalSupply')).toBe(1_000_000_000n)
    expect(await read('balanceOf', [issuer.address])).toBe(1_000_000_000n)
    expect(await read('owner')).toBe(issuer.address)
  }), 60_000)

test('AssetToken: mint is onlyOwner', () =>
  withAsset(async ({read, send}) => {
    expect((await send(other, 'mint', [other.address, 5n])).status).toBe('reverted')
    expect(await read('totalSupply')).toBe(1_000_000_000n)
    expect((await send(issuer, 'mint', [other.address, 5n])).status).toBe('success')
    expect(await read('totalSupply')).toBe(1_000_000_005n)
  }), 60_000)

// ---- Swap ----
const Status = {None: 0, Open: 1, Filled: 2, Cancelled: 3} as const

async function withSwap(
  fn: (c: {
    pub: ReturnType<typeof createPublicClient>
    swap: Address
    gbp: Address
    usd: Address
    maker: Account
    taker: Account
    call: (from: Account, address: Address, abi: any, functionName: string, args: unknown[]) => Promise<any>
    read: (address: Address, abi: any, functionName: string, args?: unknown[]) => Promise<any>
    /** simulate a call and return the decoded revert error */
    revertOf: (from: Account, functionName: string, args: unknown[]) => Promise<{errorName: string; args?: readonly unknown[]}>
  }) => Promise<void>,
) {
  const node = await createNode({
    chainId: 31337,
    miningConfig: {type: 'auto'},
    initialBalances: {[issuer.address]: 10n ** 21n, [other.address]: 10n ** 21n},
  })
  try {
    const transport = custom({request: ({method, params}: any) => node.request({method, params}) as any})
    const pub = createPublicClient({transport})
    const wallet = (account: Account) => createWalletClient({account, transport})
    const deploy = async (c: {abi: any; bytecode: `0x${string}`}, args: unknown[]) => {
      const hash = await wallet(issuer).deployContract({abi: c.abi, bytecode: c.bytecode, args, chain: null} as any)
      return getAddress((await pub.waitForTransactionReceipt({hash})).contractAddress!)
    }
    const gbp = await deploy(AssetToken, ['British Pound', 'GBP', 2, 1_000_000n, issuer.address])
    const usd = await deploy(AssetToken, ['US Dollar', 'USD', 6, 10_000_000_000n, issuer.address])
    const swap = await deploy(Swap, [])
    const read = (address: Address, abi: any, functionName: string, args: unknown[] = []) =>
      pub.readContract({address, abi, functionName, args} as any)
    const call = async (from: Account, address: Address, abi: any, functionName: string, args: unknown[]) => {
      const h = await wallet(from).writeContract({address, abi, functionName, args, chain: null, gas: 500_000n} as any)
      return pub.waitForTransactionReceipt({hash: h})
    }
    // issuer is the maker (holds GBP); other is the taker (funded with USD)
    await call(issuer, usd, AssetToken.abi, 'transfer', [other.address, 5_000_000_000n])
    const revertOf = async (from: Account, functionName: string, args: unknown[]) => {
      try {
        await pub.simulateContract({account: from, address: swap, abi: [...Swap.abi, ...AssetToken.abi], functionName, args} as any)
      } catch (e: any) {
        const err = e.walk?.((x: any) => x?.data?.errorName)
        if (err) return err.data
        throw e
      }
      throw new Error('did not revert')
    }
    await fn({pub, swap, gbp, usd, maker: issuer, taker: other, call, read, revertOf})
  } finally {
    await node.dispose()
  }
}

const zero = '0x0000000000000000000000000000000000000000'
test('Swap: makeOffer escrows, returns ids 1 then 2, emits OfferMade, offers(1) is Open', () =>
  withSwap(async ({pub, swap, gbp, usd, maker, call, read}) => {
    const erc = AssetToken.abi
    await call(maker, gbp, erc, 'approve', [swap, 100_000n])
    const before = await read(gbp, erc, 'balanceOf', [maker.address])
    expect(await read(swap, Swap.abi, 'nextId')).toBe(1n)
    const r1 = await call(maker, swap, Swap.abi, 'makeOffer', [gbp, 100_000n, usd, 127_000_000n])
    expect(r1.status).toBe('success')
    const logs = parseEventLogs({abi: Swap.abi, logs: r1.logs, eventName: 'OfferMade'})
    expect(logs).toHaveLength(1)
    expect(logs[0]!.args).toEqual({
      id: 1n, maker: maker.address, giveToken: gbp, giveAmt: 100_000n, getToken: usd, getAmt: 127_000_000n,
    })
    expect(await read(gbp, erc, 'balanceOf', [maker.address])).toBe(before - 100_000n)
    expect(await read(gbp, erc, 'balanceOf', [swap])).toBe(100_000n)
    expect(await read(swap, Swap.abi, 'offers', [1n])).toEqual([maker.address, gbp, 100_000n, usd, 127_000_000n, Status.Open, zero, 0n])
    await call(maker, gbp, erc, 'approve', [swap, 10n])
    const r2 = await call(maker, swap, Swap.abi, 'makeOffer', [gbp, 10n, usd, 1n])
    expect(parseEventLogs({abi: Swap.abi, logs: r2.logs, eventName: 'OfferMade'})[0]!.args.id).toBe(2n)
    expect(await read(swap, Swap.abi, 'nextId')).toBe(3n)
    void pub
  }), 60_000)

test('Swap: take moves both legs atomically, status Filled, emits OfferTaken; second take and unknown id revert', () =>
  withSwap(async ({swap, gbp, usd, maker, taker, call, read, revertOf}) => {
    const erc = AssetToken.abi
    await call(maker, gbp, erc, 'approve', [swap, 100_000n])
    await call(maker, swap, Swap.abi, 'makeOffer', [gbp, 100_000n, usd, 127_000_000n])
    await call(taker, usd, erc, 'approve', [swap, 127_000_000n])
    const [mUsd, tGbp, tUsd] = [
      await read(usd, erc, 'balanceOf', [maker.address]),
      await read(gbp, erc, 'balanceOf', [taker.address]),
      await read(usd, erc, 'balanceOf', [taker.address]),
    ]
    const r = await call(taker, swap, Swap.abi, 'take', [1n])
    expect(r.status).toBe('success')
    expect(parseEventLogs({abi: Swap.abi, logs: r.logs, eventName: 'OfferTaken'})[0]!.args).toEqual({id: 1n, taker: taker.address})
    expect(await read(usd, erc, 'balanceOf', [maker.address])).toBe(mUsd + 127_000_000n)
    expect(await read(usd, erc, 'balanceOf', [taker.address])).toBe(tUsd - 127_000_000n)
    expect(await read(gbp, erc, 'balanceOf', [taker.address])).toBe(tGbp + 100_000n)
    expect(await read(gbp, erc, 'balanceOf', [swap])).toBe(0n)
    const o = await read(swap, Swap.abi, 'offers', [1n])
    expect(o[5]).toBe(Status.Filled)
    expect([o[6], o[7]]).toEqual([taker.address, r.blockNumber])
    expect(await revertOf(taker, 'take', [1n])).toMatchObject({errorName: 'OfferNotOpen', args: [1n, Status.Filled]})
    expect(await revertOf(taker, 'take', [99n])).toMatchObject({errorName: 'OfferNotOpen', args: [99n, Status.None]})
  }), 60_000)

test('Swap: cancel is maker-only, returns exactly the escrow, then take reverts OfferNotOpen(Cancelled)', () =>
  withSwap(async ({swap, gbp, usd, maker, taker, call, read, revertOf}) => {
    const erc = AssetToken.abi
    await call(maker, gbp, erc, 'approve', [swap, 100_000n])
    await call(maker, swap, Swap.abi, 'makeOffer', [gbp, 100_000n, usd, 127_000_000n])
    const before = await read(gbp, erc, 'balanceOf', [maker.address])
    expect(await revertOf(taker, 'cancel', [1n])).toMatchObject({errorName: 'NotMaker', args: [1n]})
    const r = await call(maker, swap, Swap.abi, 'cancel', [1n])
    expect(r.status).toBe('success')
    expect(parseEventLogs({abi: Swap.abi, logs: r.logs, eventName: 'OfferCancelled'})[0]!.args).toEqual({id: 1n})
    expect(await read(gbp, erc, 'balanceOf', [maker.address])).toBe(before + 100_000n)
    expect(await read(gbp, erc, 'balanceOf', [swap])).toBe(0n)
    const o = await read(swap, Swap.abi, 'offers', [1n])
    expect([o[5], o[6], o[7]]).toEqual([Status.Cancelled, zero, r.blockNumber]) // closedBlock is set on cancel too
    expect(await revertOf(taker, 'take', [1n])).toMatchObject({errorName: 'OfferNotOpen', args: [1n, Status.Cancelled]})
  }), 60_000)

test('Swap: makeOffer with zero amount, same token or zero address reverts BadOffer', () =>
  withSwap(async ({swap, gbp, usd, maker, call, revertOf}) => {
    await call(maker, gbp, AssetToken.abi, 'approve', [swap, 100n])
    for (const args of [
      [gbp, 0n, usd, 1n],
      [gbp, 1n, usd, 0n],
      [gbp, 1n, gbp, 1n],
      [zero, 1n, usd, 1n],
      [gbp, 1n, zero, 1n],
    ])
      expect(await revertOf(maker, 'makeOffer', args)).toMatchObject({errorName: 'BadOffer'})
  }), 60_000)

test('Swap: take with short allowance reverts ERC20InsufficientAllowance and moves nothing', () =>
  withSwap(async ({swap, gbp, usd, maker, taker, call, read, revertOf}) => {
    const erc = AssetToken.abi
    await call(maker, gbp, erc, 'approve', [swap, 100_000n])
    await call(maker, swap, Swap.abi, 'makeOffer', [gbp, 100_000n, usd, 127_000_000n])
    await call(taker, usd, erc, 'approve', [swap, 126_999_999n])
    const err = await revertOf(taker, 'take', [1n])
    expect(err).toMatchObject({errorName: 'ERC20InsufficientAllowance'})
    expect(err.args).toEqual([swap, 126_999_999n, 127_000_000n])
    const r = await call(taker, swap, Swap.abi, 'take', [1n])
    expect(r.status).toBe('reverted')
    expect((await read(swap, Swap.abi, 'offers', [1n]))[5]).toBe(Status.Open)
    expect(await read(gbp, erc, 'balanceOf', [swap])).toBe(100_000n)
    expect(await read(gbp, erc, 'balanceOf', [taker.address])).toBe(0n)
    expect(await read(usd, erc, 'balanceOf', [taker.address])).toBe(5_000_000_000n)
  }), 60_000)

// ---- OrderBook ----
const Buy = 0, Sell = 1
const P = (s: string) => BigInt(Math.round(Number(s) * 1e6)) // USD (6 dp) per whole GBP
const ceilQ = (a: bigint, p: bigint) => (a * p + 99n) / 100n // GBP has 2 dp
const floorQ = (a: bigint, p: bigint) => (a * p) / 100n
const third = privateKeyToAccount(`0x${'33'.repeat(32)}`)

async function withBook(
  fn: (c: {
    book: Address
    gbp: Address
    usd: Address
    maker: Account
    taker: Account
    third: Account
    place: (from: Account, args: unknown[]) => Promise<any>
    read: (functionName: string, args?: unknown[]) => Promise<any>
    bal: (token: Address, who: Address) => Promise<bigint>
    call: (from: Account, address: Address, abi: any, functionName: string, args: unknown[]) => Promise<any>
    revertOf: (from: Account, functionName: string, args: unknown[]) => Promise<{errorName: string; args?: readonly unknown[]}>
  }) => Promise<void>,
) {
  const node = await createNode({
    chainId: 31337,
    miningConfig: {type: 'auto'},
    initialBalances: {[issuer.address]: 10n ** 21n, [other.address]: 10n ** 21n, [third.address]: 10n ** 21n},
  })
  try {
    const transport = custom({request: ({method, params}: any) => node.request({method, params}) as any})
    const pub = createPublicClient({transport})
    const wallet = (account: Account) => createWalletClient({account, transport})
    const deploy = async (c: {abi: any; bytecode: `0x${string}`}, args: unknown[]) => {
      const hash = await wallet(issuer).deployContract({abi: c.abi, bytecode: c.bytecode, args, chain: null} as any)
      return getAddress((await pub.waitForTransactionReceipt({hash})).contractAddress!)
    }
    const gbp = await deploy(AssetToken, ['British Pound', 'GBP', 2, 100_000_000n, issuer.address])
    const usd = await deploy(AssetToken, ['US Dollar', 'USD', 6, 100_000_000_000n, issuer.address])
    const book = await deploy(OrderBook, [])
    const call = async (from: Account, address: Address, abi: any, functionName: string, args: unknown[]) => {
      const h = await wallet(from).writeContract({address, abi, functionName, args, chain: null, gas: 3_000_000n} as any)
      return pub.waitForTransactionReceipt({hash: h})
    }
    for (const a of [other, third]) {
      await call(issuer, gbp, AssetToken.abi, 'transfer', [a.address, 10_000_000n])
      await call(issuer, usd, AssetToken.abi, 'transfer', [a.address, 10_000_000_000n])
    }
    for (const a of [issuer, other, third])
      for (const t of [gbp, usd]) await call(a, t, AssetToken.abi, 'approve', [book, 2n ** 255n])
    const read = (functionName: string, args: unknown[] = []) =>
      pub.readContract({address: book, abi: OrderBook.abi, functionName, args} as any) as Promise<any>
    const bal = (token: Address, who: Address) =>
      pub.readContract({address: token, abi: AssetToken.abi, functionName: 'balanceOf', args: [who]}) as Promise<bigint>
    const place = (from: Account, args: unknown[]) => call(from, book, OrderBook.abi, 'place', args)
    const revertOf = async (from: Account, functionName: string, args: unknown[]) => {
      try {
        await pub.simulateContract({account: from, address: book, abi: [...OrderBook.abi, ...AssetToken.abi], functionName, args} as any)
      } catch (e: any) {
        const err = e.walk?.((x: any) => x?.data?.errorName)
        if (err) return err.data
        throw e
      }
      throw new Error('did not revert')
    }
    await fn({book, gbp, usd, maker: issuer, taker: other, third, place, read, bal, call, revertOf})
  } finally {
    await node.dispose()
  }
}

const trades = (r: any) => parseEventLogs({abi: OrderBook.abi, logs: r.logs, eventName: 'Trade'}).map((l: any) => l.args)

test('OrderBook: resting orders read back via best, level, levelOrders, ordersOf and orders; escrow held', () =>
  withBook(async ({book, gbp, usd, maker, place, read, bal}) => {
    expect(await read('nextId')).toBe(1n)
    expect(await read('best', [gbp, usd, Sell])).toBe(0n)
    const r = await place(maker, [gbp, usd, Sell, P('1.27'), 10_000n, 20n, 0n, true])
    expect(r.status).toBe('success')
    expect((parseEventLogs({abi: OrderBook.abi, logs: r.logs, eventName: 'OrderPlaced'})[0] as any).args).toEqual({
      id: 1n, owner: maker.address, base: gbp, quote: usd, side: Sell, price: P('1.27'), amount: 10_000n,
    })
    await place(maker, [gbp, usd, Sell, P('1.28'), 5_000n, 20n, P('1.27'), true])
    await place(maker, [gbp, usd, Sell, P('1.27'), 2_000n, 20n, 0n, true])
    await place(maker, [gbp, usd, Buy, P('1.2533'), 333n, 20n, 0n, true])
    expect(await read('nextId')).toBe(5n)
    expect(await read('best', [gbp, usd, Sell])).toBe(P('1.27'))
    expect(await read('best', [gbp, usd, Buy])).toBe(P('1.2533'))
    expect(await read('level', [gbp, usd, Sell, P('1.27')])).toEqual([0n, P('1.28'), 12_000n, 2n])
    expect(await read('level', [gbp, usd, Sell, P('1.28')])).toEqual([P('1.27'), 0n, 5_000n, 1n])
    expect(await read('levelOrders', [gbp, usd, Sell, P('1.27')])).toEqual([1n, 3n])
    expect(await read('ordersOf', [maker.address])).toEqual([1n, 2n, 3n, 4n])
    expect(await read('orders', [1n])).toEqual({
      owner: maker.address, base: gbp, quote: usd, side: Sell, status: Status.Open, closedBlock: 0n,
      price: P('1.27'), amount: 10_000n, filled: 0n,
    })
    expect(await bal(gbp, book)).toBe(17_000n)
    expect(await bal(usd, book)).toBe(ceilQ(333n, P('1.2533'))) // 4_173_489 (4_173_488.9 rounded up)
  }), 60_000)

test('OrderBook: taker buy crosses two levels with a partial on the second: exact balances, Trade events, statuses', () =>
  withBook(async ({book, gbp, usd, maker, taker, third, place, read, bal}) => {
    const pA = 1_273_301n, pB = 1_280_101n // off-tick so both fills round
    await place(maker, [gbp, usd, Sell, pA, 333n, 20n, 0n, true]) // 1
    await place(third, [gbp, usd, Sell, pB, 500n, 20n, 0n, true]) // 2
    const [mU, thU, tU, tG] = [await bal(usd, maker.address), await bal(usd, third.address), await bal(usd, taker.address), await bal(gbp, taker.address)]
    const r = await place(taker, [gbp, usd, Buy, pB, 444n, 20n, 0n, true]) // 3
    expect(r.status).toBe('success')
    const q1 = ceilQ(333n, pA), q2 = ceilQ(111n, pB)
    expect([q1, q2]).toEqual([4_240_093n, 1_420_913n])
    expect(trades(r)).toEqual([
      {makerId: 1n, takerId: 3n, maker: maker.address, taker: taker.address, price: pA, amount: 333n, quoteAmount: q1},
      {makerId: 2n, takerId: 3n, maker: third.address, taker: taker.address, price: pB, amount: 111n, quoteAmount: q2},
    ])
    expect(await bal(usd, maker.address)).toBe(mU + q1)
    expect(await bal(usd, third.address)).toBe(thU + q2)
    expect(await bal(usd, taker.address)).toBe(tU - q1 - q2)
    expect(await bal(gbp, taker.address)).toBe(tG + 444n)
    expect(await bal(usd, book)).toBe(0n)
    expect(await bal(gbp, book)).toBe(389n)
    const o1 = await read('orders', [1n]), o2 = await read('orders', [2n]), o3 = await read('orders', [3n])
    expect([o1.status, o1.filled, o1.closedBlock]).toEqual([Status.Filled, 333n, r.blockNumber])
    expect([o2.status, o2.filled, o2.closedBlock]).toEqual([Status.Open, 111n, 0n])
    expect([o3.status, o3.filled, o3.closedBlock]).toEqual([Status.Filled, 444n, r.blockNumber])
    expect(await read('best', [gbp, usd, Sell])).toBe(pB)
    expect(await read('level', [gbp, usd, Sell, pA])).toEqual([0n, 0n, 0n, 0n])
    expect(await read('level', [gbp, usd, Sell, pB])).toEqual([0n, 0n, 389n, 1n])
    expect(await read('best', [gbp, usd, Buy])).toBe(0n)
    expect(await read('ordersOf', [taker.address])).toEqual([3n])
  }), 60_000)

test('OrderBook: taker buy above the ask gets the price improvement refunded; its unfilled part rests at its limit', () =>
  withBook(async ({book, gbp, usd, maker, taker, place, read, bal, call}) => {
    await place(maker, [gbp, usd, Sell, P('1.27'), 10_000n, 20n, 0n, true])
    const tU = await bal(usd, taker.address)
    const r = await place(taker, [gbp, usd, Buy, P('1.3001'), 15_000n, 20n, 0n, true])
    expect(trades(r).map((t: any) => t.quoteAmount)).toEqual([127_000_000n])
    const rest = ceilQ(5_000n, P('1.3001')) // 65_005_000
    expect(await bal(usd, taker.address)).toBe(tU - 127_000_000n - rest)
    expect(await bal(usd, book)).toBe(rest)
    expect(await read('best', [gbp, usd, Buy])).toBe(P('1.3001'))
    expect(await read('level', [gbp, usd, Buy, P('1.3001')])).toEqual([0n, 0n, 5_000n, 1n])
    const o = await read('orders', [2n])
    expect([o.status, o.filled]).toEqual([Status.Open, 10_000n])
    await call(taker, book, OrderBook.abi, 'cancel', [2n]) // returns exactly the resting escrow
    expect(await bal(usd, taker.address)).toBe(tU - 127_000_000n)
    expect(await bal(usd, book)).toBe(0n)
  }), 60_000)

test('OrderBook: market buy fills fully at maker prices and refunds the unspent worst-price escrow', () =>
  withBook(async ({book, gbp, usd, maker, taker, place, read, bal}) => {
    await place(maker, [gbp, usd, Sell, P('1.27'), 1_000n, 20n, 0n, true])
    await place(maker, [gbp, usd, Sell, 1_273_301n, 1_000n, 20n, 0n, true])
    const tU = await bal(usd, taker.address)
    const r = await place(taker, [gbp, usd, Buy, P('1.2861'), 1_501n, 20n, 0n, false])
    expect(r.status).toBe('success')
    const paid = ceilQ(1_000n, P('1.27')) + ceilQ(501n, 1_273_301n)
    expect(trades(r).map((t: any) => t.quoteAmount)).toEqual([12_700_000n, 6_379_239n])
    expect(await bal(usd, taker.address)).toBe(tU - paid)
    expect(await bal(usd, book)).toBe(0n)
    expect((await read('orders', [3n])).status).toBe(Status.Filled)
  }), 60_000)

test('OrderBook: market orders that cannot fill revert BookTooThin(filled) and move nothing', () =>
  withBook(async ({book, gbp, usd, maker, taker, place, read, bal, revertOf}) => {
    await place(maker, [gbp, usd, Sell, P('1.27'), 1_000n, 20n, 0n, true])
    await place(maker, [gbp, usd, Sell, P('1.28'), 500n, 20n, 0n, true])
    expect(await revertOf(taker, 'place', [gbp, usd, Buy, P('1.30'), 2_000n, 20n, 0n, false]))
      .toMatchObject({errorName: 'BookTooThin', args: [1_500n]})
    expect(await revertOf(taker, 'place', [gbp, usd, Buy, P('1.30'), 1_200n, 1n, 0n, false])) // level cap
      .toMatchObject({errorName: 'BookTooThin', args: [1_000n]})
    expect(await revertOf(taker, 'place', [gbp, usd, Buy, P('1.275'), 1_200n, 20n, 0n, false])) // price limit
      .toMatchObject({errorName: 'BookTooThin', args: [1_000n]})
    const [tU, tG, bU, bG] = [await bal(usd, taker.address), await bal(gbp, taker.address), await bal(usd, book), await bal(gbp, book)]
    expect((await place(taker, [gbp, usd, Buy, P('1.30'), 2_000n, 20n, 0n, false])).status).toBe('reverted')
    expect([await bal(usd, taker.address), await bal(gbp, taker.address), await bal(usd, book), await bal(gbp, book)]).toEqual([tU, tG, bU, bG])
    expect(await read('level', [gbp, usd, Sell, P('1.27')])).toEqual([0n, P('1.28'), 1_000n, 1n])
    expect(await read('nextId')).toBe(3n)
  }), 60_000)

test('OrderBook: taker sell receives floor at the bid price; dust returns to the bid maker on completion', () =>
  withBook(async ({book, gbp, usd, maker, taker, place, read, bal}) => {
    const p = 1_273_301n
    const escrow = ceilQ(333n, p) // 4_240_093 (…092.33 up)
    const mU0 = await bal(usd, maker.address), mG0 = await bal(gbp, maker.address)
    await place(maker, [gbp, usd, Buy, p, 333n, 20n, 0n, true]) // 1
    expect(await bal(usd, book)).toBe(escrow)
    const tU0 = await bal(usd, taker.address)
    const got = floorQ(111n, p) // 1_413_364 (…364.11 down)
    for (let i = 0; i < 3; i++) {
      const r = await place(taker, [gbp, usd, Sell, p - 1n, 111n, 20n, 0n, false])
      expect(trades(r)[0]).toMatchObject({makerId: 1n, price: p, amount: 111n, quoteAmount: got})
    }
    expect(await bal(usd, taker.address)).toBe(tU0 + 3n * got)
    expect(await bal(usd, maker.address)).toBe(mU0 - 3n * got) // escrow minus payouts: 1 unit of dust came back
    expect(await bal(gbp, maker.address)).toBe(mG0 + 333n)
    expect(await bal(usd, book)).toBe(0n)
    expect((await read('orders', [1n])).status).toBe(Status.Filled)
    expect(await read('best', [gbp, usd, Buy])).toBe(0n)
  }), 60_000)

test('OrderBook: cancel is owner-only, returns the remaining escrow (with dust), sets closedBlock; then OrderNotOpen', () =>
  withBook(async ({book, gbp, usd, maker, taker, place, read, bal, call, revertOf}) => {
    const p = 1_273_301n
    await place(maker, [gbp, usd, Buy, p, 333n, 20n, 0n, true]) // 1
    await place(taker, [gbp, usd, Sell, p, 111n, 20n, 0n, false]) // 2
    await place(maker, [gbp, usd, Sell, P('1.40'), 700n, 20n, 0n, true]) // 3
    expect(await revertOf(taker, 'cancel', [1n])).toMatchObject({errorName: 'NotOwner', args: [1n]})
    const mU = await bal(usd, maker.address), mG = await bal(gbp, maker.address)
    const r = await call(maker, book, OrderBook.abi, 'cancel', [1n])
    expect((parseEventLogs({abi: OrderBook.abi, logs: r.logs, eventName: 'OrderCancelled'})[0] as any).args).toEqual({id: 1n})
    expect(await bal(usd, maker.address)).toBe(mU + ceilQ(333n, p) - floorQ(111n, p)) // 2_826_729
    await call(maker, book, OrderBook.abi, 'cancel', [3n])
    expect(await bal(gbp, maker.address)).toBe(mG + 700n)
    expect([await bal(usd, book), await bal(gbp, book)]).toEqual([0n, 0n])
    const o = await read('orders', [1n])
    expect([o.status, o.filled, o.closedBlock]).toEqual([Status.Cancelled, 111n, r.blockNumber])
    expect(await read('best', [gbp, usd, Buy])).toBe(0n)
    expect(await read('best', [gbp, usd, Sell])).toBe(0n)
    expect(await read('levelOrders', [gbp, usd, Buy, p])).toEqual([])
    expect(await revertOf(maker, 'cancel', [1n])).toMatchObject({errorName: 'OrderNotOpen', args: [1n, Status.Cancelled]})
    expect(await revertOf(taker, 'cancel', [2n])).toMatchObject({errorName: 'OrderNotOpen', args: [2n, Status.Filled]})
    expect(await revertOf(maker, 'cancel', [99n])).toMatchObject({errorName: 'OrderNotOpen', args: [99n, Status.None]})
  }), 60_000)

test('OrderBook: a cancelled order mid-queue is skipped by matching (FIFO kept)', () =>
  withBook(async ({gbp, usd, maker, taker, third, place, read, call, book}) => {
    await place(maker, [gbp, usd, Sell, P('1.27'), 100n, 20n, 0n, true]) // 1
    await place(third, [gbp, usd, Sell, P('1.27'), 100n, 20n, 0n, true]) // 2
    await place(maker, [gbp, usd, Sell, P('1.27'), 100n, 20n, 0n, true]) // 3
    await call(third, book, OrderBook.abi, 'cancel', [2n])
    expect(await read('levelOrders', [gbp, usd, Sell, P('1.27')])).toEqual([1n, 3n])
    expect(await read('level', [gbp, usd, Sell, P('1.27')])).toEqual([0n, 0n, 200n, 2n])
    const r = await place(taker, [gbp, usd, Buy, P('1.27'), 150n, 20n, 0n, false])
    expect(trades(r).map((t: any) => [t.makerId, t.amount])).toEqual([[1n, 100n], [3n, 50n]])
    expect(await read('levelOrders', [gbp, usd, Sell, P('1.27')])).toEqual([3n])
  }), 60_000)

test('OrderBook: BadOrder for zero price or amount, same token, zero address', () =>
  withBook(async ({gbp, usd, maker, revertOf}) => {
    for (const args of [
      [gbp, usd, Sell, 0n, 1n, 20n, 0n, true],
      [gbp, usd, Sell, 1n, 0n, 20n, 0n, true],
      [gbp, gbp, Sell, 1n, 1n, 20n, 0n, true],
      [zero, usd, Sell, 1n, 1n, 20n, 0n, true],
      [gbp, zero, Sell, 1n, 1n, 20n, 0n, true],
    ])
      expect(await revertOf(maker, 'place', args)).toMatchObject({errorName: 'BadOrder'})
  }), 60_000)

test('OrderBook: levels stay sorted whatever the hint (good, wrong, unknown, zero) on both sides', () =>
  withBook(async ({gbp, usd, maker, place, read}) => {
    const walk = async (side: number) => {
      const out: bigint[] = []
      for (let p = await read('best', [gbp, usd, side]); p !== 0n; p = (await read('level', [gbp, usd, side, p]))[1]) out.push(p)
      return out
    }
    const asks = [['1.29', '0'], ['1.25', '1.29'], ['1.27', '1.25'], ['1.28', '1.25'], ['1.26', '9.99'], ['1.30', '1.25'], ['1.24', '1.30'], ['1.285', '1.29']]
    for (const [p, h] of asks) await place(maker, [gbp, usd, Sell, P(p!), 10n, 20n, P(h!), true])
    expect(await walk(Sell)).toEqual(['1.24', '1.25', '1.26', '1.27', '1.28', '1.285', '1.29', '1.30'].map(P))
    const bids = [['1.10', '0'], ['1.20', '1.10'], ['1.15', '1.20'], ['1.05', '1.20'], ['1.12', '7'], ['1.21', '1.05']]
    for (const [p, h] of bids) await place(maker, [gbp, usd, Buy, P(p!), 10n, 20n, P(h!), true])
    expect(await walk(Buy)).toEqual(['1.21', '1.20', '1.15', '1.12', '1.10', '1.05'].map(P))
    // prev links mirror next links
    expect((await read('level', [gbp, usd, Buy, P('1.12')]))[0]).toBe(P('1.15'))
    expect((await read('level', [gbp, usd, Sell, P('1.285')]))[0]).toBe(P('1.28'))
  }), 60_000)

test('OrderBook: when per-fill ceilings sum above the one escrowed ceiling, the taker buy covers the shortfall', () =>
  withBook(async ({book, gbp, usd, maker, taker, third, place, bal}) => {
    await place(maker, [gbp, usd, Sell, 1n, 1n, 20n, 0n, true])
    await place(third, [gbp, usd, Sell, 1n, 1n, 20n, 0n, true])
    const [tU, mU, thU] = [await bal(usd, taker.address), await bal(usd, maker.address), await bal(usd, third.address)]
    const r = await place(taker, [gbp, usd, Buy, 1n, 2n, 20n, 0n, false]) // escrow ceil(2/100) = 1, fills pay 1 + 1
    expect(trades(r).map((t: any) => t.quoteAmount)).toEqual([1n, 1n])
    expect([await bal(usd, taker.address), await bal(usd, maker.address), await bal(usd, third.address)]).toEqual([tU - 2n, mU + 1n, thU + 1n])
    expect(await bal(usd, book)).toBe(0n)
    console.log('gas: place resting', (await place(maker, [gbp, usd, Sell, 1_270_000n, 100n, 20n, 0n, true])).gasUsed)
    console.log('gas: place same level', (await place(maker, [gbp, usd, Sell, 1_270_000n, 100n, 20n, 0n, true])).gasUsed)
    console.log('gas: place new level, good hint', (await place(maker, [gbp, usd, Sell, 1_280_000n, 100n, 20n, 1_270_000n, true])).gasUsed)
    console.log('gas: take 1 fill', (await place(taker, [gbp, usd, Buy, 1_270_000n, 100n, 20n, 0n, false])).gasUsed)
    console.log('gas: take 2 fills / 2 levels', (await place(taker, [gbp, usd, Buy, 1_280_000n, 200n, 20n, 0n, false])).gasUsed)
  }), 60_000)
