// Deploy a browser chain to the worker with a deploy code (spec: 2026-11-23-deploy-to-cf-design, "Deploying a chain").
import { keccak256, type LocalAccount } from 'viem'
import { claimTx, setupTxs, type CreateChainResult, type NodeClient } from '@evmb/node/src/client'
import type { ChainHandle, ChainInfo } from '../chain/handle'
import type { createChainRegistry } from '../chain/registry'

export type DeployStep = 'prepare' | 'code' | 'node' | 'replace'
export const MISMATCH = "the deployed chain differs from your browser's"

/** Why this chain can't be deployed, if it can't. */
export const cannotDeploy = (info: ChainInfo): string | undefined =>
  info.ephemeral ? "Benchmark chains aren't saved, so they can't be deployed"
    : info.type !== 'plain' ? 'Only plain chains can be deployed for now' : undefined

/**
 * Upload the chain with two set-up txs signed by `account` and a claim of `code` on the root chain; on success the
 * local chain is replaced by the deployed one (same head hash) and marked deployed. On any refusal nothing local changes.
 * `onStep` is called as each step starts, with its under-the-hood detail.
 */
export async function deployChain(o: {
  chain: ChainHandle; account: LocalAccount; code: string; client: NodeClient
  registry: Pick<ReturnType<typeof createChainRegistry>, 'replaceState' | 'setDeployed'>
  onStep(step: DeployStep, detail: string): void
}): Promise<CreateChainResult> {
  const { chain, account, client, registry, onStep } = o
  const why = cannotDeploy(chain.info)
  if (why) throw new Error(why)
  const id = chain.info.id
  const dump = await chain.approach.snapshot!()
  const nonce = Number(BigInt((await chain.request('eth_getTransactionCount', [account.address, 'latest'])) as string))
  const setup = await setupTxs(account, nonce, 31337)
  onStep('prepare', `set-up txs ${keccak256(setup[0])}, ${keccak256(setup[1])} from ${account.address}`)

  const root = (await client.health()).root
  if (!root) throw new Error(`${client.baseUrl} has no root chain yet`)
  const claim = await claimTx(account, await client.nonce('root'), o.code.trim(), root.access)
  onStep('code', `claim tx ${keccak256(claim)} on the root chain at ${client.baseUrl}`)
  const r = await client.createChain({ dump, setup, claim })

  onStep('node', `chain ${r.chainId} at ${r.url}, head #${r.head.number}`)
  if (r.dump.blocks.at(-1)?.hash !== r.head.hash) throw new Error(MISMATCH) // checked before anything local changes

  onStep('replace', `head #${r.head.number} ${r.head.hash}`)
  const h = await registry.replaceState(id, r.dump)
  const local = (await h.request('eth_getBlockByNumber', ['latest', false])) as { hash?: string } | null
  if (local?.hash !== r.head.hash) {
    await registry.replaceState(id, dump).catch(() => {}) // put the browser's chain back as it was
    throw new Error(MISMATCH)
  }
  await registry.setDeployed(id, { nodeUrl: client.baseUrl, chainId: r.chainId, at: new Date().toISOString(), head: r.head.number })
  return r
}
