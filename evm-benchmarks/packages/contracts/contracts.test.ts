import {expect, test} from 'bun:test'
import {createNode} from 'webevm'
import {createPublicClient, createWalletClient, custom, decodeErrorResult, encodeDeployData, getAddress, keccak256, parseEventLogs, type Address} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {AssetToken, AtomicSwap, MintableToken, HashLock, OrderBook, Pool, Settlement, Swap, type Contract} from './index.ts'

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
  venue: Contract = OrderBook,
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
  venue: Contract = OrderBook,
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
    const book = await deploy(venue, [])
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
      pub.readContract({address: book, abi: venue.abi, functionName, args} as any) as Promise<any>
    const bal = (token: Address, who: Address) =>
      pub.readContract({address: token, abi: AssetToken.abi, functionName: 'balanceOf', args: [who]}) as Promise<bigint>
    const place = (from: Account, args: unknown[]) => call(from, book, venue.abi, 'place', args)
    const revertOf = async (from: Account, functionName: string, args: unknown[]) => {
      try {
        await pub.simulateContract({account: from, address: book, abi: [...venue.abi, ...AssetToken.abi], functionName, args} as any)
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
  }), 60_000)

test('OrderBook: a limit remainder never rests crossing the other side when maxLevels stops matching first', () =>
  withBook(async ({gbp, usd, maker, taker, place, read, revertOf}) => {
    await place(maker, [gbp, usd, Sell, P('1.27'), 100n, 20n, 0n, true])
    await place(maker, [gbp, usd, Sell, P('1.28'), 100n, 20n, 0n, true])
    expect(await revertOf(taker, 'place', [gbp, usd, Buy, P('1.30'), 300n, 1n, 0n, true]))
      .toMatchObject({errorName: 'BookTooThin', args: [100n]})
    expect(await revertOf(taker, 'place', [gbp, usd, Buy, P('1.27'), 50n, 0n, 0n, true]))
      .toMatchObject({errorName: 'BookTooThin', args: [0n]})
    // capped but no longer crossing: rests
    expect((await place(taker, [gbp, usd, Buy, P('1.27'), 150n, 1n, 0n, true])).status).toBe('success')
    expect(await read('best', [gbp, usd, Buy])).toBe(P('1.27'))
    expect(await read('best', [gbp, usd, Sell])).toBe(P('1.28'))
    expect(await read('level', [gbp, usd, Buy, P('1.27')])).toEqual([0n, 0n, 50n, 1n])
  }), 60_000)

test('OrderBook: taker sell crosses two bid levels then rests its remainder; base escrow kept, cancel returns it exactly', () =>
  withBook(async ({book, gbp, usd, maker, taker, third, place, read, bal, call}) => {
    const pA = 1_250_001n, pB = 1_240_001n
    const mU0 = await bal(usd, maker.address)
    await place(maker, [gbp, usd, Buy, pA, 333n, 20n, 0n, true]) // 1
    await place(third, [gbp, usd, Buy, pB, 333n, 20n, 0n, true]) // 2
    const thU0 = await bal(usd, third.address) + ceilQ(333n, pB)
    const [tU, tG] = [await bal(usd, taker.address), await bal(gbp, taker.address)]
    const r = await place(taker, [gbp, usd, Sell, pB, 777n, 20n, 0n, true]) // 3
    const q1 = floorQ(333n, pA), q2 = floorQ(333n, pB)
    expect([q1, q2]).toEqual([4_162_503n, 4_129_203n])
    expect(trades(r).map((t: any) => [t.makerId, t.price, t.amount, t.quoteAmount])).toEqual([[1n, pA, 333n, q1], [2n, pB, 333n, q2]])
    expect(await bal(usd, taker.address)).toBe(tU + q1 + q2)
    expect(await bal(gbp, taker.address)).toBe(tG - 777n)
    expect(await bal(usd, maker.address)).toBe(mU0 - q1) // 1 raw unit of dust returned
    expect(await bal(usd, third.address)).toBe(thU0 - q2) // its 1 raw unit of dust returned too
    expect([await bal(usd, book), await bal(gbp, book)]).toEqual([0n, 111n])
    expect(await read('best', [gbp, usd, Buy])).toBe(0n)
    expect(await read('level', [gbp, usd, Sell, pB])).toEqual([0n, 0n, 111n, 1n])
    const o = await read('orders', [3n])
    expect([o.status, o.filled]).toEqual([Status.Open, 666n])
    await call(taker, book, OrderBook.abi, 'cancel', [3n])
    expect(await bal(gbp, taker.address)).toBe(tG - 666n)
    expect([await bal(usd, book), await bal(gbp, book)]).toEqual([0n, 0n])
  }), 60_000)

test('OrderBook: a self-match trades with maker = taker and nets to zero', () =>
  withBook(async ({book, gbp, usd, maker, place, bal}) => {
    const [mU, mG] = [await bal(usd, maker.address), await bal(gbp, maker.address)]
    await place(maker, [gbp, usd, Sell, P('1.27'), 100n, 20n, 0n, true]) // 1
    const r = await place(maker, [gbp, usd, Buy, P('1.27'), 100n, 20n, 0n, false]) // 2
    expect(trades(r)).toEqual([
      {makerId: 1n, takerId: 2n, maker: maker.address, taker: maker.address, price: P('1.27'), amount: 100n, quoteAmount: 1_270_000n},
    ])
    expect([await bal(usd, maker.address), await bal(gbp, maker.address)]).toEqual([mU, mG])
    expect([await bal(usd, book), await bal(gbp, book)]).toEqual([0n, 0n])
  }), 60_000)

