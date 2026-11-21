import { createNode } from 'webevm'
import { createPublicClient, createWalletClient, custom, getAddress, parseEventLogs, type Address, type Hash, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AssetToken, Pool } from '@evmb/contracts'
import type { Request } from '@evmb/assets'

export const lp = privateKeyToAccount(`0x${'11'.repeat(32)}`)
export const trader = privateKeyToAccount(`0x${'22'.repeat(32)}`)
type Account = typeof lp
const abi = [...Pool.abi, ...AssetToken.abi]

/** A webevm node with GBP (2 dp), USD (6 dp), TKA and TKB (18 dp), held by `lp` and `trader`; always disposed. */
export async function withChain(fn: (c: {
  request: Request; gbp: Address; usd: Address; a18: Address; b18: Address
  /** deploys a Pool and approves it for every token from both accounts */
  deployPool: (base: Address, quote: Address) => Promise<Address>
  /** sends a call, returns hash, status and the Pool events it emitted */
  send: (from: Account, c: { to: Address; data: Hex }) => Promise<{ hash: Hash; status: string; events: { eventName: string; args: any }[] }>
  revertData: (from: Account, c: { to: Address; data: Hex }) => Promise<Hex>
  read: (address: Address, functionName: string, args?: unknown[]) => Promise<any>
}) => Promise<void>) {
  const node = await createNode({
    chainId: 31337, miningConfig: { type: 'auto' },
    initialBalances: { [lp.address]: 10n ** 21n, [trader.address]: 10n ** 21n },
  })
  try {
    const transport = custom({ request: ({ method, params }: any) => node.request({ method, params }) as any })
    const pub = createPublicClient({ transport })
    const wallet = (account: Account) => createWalletClient({ account, transport })
    const deploy = async (c: { abi: any; bytecode: Hex }, args: unknown[]) =>
      getAddress((await pub.waitForTransactionReceipt({
        hash: await wallet(lp).deployContract({ abi: c.abi, bytecode: c.bytecode, args, chain: null } as any),
      })).contractAddress!)
    const write = async (from: Account, address: Address, functionName: string, args: unknown[]) =>
      pub.waitForTransactionReceipt({ hash: await wallet(from).writeContract({ address, abi, functionName, args, chain: null, gas: 1_000_000n } as any) })
    const gbp = await deploy(AssetToken, ['British Pound', 'GBP', 2, 100_000_000n, lp.address])
    const usd = await deploy(AssetToken, ['US Dollar', 'USD', 6, 1_000_000_000_000n, lp.address])
    const a18 = await deploy(AssetToken, ['Token A', 'TKA', 18, 10n ** 30n, lp.address])
    const b18 = await deploy(AssetToken, ['Token B', 'TKB', 18, 10n ** 30n, lp.address])
    const tokens = [gbp, usd, a18, b18]
    for (const t of tokens) {
      const r = await pub.readContract({ address: t, abi, functionName: 'balanceOf', args: [lp.address] } as any) as bigint
      await write(lp, t, 'transfer', [trader.address, r / 4n])
    }
    const deployPool = async (base: Address, quote: Address) => {
      const pool = await deploy(Pool, [base, quote])
      for (const a of [lp, trader]) for (const t of tokens) await write(a, t, 'approve', [pool, 2n ** 255n])
      return pool
    }
    const send = async (from: Account, c: { to: Address; data: Hex }) => {
      const hash = await wallet(from).sendTransaction({ ...c, chain: null, gas: 1_000_000n } as any)
      const r = await pub.waitForTransactionReceipt({ hash })
      return { hash, status: r.status, events: parseEventLogs({ abi: Pool.abi, logs: r.logs } as any) as any[] }
    }
    const revertData = async (from: Account, c: { to: Address; data: Hex }) => {
      try {
        await node.request({ method: 'eth_call', params: [{ from: from.address, ...c }, 'latest'] } as any)
      } catch (e: any) {
        const d = e?.data ?? e?.cause?.data ?? e?.error?.data
        if (typeof d === 'string') return d as Hex
        throw e
      }
      throw new Error('did not revert')
    }
    const read = (address: Address, functionName: string, args: unknown[] = []) =>
      pub.readContract({ address, abi, functionName, args } as any) as Promise<any>
    await fn({ request: (method, params) => node.request({ method, params } as any) as Promise<unknown>, gbp, usd, a18, b18, deployPool, send, revertData, read })
  } finally {
    await node.dispose()
  }
}
