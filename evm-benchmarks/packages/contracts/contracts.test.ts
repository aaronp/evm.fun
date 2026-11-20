import {expect, test} from 'bun:test'
import {createNode} from 'webevm'
import {createPublicClient, createWalletClient, custom, getAddress, parseEventLogs, type Address} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {AssetToken, AtomicSwap, MintableToken, Swap} from './index.ts'

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
    expect(await read(swap, Swap.abi, 'offers', [1n])).toEqual([maker.address, gbp, 100_000n, usd, 127_000_000n, Status.Open])
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
    expect((await read(swap, Swap.abi, 'offers', [1n]))[5]).toBe(Status.Filled)
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
    expect((await read(swap, Swap.abi, 'offers', [1n]))[5]).toBe(Status.Cancelled)
    expect(await revertOf(taker, 'take', [1n])).toMatchObject({errorName: 'OfferNotOpen', args: [1n, Status.Cancelled]})
  }), 60_000)

test('Swap: makeOffer with zero amount, same token or zero address reverts BadOffer', () =>
  withSwap(async ({swap, gbp, usd, maker, call, revertOf}) => {
    await call(maker, gbp, AssetToken.abi, 'approve', [swap, 100n])
    const zero = '0x0000000000000000000000000000000000000000'
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