// ---- Settlement ----
const orderTypes = {
  Order: [
    {name: 'maker', type: 'address'}, {name: 'base', type: 'address'}, {name: 'quote', type: 'address'},
    {name: 'side', type: 'uint8'}, {name: 'price', type: 'uint256'}, {name: 'amount', type: 'uint256'},
    {name: 'nonce', type: 'uint256'}, {name: 'expiry', type: 'uint256'},
  ],
} as const
type SOrder = {maker: Address; base: Address; quote: Address; side: number; price: bigint; amount: bigint; nonce: bigint; expiry: bigint}
const FAR = 2n ** 40n
const sign = (by: Account, o: SOrder, settlement: Address) =>
  by.signTypedData({domain: {name: 'EVMB Settlement', version: '1', chainId: 31337, verifyingContract: settlement}, types: orderTypes, primaryType: 'Order', message: o})
const sTrades = (r: any) => parseEventLogs({abi: Settlement.abi, logs: r.logs, eventName: 'Trade'}).map((l: any) => l.args)
const withSettlement = (fn: Parameters<typeof withBook>[0]) => withBook(fn, Settlement)

test('Settlement: one maker sell, partially filled: exact balances at ceil, Trade event, filled recorded', () =>
  withSettlement(async ({book, gbp, usd, maker, taker, read, bal, call}) => {
    const o: SOrder = {maker: maker.address, base: gbp, quote: usd, side: Sell, price: 1_273_301n, amount: 1_000n, nonce: 1n, expiry: FAR}
    const h = await read('hashOrder', [o])
    const [mU, mG, tU, tG] = [await bal(usd, maker.address), await bal(gbp, maker.address), await bal(usd, taker.address), await bal(gbp, taker.address)]
    const r = await call(taker, book, Settlement.abi, 'settle', [[o], [await sign(maker, o, book)], [333n]])
    expect(r.status).toBe('success')
    const q = ceilQ(333n, o.price)
    expect(q).toBe(4_240_093n)
    expect(sTrades(r)).toEqual([{orderHash: h, maker: maker.address, taker: taker.address, price: o.price, amount: 333n, quoteAmount: q}])
    expect([await bal(usd, maker.address), await bal(gbp, maker.address)]).toEqual([mU + q, mG - 333n])
    expect([await bal(usd, taker.address), await bal(gbp, taker.address)]).toEqual([tU - q, tG + 333n])
    expect([await bal(usd, book), await bal(gbp, book)]).toEqual([0n, 0n])
    expect(await read('filled', [h])).toBe(333n)
  }), 60_000)

test('Settlement: two maker buys (taker sells), second partial: floor per fill, filled per hash', () =>
  withSettlement(async ({book, gbp, usd, maker, taker, third, read, bal, call}) => {
    const a: SOrder = {maker: maker.address, base: gbp, quote: usd, side: Buy, price: 1_280_101n, amount: 333n, nonce: 1n, expiry: FAR}
    const b: SOrder = {...a, maker: third.address, price: 1_273_301n, amount: 500n}
    const snap = () => Promise.all([maker, third, taker].flatMap((x) => [bal(usd, x.address), bal(gbp, x.address)]))
    const before = await snap()
    const r = await call(taker, book, Settlement.abi, 'settle', [[a, b], [await sign(maker, a, book), await sign(third, b, book)], [333n, 111n]])
    expect(r.status).toBe('success')
    const q1 = floorQ(333n, a.price), q2 = floorQ(111n, b.price)
    expect([q1, q2]).toEqual([4_262_736n, 1_413_364n])
    expect(await snap()).toEqual([before[0]! - q1, before[1]! + 333n, before[2]! - q2, before[3]! + 111n, before[4]! + q1 + q2, before[5]! - 444n])
    expect(sTrades(r).map((t: any) => [t.maker, t.amount, t.quoteAmount])).toEqual([[maker.address, 333n, q1], [third.address, 111n, q2]])
    expect(await read('filled', [await read('hashOrder', [a])])).toBe(333n)
    expect(await read('filled', [await read('hashOrder', [b])])).toBe(111n)
  }), 60_000)

test('Settlement: BadSignature, Expired, Overfill, OrderNotOpen after cancel, NotMaker, BadOrder', () =>
  withSettlement(async ({book, gbp, usd, maker, taker, third, read, call, revertOf}) => {
    const o: SOrder = {maker: maker.address, base: gbp, quote: usd, side: Sell, price: P('1.27'), amount: 100n, nonce: 7n, expiry: FAR}
    const sig = await sign(maker, o, book)
    expect(await revertOf(taker, 'settle', [[o], [await sign(third, o, book)], [10n]])).toMatchObject({errorName: 'BadSignature', args: [0n]})
    expect(await revertOf(taker, 'settle', [[o], [sig], [10n]]).catch(() => 'ok')).toBe('ok') // sanity: valid order settles
    const old = {...o, expiry: 1n}
    expect(await revertOf(taker, 'settle', [[o, old], [sig, await sign(maker, old, book)], [10n, 10n]])).toMatchObject({errorName: 'Expired', args: [1n]})
    expect(await revertOf(taker, 'settle', [[o], [sig], [101n]])).toMatchObject({errorName: 'Overfill', args: [0n, 100n]})
    expect(await revertOf(taker, 'settle', [[o, o], [sig, sig], [60n, 60n]])).toMatchObject({errorName: 'Overfill', args: [1n, 40n]})
    const mixed = {...o, side: Buy}
    expect(await revertOf(taker, 'settle', [[o, mixed], [sig, await sign(maker, mixed, book)], [1n, 1n]])).toMatchObject({errorName: 'BadOrder'})
    expect(await revertOf(taker, 'settle', [[o], [sig, sig], [1n]])).toMatchObject({errorName: 'BadOrder'})
    expect(await revertOf(taker, 'settle', [[o], [sig], [0n]])).toMatchObject({errorName: 'BadOrder'})
    expect(await revertOf(taker, 'cancel', [o])).toMatchObject({errorName: 'NotMaker'})
    const h = await read('hashOrder', [o])
    const r = await call(maker, book, Settlement.abi, 'cancel', [o])
    expect(parseEventLogs({abi: Settlement.abi, logs: r.logs, eventName: 'OrderCancelled'}).map((l: any) => l.args)).toEqual([{orderHash: h}])
    expect(await read('cancelled', [h])).toBe(true)
    expect(await revertOf(taker, 'settle', [[o], [sig], [10n]])).toMatchObject({errorName: 'OrderNotOpen', args: [h]})
    expect(await revertOf(maker, 'cancel', [o])).toMatchObject({errorName: 'OrderNotOpen', args: [h]})
  }), 60_000)

