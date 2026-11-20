import { createNode } from 'webevm'
import { createPublicClient, createWalletClient, custom, getAddress, type Address, type Hash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AssetToken, Swap } from '@evmb/contracts'
import type { Request } from '@evmb/assets'

export const maker = privateKeyToAccount(`0x${'11'.repeat(32)}`)
export const taker = privateKeyToAccount(`0x${'22'.repeat(32)}`)
export const other = privateKeyToAccount(`0x${'33'.repeat(32)}`)
type Account = typeof maker

/** A webevm node with GBP (2dp), USD (6dp) and a Swap deployed; always disposed. */
export async function withSwap(fn: (c: {
  request: Request; swap: Address; gbp: Address; usd: Address
  send: (from: Account, to: Address, abi: any, functionName: string, args: unknown[]) => Promise<'success' | 'reverted'>
  /** like send, but returns the mined tx's hash */
  tx: (from: Account, to: Address, abi: any, functionName: string, args: unknown[]) => Promise<Hash>
  revertData: (from: Account, to: Address, data: `0x${string}`) => Promise<`0x${string}`>
}) => Promise<void>, opts: { stateHistory?: number } = {}) {
  const node = await createNode({
    chainId: 31337, miningConfig: { type: 'auto' },
    initialBalances: { [maker.address]: 10n ** 21n, [taker.address]: 10n ** 21n, [other.address]: 10n ** 21n },
    ...(opts.stateHistory && { stateHistory: { blocks: opts.stateHistory } }),
  })
  try {
    const transport = custom({ request: ({ method, params }: any) => node.request({ method, params }) as any })
    const pub = createPublicClient({ transport })
    const wallet = (account: Account) => createWalletClient({ account, transport })
    const deploy = async (c: { abi: any; bytecode: `0x${string}` }, args: unknown[]) =>
      getAddress((await pub.waitForTransactionReceipt({
        hash: await wallet(maker).deployContract({ abi: c.abi, bytecode: c.bytecode, args, chain: null } as any),
      })).contractAddress!)
    const gbp = await deploy(AssetToken, ['British Pound', 'GBP', 2, 1_000_000n, maker.address])
    const usd = await deploy(AssetToken, ['US Dollar', 'USD', 6, 10_000_000_000n, maker.address])
    const swap = await deploy(Swap, [])
    const tx = async (from: Account, to: Address, abi: any, functionName: string, args: unknown[]) => {
      const hash = await wallet(from).writeContract({ address: to, abi, functionName, args, chain: null, gas: 500_000n } as any)
      await pub.waitForTransactionReceipt({ hash })
      return hash
    }
    const send = async (from: Account, to: Address, abi: any, functionName: string, args: unknown[]) =>
      (await pub.getTransactionReceipt({ hash: await tx(from, to, abi, functionName, args) })).status
    await send(maker, usd, AssetToken.abi, 'transfer', [taker.address, 5_000_000_000n])
    const revertData = async (from: Account, to: Address, data: `0x${string}`) => {
      try {
        await node.request({ method: 'eth_call', params: [{ from: from.address, to, data }, 'latest'] } as any)
      } catch (e: any) {
        const d = e?.data ?? e?.cause?.data ?? e?.error?.data
        if (typeof d === 'string') return d as `0x${string}`
        throw e
      }
      throw new Error('did not revert')
    }
    await fn({ request: (method, params) => node.request({ method, params } as any) as Promise<unknown>, swap, gbp, usd, send, tx, revertData })
  } finally {
    await node.dispose()
  }
}
