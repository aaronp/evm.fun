import { encodeDeployData } from 'viem'
import type { Asset } from '@evmb/assets'
import { AssetToken } from '@evmb/contracts'
import type { ChainHandle } from '../chain/handle'
import type { Account } from '../store/accounts'
import { signAndSend } from '../tx/send'
import { assetRegistry } from './registry'
import { tokenAsset } from './build'
import { contractsRegistry, type DeployedContract } from '../contracts/registry'

/** The token is on chain but its records failed to save: deploying again would make a duplicate. */
export class NotSavedError extends Error {}

/** Deploy `AssetToken` from `from` (who receives the supply) and save its contract and asset records. */
export async function launchToken(
  chain: ChainHandle, from: Account, t: { name: string; symbol: string; decimals: number; supply: bigint }, onSent?: () => void,
): Promise<Asset> {
  const data = encodeDeployData({ abi: AssetToken.abi, bytecode: AssetToken.bytecode, args: [t.name, t.symbol, t.decimals, t.supply, from.address] })
  const r = await signAndSend(chain, from, { data }, onSent)
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`Deploy ${r.status}${r.error ? `: ${r.error}` : ''}`)
  const at = r.contractAddress
  try {
    const a = tokenAsset(chain.info.id, at, { symbol: t.symbol, name: t.name, decimals: t.decimals }, { origin: 'launched', issuer: from.address, mintable: true })
    await contractsRegistry.add(chain.info.id, { address: at, name: a.name, abi: AssetToken.abi as DeployedContract['abi'], deployer: from.address, txHash: r.hash })
    await assetRegistry.add(a)
    return a
  } catch (e) {
    throw new NotSavedError(`Deployed at ${at} but not saved: ${e instanceof Error ? e.message : String(e)}`)
  }
}