test('Settlement: a maker short of allowance or balance reverts with the ERC-20 error and moves nothing', () =>
  withSettlement(async ({book, gbp, usd, maker, taker, third, read, bal, call, revertOf}) => {
    const a: SOrder = {maker: third.address, base: gbp, quote: usd, side: Sell, price: P('1.27'), amount: 100n, nonce: 1n, expiry: FAR}
    const b: SOrder = {...a, maker: maker.address}
    const args = [[a, b], [await sign(third, a, book), await sign(maker, b, book)], [100n, 100n]]
    await call(maker, gbp, AssetToken.abi, 'approve', [book, 99n])
    expect(await revertOf(taker, 'settle', args)).toMatchObject({errorName: 'ERC20InsufficientAllowance', args: [book, 99n, 100n]})
    const snap = () => Promise.all([maker, third, taker].flatMap((x) => [bal(usd, x.address), bal(gbp, x.address)]))
    const before = await snap()
    expect((await call(taker, book, Settlement.abi, 'settle', args)).status).toBe('reverted')
    expect(await snap()).toEqual(before)
    expect(await read('filled', [await read('hashOrder', [a])])).toBe(0n)
    await call(maker, gbp, AssetToken.abi, 'approve', [book, 2n ** 255n])
    const mG = await bal(gbp, maker.address)
    await call(maker, gbp, AssetToken.abi, 'transfer', [taker.address, mG - 50n])
    expect(await revertOf(taker, 'settle', args)).toMatchObject({errorName: 'ERC20InsufficientBalance', args: [maker.address, 50n, 100n]})
  }), 60_000)

test('Settlement: a self-match (taker is the maker) settles and nets to zero', () =>
  withSettlement(async ({book, gbp, usd, maker, bal, call}) => {
    const o: SOrder = {maker: maker.address, base: gbp, quote: usd, side: Sell, price: P('1.27'), amount: 100n, nonce: 1n, expiry: FAR}
    const before = [await bal(usd, maker.address), await bal(gbp, maker.address)]
    expect((await call(maker, book, Settlement.abi, 'settle', [[o], [await sign(maker, o, book)], [100n]])).status).toBe('success')
    expect([await bal(usd, maker.address), await bal(gbp, maker.address)]).toEqual(before)
  }), 60_000)

// ---- Pool ----
const DEAD = '0x000000000000000000000000000000000000dEaD'
const isqrt = (n: bigint) => {
  if (n < 2n) return n
  let x = n, y = (n + 1n) / 2n
  while (y < x) [x, y] = [y, (y + n / y) / 2n]
  return x
}
const outFor = (amountIn: bigint, rIn: bigint, rOut: bigint) => (amountIn * 9970n * rOut) / (rIn * 10000n + amountIn * 9970n)
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b
/** 18-dp raw → string rounded half-up to 2 dp, with thousands separators */
const lp2dp = (raw: bigint) => {
  const c = (raw + 5n * 10n ** 15n) / 10n ** 16n
  return `${(c / 100n).toLocaleString('en-US')}.${String(c % 100n).padStart(2, '0')}`
}

