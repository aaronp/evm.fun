import { createNode } from 'webevm'
import { createPublicClient, createWalletClient, custom, getAddress, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AssetToken, OrderBook, Settlement } from '@evmb/contracts'
import type { Request, Wallet } from '../src'

export const maker = privateKeyToAccount(`0x${'11'.repeat(32)}`)
export const taker = privateKeyToAccount(`0x${'22'.repeat(32)}`)
export const other = privateKeyToAccount(`0x${'33'.repeat(32)}`)
export type Account = typeof maker

/** A webevm node (with state history, for replays) with GBP (2dp), USD (6dp), OrderBook and Settlement deployed; every
 * account holds both tokens and has approved both venues. Always disposed. */
export async function withChain(fn: (c: {
  request: Request; chainId: number; book: Address; settlement: Address; gbp: Address; usd: Address; fromBlock: bigint
  /** a Wallet for `a` whose txs carry a fixed gas limit, so a reverting tx is still mined */
  walletOf: (a: Account) => Wallet
  call: (from: Account, to: Address, abi: any, functionName: string, args: unknown[]) => Promise<'success' | 'reverted'>
  read: (to: Address, abi: any, functionName: string, args: unknown[]) => Promise<any>
  blockNumber: () => Promise<bigint>
}) => Promise<void>) {
  const node = await createNode({
    chainId: 31337, miningConfig: { type: 'auto' }, stateHistory: { blocks: 64 },
    initialBalances: Object.fromEntries([maker, taker, other].map(a => [a.address, 10n ** 21n])),
  })
  try {
    const transport = custom({ request: ({ method, params }: any) => node.request({ method, params }) as any })
    const pub = createPublicClient({ transport })
    const wallet = (account: Account) => createWalletClient({ account, transport })
    const deploy = async (c: { abi: any; bytecode: Hex }, args: unknown[]) => {
      const r = await pub.waitForTransactionReceipt({
        hash: await wallet(maker).deployContract({ abi: c.abi, bytecode: c.bytecode, args, chain: null } as any),
      })
      return { address: getAddress(r.contractAddress!), block: r.blockNumber }
    }
    const gbp = (await deploy(AssetToken, ['British Pound', 'GBP', 2, 100_000_000n, maker.address])).address
    const usd = (await deploy(AssetToken, ['US Dollar', 'USD', 6, 100_000_000_000n, maker.address])).address
    const ob = await deploy(OrderBook, [])
    const settlement = (await deploy(Settlement, [])).address
    const walletOf = (a: Account): Wallet => ({
      address: a.address,
      sendTransaction: async tx => pub.waitForTransactionReceipt({
        hash: await wallet(a).sendTransaction({ ...tx, chain: null, gas: 3_000_000n } as any),
      }),
      signTypedData: td => a.signTypedData(td as any),
    })
    const call = async (from: Account, to: Address, abi: any, functionName: string, args: unknown[]) => {
      const hash = await wallet(from).writeContract({ address: to, abi, functionName, args, chain: null, gas: 3_000_000n } as any)
      return (await pub.waitForTransactionReceipt({ hash })).status
    }
    for (const a of [taker, other]) {
      await call(maker, gbp, AssetToken.abi, 'transfer', [a.address, 10_000_000n])
      await call(maker, usd, AssetToken.abi, 'transfer', [a.address, 10_000_000_000n])
    }
    for (const a of [maker, taker, other])
      for (const t of [gbp, usd]) for (const s of [ob.address, settlement]) await call(a, t, AssetToken.abi, 'approve', [s, 2n ** 255n])
    await fn({
      request: (method, params) => node.request({ method, params } as any) as Promise<unknown>,
      chainId: 31337, book: ob.address, settlement, gbp, usd, fromBlock: ob.block, walletOf, call,
      read: (to, abi, functionName, args) => pub.readContract({ address: to, abi, functionName, args } as any),
      blockNumber: () => pub.getBlockNumber({ cacheTime: 0 }),
    })
  } finally {
    await node.dispose()
  }
}
