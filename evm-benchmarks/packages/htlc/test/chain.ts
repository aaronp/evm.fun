import { createNode } from 'webevm'
import { createPublicClient, createWalletClient, custom, getAddress, type Address, type Hash, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AssetToken, HashLock, type Contract } from '@evmb/contracts'
import type { Request } from '@evmb/assets'

export const maker = privateKeyToAccount(`0x${'11'.repeat(32)}`)
export const taker = privateKeyToAccount(`0x${'22'.repeat(32)}`)
export const other = privateKeyToAccount(`0x${'33'.repeat(32)}`)
type Account = typeof maker
export type K = 'A' | 'B'
type Call = { to: Address; data: Hex }

/**
 * Two webevm nodes: chain A ('dave') with GBP (2 dp) and a HashLock, chain B ('sue') with USD (6 dp), EUR (6 dp) and
 * a HashLock. The maker holds GBP on A; the taker and `other` hold USD and EUR on B; everyone approved its HashLock.
 * Both nodes are always disposed.
 */
export async function withChains(fn: (c: {
  request: Record<K, Request>
  lock: Record<K, Address>
  deployed: Record<K, bigint>
  gbp: Address; usd: Address; eur: Address
  /** sends `call`; returns the mined tx's hash and status */
  send: (k: K, from: Account, call: Call) => Promise<{ hash: Hash; status: 'success' | 'reverted'; block: bigint }>
  erc: (k: K, from: Account, token: Address, functionName: string, args: unknown[]) => Promise<void>
  bal: (k: K, token: Address, who: Address) => Promise<bigint>
  head: (k: K) => Promise<bigint>
  /** a block is made per transaction, so each self-transfer advances the chain by one block */
  mine: (k: K, n: number | bigint) => Promise<void>
  revertData: (k: K, from: Account, call: Call) => Promise<Hex>
  deploy: (k: K, c: Contract, args: unknown[]) => Promise<Address>
}) => Promise<void>) {
  const mk = () => createNode({
    chainId: 31337, miningConfig: { type: 'auto' },
    initialBalances: { [maker.address]: 10n ** 21n, [taker.address]: 10n ** 21n, [other.address]: 10n ** 21n },
  })
  const nodes = { A: await mk(), B: await mk() }
  try {
    const tr = (k: K) => custom({ request: ({ method, params }: any) => nodes[k].request({ method, params }) as any })
    const pub = { A: createPublicClient({ transport: tr('A') }), B: createPublicClient({ transport: tr('B') }) }
    const wallet = (k: K, account: Account) => createWalletClient({ account, transport: tr(k) })
    const deploy = async (k: K, c: Contract, args: unknown[]) => getAddress((await pub[k].waitForTransactionReceipt({
      hash: await wallet(k, maker).deployContract({ abi: c.abi, bytecode: c.bytecode, args, chain: null } as any),
    })).contractAddress!)
    const head = (k: K) => pub[k].getBlockNumber({ cacheTime: 0 })
    const send = async (k: K, from: Account, call: Call) => {
      const hash = await wallet(k, from).sendTransaction({ ...call, chain: null, gas: 500_000n } as any)
      const r = await pub[k].waitForTransactionReceipt({ hash })
      return { hash, status: r.status, block: r.blockNumber }
    }
    const erc = async (k: K, from: Account, token: Address, functionName: string, args: unknown[]) => {
      const hash = await wallet(k, from).writeContract({ address: token, abi: AssetToken.abi, functionName, args, chain: null, gas: 500_000n } as any)
      await pub[k].waitForTransactionReceipt({ hash })
    }
    const bal = (k: K, token: Address, who: Address) =>
      pub[k].readContract({ address: token, abi: AssetToken.abi, functionName: 'balanceOf', args: [who] }) as Promise<bigint>
    const mine = async (k: K, n: number | bigint) => {
      for (let i = 0; i < Number(n); i++) await send(k, other, { to: other.address, data: '0x' })
    }
    const revertData = async (k: K, from: Account, call: Call) => {
      try {
        await nodes[k].request({ method: 'eth_call', params: [{ from: from.address, ...call }, 'latest'] } as any)
      } catch (e: any) {
        const d = e?.data ?? e?.cause?.data ?? e?.error?.data
        if (typeof d === 'string') return d as Hex
        throw e
      }
      throw new Error('did not revert')
    }
    const gbp = await deploy('A', AssetToken, ['British Pound', 'GBP', 2, 1_000_000n, maker.address])
    const usd = await deploy('B', AssetToken, ['US Dollar', 'USD', 6, 10_000_000_000n, maker.address])
    const eur = await deploy('B', AssetToken, ['Euro', 'EUR', 6, 10_000_000_000n, maker.address])
    const deployed = { A: (await head('A')) + 1n, B: (await head('B')) + 1n }
    const lock = { A: await deploy('A', HashLock, []), B: await deploy('B', HashLock, []) }
    for (const who of [taker, other]) {
      await erc('B', maker, usd, 'transfer', [who.address, 1_000_000_000n])
      await erc('B', maker, eur, 'transfer', [who.address, 1_000_000_000n])
      await erc('B', who, usd, 'approve', [lock.B, 2n ** 255n])
      await erc('B', who, eur, 'approve', [lock.B, 2n ** 255n])
    }
    await erc('A', maker, gbp, 'approve', [lock.A, 2n ** 255n])
    const request = {
      A: (method: string, params: unknown[]) => nodes.A.request({ method, params } as any) as Promise<unknown>,
      B: (method: string, params: unknown[]) => nodes.B.request({ method, params } as any) as Promise<unknown>,
    }
    await fn({ request, lock, deployed, gbp, usd, eur, send, erc, bal, head, mine, revertData, deploy })
  } finally {
    await nodes.A.dispose()
    await nodes.B.dispose()
  }
}