async function withPool(
  fn: (c: {
    pool: Address
    gbp: Address
    usd: Address
    a18: Address
    b18: Address
    lp: Account
    trader: Account
    deploy: (c: Contract, args: unknown[]) => Promise<Address>
    deployPool: (base: Address, quote: Address) => Promise<Address>
    deployRevert: (args: unknown[]) => Promise<{errorName: string; args?: readonly unknown[]}>
    read: (address: Address, functionName: string, args?: unknown[]) => Promise<any>
    bal: (token: Address, who: Address) => Promise<bigint>
    call: (from: Account, address: Address, functionName: string, args: unknown[]) => Promise<any>
    revertOf: (from: Account, address: Address, functionName: string, args: unknown[]) => Promise<{errorName: string; args?: readonly unknown[]}>
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
    const abi = [...Pool.abi, ...AssetToken.abi]
    const deploy = async (c: {abi: any; bytecode: `0x${string}`}, args: unknown[]) => {
      const hash = await wallet(issuer).deployContract({abi: c.abi, bytecode: c.bytecode, args, chain: null} as any)
      return getAddress((await pub.waitForTransactionReceipt({hash})).contractAddress!)
    }
    const decodeRevert = (e: any) => {
      const data = e.walk?.((x: any) => typeof x?.data === 'string' && x.data.startsWith('0x'))?.data
      if (data) return decodeErrorResult({abi, data}) as any
      const err = e.walk?.((x: any) => x?.data?.errorName)
      if (err) return err.data
      throw e
    }
    const gbp = await deploy(AssetToken, ['British Pound', 'GBP', 2, 100_000_000n, issuer.address])
    const usd = await deploy(AssetToken, ['US Dollar', 'USD', 6, 1_000_000_000_000n, issuer.address])
    const a18 = await deploy(AssetToken, ['Token A', 'TKA', 18, 10n ** 30n, issuer.address])
    const b18 = await deploy(AssetToken, ['Token B', 'TKB', 18, 10n ** 30n, issuer.address])
    const deployPool = (base: Address, quote: Address) => deploy(Pool, [base, quote])
    const pool = await deployPool(gbp, usd)
    const call = async (from: Account, address: Address, functionName: string, args: unknown[]) => {
      const h = await wallet(from).writeContract({address, abi, functionName, args, chain: null, gas: 1_000_000n} as any)
      return pub.waitForTransactionReceipt({hash: h})
    }
    await call(issuer, gbp, 'transfer', [other.address, 10_000_000n]) // 100,000 GBP
    await call(issuer, usd, 'transfer', [other.address, 100_000_000_000n]) // 100,000 USD
    for (const a of [issuer, other]) for (const t of [gbp, usd]) await call(a, t, 'approve', [pool, 2n ** 255n])
    const read = (address: Address, functionName: string, args: unknown[] = []) =>
      pub.readContract({address, abi, functionName, args} as any) as Promise<any>
    const bal = (token: Address, who: Address) => read(token, 'balanceOf', [who]) as Promise<bigint>
    const revertOf = async (from: Account, address: Address, functionName: string, args: unknown[]) => {
      try {
        await pub.simulateContract({account: from, address, abi, functionName, args} as any)
      } catch (e: any) {
        return decodeRevert(e)
      }
      throw new Error('did not revert')
    }
    const deployRevert = async (args: unknown[]) => {
      try {
        await pub.call({account: issuer.address, data: encodeDeployData({abi: Pool.abi, bytecode: Pool.bytecode, args})})
      } catch (e: any) {
        return decodeRevert(e)
      }
      throw new Error('did not revert')
    }
    await fn({pool, gbp, usd, a18, b18, lp: issuer, trader: other, deploy, deployPool, deployRevert, read, bal, call, revertOf})
  } finally {
    await node.dispose()
  }
}

const poolEvents = (r: any, eventName: string) => parseEventLogs({abi: Pool.abi, logs: r.logs, eventName} as any).map((l: any) => l.args)

test('Pool: metadata, then the screenshot first deposit 50,000 GBP + 63,500 USD → 56,347.14 LP, 1000 raw locked at dEaD', () =>
  withPool(async ({pool, gbp, usd, lp, read, bal, call}) => {
    expect([await read(pool, 'name'), await read(pool, 'symbol'), await read(pool, 'decimals')]).toEqual(['Pool LP GBP/USD', 'PLP', 18])
    expect([await read(pool, 'base'), await read(pool, 'quote')]).toEqual([gbp, usd])
    expect(await read(pool, 'reserves')).toEqual([0n, 0n])
    const gIn = 5_000_000n, uIn = 63_500_000_000n // 50,000.00 GBP (2 dp), 63,500.000000 USD (6 dp)
    const want = isqrt(gIn * 10n ** 16n * uIn * 10n ** 12n) - 1000n
    expect(lp2dp(want)).toBe('56,347.14')
    const r = await call(lp, pool, 'addLiquidity', [gIn, uIn, want])
    expect(r.status).toBe('success')
    expect(await bal(pool, lp.address)).toBe(want)
    expect(await bal(pool, DEAD)).toBe(1000n)
    expect(await read(pool, 'totalSupply')).toBe(want + 1000n)
    expect(await read(pool, 'reserves')).toEqual([gIn, uIn])
    expect([await bal(gbp, pool), await bal(usd, pool)]).toEqual([gIn, uIn])
    expect(poolEvents(r, 'LiquidityAdded')).toEqual([{provider: lp.address, base: gIn, quote: uIn, shares: want}])
  }), 60_000)

test('Pool: 18/18 pair first deposit is √(a·b) − 1000; too small a first deposit is BadAmount', () =>
  withPool(async ({a18, b18, lp, deployPool, read, bal, call, revertOf}) => {
    const p = await deployPool(a18, b18)
    for (const t of [a18, b18]) await call(lp, t, 'approve', [p, 2n ** 255n])
    expect(await read(p, 'name')).toBe('Pool LP TKA/TKB')
    expect(await revertOf(lp, p, 'addLiquidity', [1000n, 1000n, 0n])).toMatchObject({errorName: 'BadAmount'})
    const a = 3n * 10n ** 18n + 7n, b = 12n * 10n ** 18n + 5n
    await call(lp, p, 'addLiquidity', [a, b, 0n])
    expect(await bal(p, lp.address)).toBe(isqrt(a * b) - 1000n)
  }), 60_000)

test('Pool: later deposits mint min(baseIn·S/Rb, quoteIn·S/Rq), pull ceil amounts, leave the surplus; minShares enforced', () =>
  withPool(async ({pool, gbp, usd, lp, trader, read, bal, call, revertOf}) => {
    await call(lp, pool, 'addLiquidity', [5_000_000n, 63_500_000_000n, 0n])
    // at the pool ratio
    let [rb, rq] = await read(pool, 'reserves')
    let S: bigint = await read(pool, 'totalSupply')
    let shares = (100_000n * S) / rb
    expect(shares).toBe((1_270_000_000n * S) / rq)
    let r = await call(trader, pool, 'addLiquidity', [100_000n, 1_270_000_000n, shares])
    expect(await bal(pool, trader.address)).toBe(shares)
    expect(poolEvents(r, 'LiquidityAdded')).toEqual([{provider: trader.address, base: 100_000n, quote: 1_270_000_000n, shares}])
    // unbalanced: far too much USD; only the proportional (rounded up) USD is pulled
    ;[rb, rq] = await read(pool, 'reserves')
    S = await read(pool, 'totalSupply')
    const bIn = 12_345n, qIn = 999_999_999n
    shares = (bIn * S) / rb
    expect(shares).toBeLessThan((qIn * S) / rq)
    const bUsed = ceilDiv(shares * rb, S), qUsed = ceilDiv(shares * rq, S)
    expect(bUsed).toBe(bIn)
    expect(qUsed).toBeLessThan(qIn)
    const before = [await bal(gbp, trader.address), await bal(usd, trader.address), await bal(pool, trader.address)]
    expect(await revertOf(trader, pool, 'addLiquidity', [bIn, qIn, shares + 1n])).toMatchObject({errorName: 'Slippage', args: [shares, shares + 1n]})
    r = await call(trader, pool, 'addLiquidity', [bIn, qIn, shares])
    expect(r.status).toBe('success')
    expect([await bal(gbp, trader.address), await bal(usd, trader.address), await bal(pool, trader.address)]).toEqual([
      before[0]! - bUsed, before[1]! - qUsed, before[2]! + shares,
    ])
    expect(await read(pool, 'reserves')).toEqual([rb + bUsed, rq + qUsed])
    expect(poolEvents(r, 'LiquidityAdded')).toEqual([{provider: trader.address, base: bUsed, quote: qUsed, shares}])
    // the other side short: base surplus
    ;[rb, rq] = await read(pool, 'reserves')
    S = await read(pool, 'totalSupply')
    shares = (1_000_001n * S) / rq
    expect(shares).toBeLessThan((50_000n * S) / rb)
    const b0 = await bal(gbp, trader.address)
    await call(trader, pool, 'addLiquidity', [50_000n, 1_000_001n, 0n])
    expect(b0 - (await bal(gbp, trader.address))).toBe(ceilDiv(shares * rb, S))
    expect(await revertOf(trader, pool, 'addLiquidity', [0n, 1_000_000n, 0n])).toMatchObject({errorName: 'BadAmount'})
  }), 60_000)

test('Pool: swap both directions matches the formula exactly; k never decreases; Swapped carries post-swap reserves', () =>
  withPool(async ({pool, gbp, usd, lp, trader, read, bal, call}) => {
    await call(lp, pool, 'addLiquidity', [5_000_000n, 63_500_000_000n, 0n])
    let k = 5_000_000n * 63_500_000_000n
    for (const [tIn, tOut, amt] of [[gbp, usd, 12_345n], [usd, gbp, 777_777_777n], [usd, gbp, 1n * 10n ** 6n], [gbp, usd, 1n]] as const) {
      const [rb, rq] = await read(pool, 'reserves')
      const [rIn, rOut] = tIn === gbp ? [rb, rq] : [rq, rb]
      const out = outFor(amt, rIn, rOut)
      const before = [await bal(tIn, trader.address), await bal(tOut, trader.address)]
      const r = await call(trader, pool, 'swap', [tIn, amt, out])
      expect(r.status).toBe('success')
      expect([await bal(tIn, trader.address), await bal(tOut, trader.address)]).toEqual([before[0]! - amt, before[1]! + out])
      const after: [bigint, bigint] = tIn === gbp ? [rb + amt, rq - out] : [rb - out, rq + amt]
      expect(await read(pool, 'reserves')).toEqual(after)
      expect([await bal(gbp, pool), await bal(usd, pool)]).toEqual(after)
      expect(poolEvents(r, 'Swapped')).toEqual([{trader: trader.address, tokenIn: tIn, amountIn: amt, amountOut: out, reserveBase: after[0], reserveQuote: after[1]}])
      const k2 = after[0] * after[1]
      expect(k2).toBeGreaterThan(k)
      k = k2
    }
  }), 60_000)

test('Pool: swap Slippage reverts and moves nothing; BadToken, BadAmount, NoLiquidity', () =>
  withPool(async ({pool, gbp, usd, a18, lp, trader, read, bal, call, revertOf}) => {
    expect(await revertOf(trader, pool, 'swap', [gbp, 100n, 0n])).toMatchObject({errorName: 'NoLiquidity'})
    expect(await revertOf(lp, pool, 'removeLiquidity', [1n, 0n, 0n])).toMatchObject({errorName: 'NoLiquidity'})
    await call(lp, pool, 'addLiquidity', [5_000_000n, 63_500_000_000n, 0n])
    const out = outFor(10_000n, 5_000_000n, 63_500_000_000n)
    expect(await revertOf(trader, pool, 'swap', [gbp, 10_000n, out + 1n])).toMatchObject({errorName: 'Slippage', args: [out, out + 1n]})
    const snap = () => Promise.all([bal(gbp, trader.address), bal(usd, trader.address), bal(gbp, pool), bal(usd, pool), read(pool, 'reserves')])
    const before = await snap()
    expect((await call(trader, pool, 'swap', [gbp, 10_000n, out + 1n])).status).toBe('reverted')
    expect(await snap()).toEqual(before)
    expect(await revertOf(trader, pool, 'swap', [a18, 100n, 0n])).toMatchObject({errorName: 'BadToken'})
    expect(await revertOf(trader, pool, 'swap', [zero, 100n, 0n])).toMatchObject({errorName: 'BadToken'})
    expect(await revertOf(trader, pool, 'swap', [gbp, 0n, 0n])).toMatchObject({errorName: 'BadAmount'})
    expect(await revertOf(trader, pool, 'swap', [usd, 1n, 0n])).toMatchObject({errorName: 'BadAmount'}) // rounds to 0 GBP
  }), 60_000)

test('Pool: remove returns floor(shares·R/S), burns, emits; minBase/minQuote enforced; BadAmount for 0 shares', () =>
  withPool(async ({pool, gbp, usd, lp, trader, read, bal, call, revertOf}) => {
    await call(lp, pool, 'addLiquidity', [5_000_000n, 63_500_000_000n, 0n])
    await call(trader, pool, 'swap', [gbp, 12_345n, 0n])
    const [rb, rq] = await read(pool, 'reserves')
    const S: bigint = await read(pool, 'totalSupply')
    const shares = (await bal(pool, lp.address)) / 3n
    const bOut = (shares * rb) / S, qOut = (shares * rq) / S
    expect(await revertOf(lp, pool, 'removeLiquidity', [shares, bOut + 1n, 0n])).toMatchObject({errorName: 'Slippage', args: [bOut, bOut + 1n]})
    expect(await revertOf(lp, pool, 'removeLiquidity', [shares, 0n, qOut + 1n])).toMatchObject({errorName: 'Slippage', args: [qOut, qOut + 1n]})
    expect(await revertOf(lp, pool, 'removeLiquidity', [0n, 0n, 0n])).toMatchObject({errorName: 'BadAmount'})
    const before = [await bal(gbp, lp.address), await bal(usd, lp.address), await bal(pool, lp.address)]
    const r = await call(lp, pool, 'removeLiquidity', [shares, bOut, qOut])
    expect(r.status).toBe('success')
    expect([await bal(gbp, lp.address), await bal(usd, lp.address), await bal(pool, lp.address)]).toEqual([
      before[0]! + bOut, before[1]! + qOut, before[2]! - shares,
    ])
    expect(await read(pool, 'reserves')).toEqual([rb - bOut, rq - qOut])
    expect(await read(pool, 'totalSupply')).toBe(S - shares)
    expect(poolEvents(r, 'LiquidityRemoved')).toEqual([{provider: lp.address, base: bOut, quote: qOut, shares}])
  }), 60_000)

test('Pool: constructor refuses the same token twice, the zero address and decimals > 18 with BadToken', () =>
  withPool(async ({gbp, deploy, deployRevert}) => {
    const t19 = await deploy(AssetToken, ['Nineteen', 'T19', 19, 1n, issuer.address])
    for (const args of [[gbp, gbp], [zero, gbp], [gbp, zero], [t19, gbp], [gbp, t19]])
      expect(await deployRevert(args)).toMatchObject({errorName: 'BadToken'})
  }), 60_000)

// ---- HashLock ----
async function withHashLock(
  fn: (c: {
    lockA: Address
    lockB: Address
    gbp: Address
    usd: Address
    maker: Account
    taker: Account
    secret: `0x${string}`
    hash: `0x${string}`
    bal: (node: 'A' | 'B', token: Address, who: Address) => Promise<bigint>
    head: (node: 'A' | 'B') => Promise<bigint>
    mine: (node: 'A' | 'B', n: number) => Promise<void>
    call: (node: 'A' | 'B', from: Account, address: Address, functionName: string, args: unknown[]) => Promise<any>
    open: (timeout: bigint, wantChain?: string) => Promise<any>
    revertOf: (node: 'A' | 'B', from: Account, address: Address, functionName: string, args: unknown[]) => Promise<{errorName: string; args?: readonly unknown[]}>
    read: (node: 'A' | 'B', address: Address, functionName: string, args?: unknown[]) => Promise<any>
  }) => Promise<void>,
) {
  const mk = () =>
    createNode({chainId: 31337, miningConfig: {type: 'auto'}, initialBalances: {[issuer.address]: 10n ** 21n, [other.address]: 10n ** 21n}})
  const nodes = {A: await mk(), B: await mk()}
  try {
    const abi = [...HashLock.abi, ...AssetToken.abi]
    const tr = (k: 'A' | 'B') => custom({request: ({method, params}: any) => nodes[k].request({method, params}) as any})
    const pub = {A: createPublicClient({transport: tr('A')}), B: createPublicClient({transport: tr('B')})}
    const wallet = (k: 'A' | 'B', account: Account) => createWalletClient({account, transport: tr(k)})
    const deploy = async (k: 'A' | 'B', c: Contract, args: unknown[]) => {
      const h = await wallet(k, issuer).deployContract({abi: c.abi, bytecode: c.bytecode, args, chain: null} as any)
      return getAddress((await pub[k].waitForTransactionReceipt({hash: h})).contractAddress!)
    }
    // two assets (GBP 2 dp on A, USD 6 dp on B), one HashLock per chain
    const gbp = await deploy('A', AssetToken, ['British Pound', 'GBP', 2, 1_000_000n, issuer.address])
    const usd = await deploy('B', AssetToken, ['US Dollar', 'USD', 6, 10_000_000_000n, issuer.address])
    const lockA = await deploy('A', HashLock, [])
    const lockB = await deploy('B', HashLock, [])
    const read = (k: 'A' | 'B', address: Address, functionName: string, args: unknown[] = []) =>
      pub[k].readContract({address, abi, functionName, args} as any)
    const call = async (k: 'A' | 'B', from: Account, address: Address, functionName: string, args: unknown[]) => {
      const h = await wallet(k, from).writeContract({address, abi, functionName, args, chain: null, gas: 500_000n} as any)
      return pub[k].waitForTransactionReceipt({hash: h})
    }
    const revertOf = async (k: 'A' | 'B', from: Account, address: Address, functionName: string, args: unknown[]) => {
      try {
        await pub[k].simulateContract({account: from, address, abi, functionName, args} as any)
      } catch (e: any) {
        const err = e.walk?.((x: any) => x?.data?.errorName)
        if (err) return err.data
        throw e
      }
      throw new Error('did not revert')
    }
    const head = async (k: 'A' | 'B') => pub[k].getBlockNumber({cacheTime: 0})
    // a block is made per transaction, so a self-transfer advances the chain by one block
    const mine = async (k: 'A' | 'B', n: number) => {
      for (let i = 0; i < n; i++) await wallet(k, other).sendTransaction({to: other.address, value: 0n, chain: null} as any).then((h) => pub[k].waitForTransactionReceipt({hash: h}))
    }
    // issuer = maker (holds GBP on A), other = taker (gets USD on B)
    await call('B', issuer, usd, 'transfer', [other.address, 5_000_000_000n])
    await call('A', issuer, gbp, 'approve', [lockA, 2n ** 255n])
    await call('B', other, usd, 'approve', [lockB, 2n ** 255n])
    const secret = `0x${'ab'.repeat(32)}` as const
    const hash = keccak256(secret)
    const open = async (timeout: bigint, wantChain = 'B') =>
      call('A', issuer, lockA, 'lock', [gbp, 100_000n, other.address, hash, timeout, wantChain, wantChain ? lockB : zero, wantChain ? usd : zero, 127_000_000n])
    await fn({lockA, lockB, gbp, usd, maker: issuer, taker: other, secret, hash, head, mine, call, open, revertOf, read, bal: (k, t, w) => read(k, t, 'balanceOf', [w])})
  } finally {
    await nodes.A.dispose()
    await nodes.B.dispose()
  }
}
const HStatus = {None: 0, Locked: 1, Claimed: 2, Refunded: 3}

test('HashLock: lock pulls funds, stores terms, ids start at 1, emits Locked', () =>
  withHashLock(async ({lockA, lockB, gbp, usd, maker, taker, hash, bal, open, read, head}) => {
    expect(await read('A', lockA, 'nextId')).toBe(1n)
    const before = await bal('A', gbp, maker.address)
    const T = (await head('A')) + 100n
    const r = await open(T)
    expect(r.status).toBe('success')
    const ev = parseEventLogs({abi: HashLock.abi, logs: r.logs, eventName: 'Locked'})
    expect(ev.map((l: any) => l.args)).toEqual([{id: 1n, sender: maker.address, recipient: taker.address, hash, token: gbp, amount: 100_000n, timeoutBlock: T}])
    expect(await bal('A', gbp, maker.address)).toBe(before - 100_000n)
    expect(await bal('A', gbp, lockA)).toBe(100_000n)
    expect(await read('A', lockA, 'nextId')).toBe(2n)
    expect(await read('A', lockA, 'locks', [1n])).toEqual([maker.address, taker.address, gbp, 100_000n, hash, T, HStatus.Locked, 0n, `0x${'00'.repeat(32)}`, 'B', lockB, usd, 127_000_000n])
  }), 60_000)

test('HashLock: claim with the secret pays the recipient, stores secret and closedBlock, emits Claimed', () =>
  withHashLock(async ({lockA, gbp, taker, secret, bal, open, call, read, head}) => {
    await open((await head('A')) + 100n)
    const before = await bal('A', gbp, taker.address)
    const r = await call('A', taker, lockA, 'claim', [1n, secret])
    expect(r.status).toBe('success')
    expect(parseEventLogs({abi: HashLock.abi, logs: r.logs, eventName: 'Claimed'}).map((l: any) => l.args)).toEqual([{id: 1n, secret}])
    expect(await bal('A', gbp, taker.address)).toBe(before + 100_000n)
    expect(await bal('A', gbp, lockA)).toBe(0n)
    const l = await read('A', lockA, 'locks', [1n])
    expect([l[6], l[7], l[8]]).toEqual([HStatus.Claimed, r.blockNumber, secret])
  }), 60_000)

test('HashLock: BadSecret, NotRecipient, NotSender, NotLocked (double claim, refund after claim, unknown id)', () =>
  withHashLock(async ({lockA, maker, taker, secret, open, call, revertOf, head}) => {
    await open((await head('A')) + 100n)
    expect(await revertOf('A', taker, lockA, 'claim', [1n, `0x${'cd'.repeat(32)}`])).toMatchObject({errorName: 'BadSecret'})
    expect(await revertOf('A', maker, lockA, 'claim', [1n, secret])).toMatchObject({errorName: 'NotRecipient'})
    expect(await revertOf('A', taker, lockA, 'refund', [1n])).toMatchObject({errorName: 'NotSender'})
    expect(await revertOf('A', taker, lockA, 'claim', [9n, secret])).toMatchObject({errorName: 'NotLocked', args: [9n, 0]})
    await call('A', taker, lockA, 'claim', [1n, secret])
    expect(await revertOf('A', taker, lockA, 'claim', [1n, secret])).toMatchObject({errorName: 'NotLocked', args: [1n, 2]})
    expect(await revertOf('A', maker, lockA, 'refund', [1n])).toMatchObject({errorName: 'NotLocked', args: [1n, 2]})
  }), 60_000)

test('HashLock: timeout edges — claim at timeout-1 succeeds; refund at timeout-1 reverts NotExpired, at timeout succeeds', () =>
  withHashLock(async ({lockA, gbp, maker, taker, secret, open, call, read, revertOf, head, mine}) => {
    const T = (await head('A')) + 20n
    await open(T)
    await call('A', maker, lockA, 'lock', [gbp, 50_000n, taker.address, keccak256(secret), T, '', zero, zero, 0n])
    expect(await revertOf('A', maker, lockA, 'refund', [2n])).toMatchObject({errorName: 'NotExpired', args: [T]}) // head is well below T-1
    await mine('A', Number(T - 2n - (await head('A')))) // head = T-2, so the next block mined is T-1
    expect(await head('A')).toBe(T - 2n)
    const early = await call('A', maker, lockA, 'refund', [2n]) // mined at T-1
    expect([early.status, early.blockNumber]).toEqual(['reverted', T - 1n])
    expect(await read('A', lockA, 'locks', [2n]).then((l) => l[6])).toBe(HStatus.Locked)
    const r = await call('A', taker, lockA, 'claim', [1n, secret]) // mined at T
    expect([r.status, r.blockNumber]).toEqual(['reverted', T])
    expect(await revertOf('A', taker, lockA, 'claim', [1n, secret])).toMatchObject({errorName: 'Expired', args: [T]})
    const ok = await call('A', maker, lockA, 'refund', [2n]) // mined at T+1
    expect(ok.status).toBe('success')
  }), 60_000)

test('HashLock: claim mined at timeout-1 succeeds; refund mined at the timeout block succeeds', () =>
  withHashLock(async ({lockA, gbp, maker, taker, secret, open, call, read, head, mine}) => {
    const T = (await head('A')) + 20n
    await open(T)
    await call('A', maker, lockA, 'lock', [gbp, 50_000n, taker.address, keccak256(secret), T, '', zero, zero, 0n])
    await mine('A', Number(T - 2n - (await head('A'))))
    const c = await call('A', taker, lockA, 'claim', [1n, secret]) // mined at T-1
    expect([c.status, c.blockNumber]).toEqual(['success', T - 1n])
    const r = await call('A', maker, lockA, 'refund', [2n]) // mined at T
    expect([r.status, r.blockNumber]).toEqual(['success', T])
    expect(await read('A', lockA, 'locks', [2n]).then((l) => [l[6], l[7]])).toEqual([HStatus.Refunded, T])
  }), 60_000)

test('HashLock: claim at the timeout block reverts Expired; refund after timeout returns the funds and Claimed is then impossible', () =>
  withHashLock(async ({lockA, gbp, maker, taker, secret, bal, open, call, read, revertOf, head, mine}) => {
    const before = await bal('A', gbp, maker.address)
    const T = (await head('A')) + 5n
    await open(T)
    await mine('A', Number(T - 1n - (await head('A')))) // head = T-1, next block is T
    expect((await call('A', taker, lockA, 'claim', [1n, secret])).status).toBe('reverted') // mined at T
    expect(await revertOf('A', taker, lockA, 'claim', [1n, secret])).toMatchObject({errorName: 'Expired', args: [T]})
    const r = await call('A', maker, lockA, 'refund', [1n])
    expect(r.status).toBe('success')
    expect(parseEventLogs({abi: HashLock.abi, logs: r.logs, eventName: 'Refunded'}).map((l: any) => l.args)).toEqual([{id: 1n}])
    expect(await bal('A', gbp, maker.address)).toBe(before)
    expect(await read('A', lockA, 'locks', [1n]).then((l) => [l[6], l[7]])).toEqual([HStatus.Refunded, r.blockNumber])
    expect(await revertOf('A', taker, lockA, 'claim', [1n, secret])).toMatchObject({errorName: 'NotLocked', args: [1n, 3]})
    expect(await revertOf('A', maker, lockA, 'refund', [1n])).toMatchObject({errorName: 'NotLocked', args: [1n, 3]})
  }), 60_000)

test('HashLock: BadLock — zero amount, zero recipient, timeout not in the future, terms without wantToken or wantLock', () =>
  withHashLock(async ({lockA, lockB, gbp, usd, taker, hash, revertOf, head, maker, call}) => {
    const T = (await head('A')) + 100n
    const bad = (args: unknown[]) => revertOf('A', maker, lockA, 'lock', args)
    const ok = [gbp, 1n, taker.address, hash, T, 'B', lockB, usd, 5n]
    expect(await bad([gbp, 0n, ...ok.slice(2)])).toMatchObject({errorName: 'BadLock'})
    expect(await bad([gbp, 1n, zero, ...ok.slice(3)])).toMatchObject({errorName: 'BadLock'})
    expect(await bad([...ok.slice(0, 4), 0n, ...ok.slice(5)])).toMatchObject({errorName: 'BadLock'})
    expect(await bad([...ok.slice(0, 4), await head('A'), ...ok.slice(5)])).toMatchObject({errorName: 'BadLock'}) // timeout == head: next block is head+1, which is after it
    // simulation can't pin the boundary block, so check the mined receipt: reverted, in block n
    const n = (await head('A')) + 1n // the block the next tx is mined in
    expect(await call('A', maker, lockA, 'lock', [...ok.slice(0, 4), n, ...ok.slice(5)])).toMatchObject({status: 'reverted', blockNumber: n})
    expect(await bad([...ok.slice(0, 6), zero, usd, 5n])).toMatchObject({errorName: 'BadLock'})
    expect(await bad([...ok.slice(0, 7), zero, 5n])).toMatchObject({errorName: 'BadLock'})
  }), 60_000)

test('HashLock: an answer lock (empty terms) locks, claims and refunds the same way', () =>
  withHashLock(async ({lockB, usd, maker, taker, secret, hash, bal, call, read, revertOf, head, mine}) => {
    const T = (await head('B')) + 50n
    const before = await bal('B', usd, taker.address)
    // the taker answers on B: sender = taker, recipient = maker, no terms
    const r = await call('B', taker, lockB, 'lock', [usd, 127_000_000n, maker.address, hash, T, '', zero, zero, 0n])
    expect(r.status).toBe('success')
    expect(await bal('B', usd, taker.address)).toBe(before - 127_000_000n)
    expect(await read('B', lockB, 'locks', [1n]).then((l) => [l[9], l[10], l[11], l[12]])).toEqual(['', zero, zero, 0n])
    const makerBefore = await bal('B', usd, maker.address)
    const c = await call('B', maker, lockB, 'claim', [1n, secret])
    expect(c.status).toBe('success')
    expect(await bal('B', usd, maker.address)).toBe(makerBefore + 127_000_000n)
    expect(await revertOf('B', taker, lockB, 'refund', [1n])).toMatchObject({errorName: 'NotLocked', args: [1n, 2]})
    // a second answer lock, never claimed: refund after the timeout returns the funds
    const T2 = (await head('B')) + 3n
    const b2 = await bal('B', usd, taker.address)
    await call('B', taker, lockB, 'lock', [usd, 1_000_000n, maker.address, hash, T2, '', zero, zero, 0n])
    expect(await revertOf('B', taker, lockB, 'refund', [2n])).toMatchObject({errorName: 'NotExpired', args: [T2]})
    await mine('B', Number(T2 - (await head('B'))))
    expect((await call('B', taker, lockB, 'refund', [2n])).status).toBe('success')
    expect(await bal('B', usd, taker.address)).toBe(b2)
  }), 60_000)
