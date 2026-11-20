import { encodeDeployData, type Address } from 'viem'
import { Swap } from '@evmb/contracts'
import { findSwap } from '@evmb/swap'
import type { ChainHandle } from '../chain/handle'
import { contractsRegistry, type DeployedContract } from '../contracts/registry'
import type { Account } from '../store/accounts'
import { signAndSend } from '../tx/send'

export const NO_RECORDS = 'Benchmark chains keep no contract records'

/** Deploy position of a record: [block, tx index]; a tx the chain doesn't know sorts first. */
async function position(chain: ChainHandle, r: DeployedContract): Promise<[bigint, bigint]> {
  const rc = (await chain.request('eth_getTransactionReceipt', [r.txHash]).catch(() => null)) as { blockNumber: string; transactionIndex: string } | null
  return rc ? [BigInt(rc.blockNumber), BigInt(rc.transactionIndex)] : [-1n, -1n]
}

/** This chain's Swap: the newest-deployed `Swap` record (records are listed by address, so order them by deploy receipt). */
export async function swapFor(chain: ChainHandle): Promise<Address | undefined> {
  const named = (await contractsRegistry.list(chain.info.id)).filter(r => r.name === 'Swap')
  if (named.length < 2) return findSwap(named)
  const pos = await Promise.all(named.map(r => position(chain, r)))
  const order = named.map((r, i) => ({ r, p: pos[i]! })).sort((a, b) => (a.p[0] === b.p[0] ? (a.p[1] < b.p[1] ? -1 : a.p[1] > b.p[1] ? 1 : 0) : a.p[0] < b.p[0] ? -1 : 1))
  return findSwap(order.map(x => x.r))
}

/** Deploy Swap.sol from `from` and save its contract record. Refused on benchmark chains. */
export async function deploySwap(chain: ChainHandle, from: Account, onSent?: () => void): Promise<Address> {
  if (chain.info.ephemeral) throw new Error(NO_RECORDS)
  const r = await signAndSend(chain, from, { data: encodeDeployData({ abi: Swap.abi, bytecode: Swap.bytecode }) }, onSent)
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`Deploy ${r.status}${r.error ? `: ${r.error}` : ''}`)
  await contractsRegistry.add(chain.info.id, { address: r.contractAddress, name: 'Swap', abi: Swap.abi as any[], deployer: from.address, txHash: r.hash })
  return r.contractAddress
}
