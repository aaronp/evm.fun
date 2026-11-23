// Deploy a browser chain to the worker with a deploy code (spec: 2026-11-23-deploy-to-cf-design, "Deploying a chain").
import { keccak256, type Hex, type LocalAccount } from 'viem'
import { NodeError, claimTx, setupTxs, type CreateChainResult, type NodeClient } from '@evmb/node/src/client'
import type { ChainHandle, ChainInfo, Deployed } from '../chain/handle'
import type { createChainRegistry } from '../chain/registry'

export type DeployStep = 'prepare' | 'code' | 'node' | 'replace'
export const MISMATCH = "the deployed chain differs from your browser's"

/** The deployed chain's URL (a stored nodeUrl is validated on Open, but never let a bad one break a page). */
export function deployedUrl(d: Deployed): string {
  try { return new URL(`/chains/${d.chainId}`, d.nodeUrl).href } catch { return `${d.nodeUrl}/chains/${d.chainId}` }
}

/** Why this chain can't be deployed, if it can't. */
export const cannotDeploy = (info: ChainInfo): string | undefined =>
  info.deployed ? `Already deployed as ${info.deployed.chainId}`
    : info.ephemeral ? "Benchmark chains aren't saved, so they can't be deployed"
    : info.type !== 'plain' ? 'Only plain chains can be deployed for now' : undefined

/** An error tagged with the step it failed at (`chainId`: the cloud chain exists). */
const at = <E extends Error>(e: E, step: DeployStep, extra: { chainId?: string } = {}) => Object.assign(e, { step }, extra)
const msg = (e: unknown) => (e instanceof NodeError ? e.error : e instanceof Error ? e.message : String(e))

/**
 * Upload the chain with two set-up txs signed by `account` and a claim of `code` on the root chain; on success the
 * local chain is replaced by the deployed one (same head hash) and marked deployed. Errors carry `step` (where it
 * failed). Before the cloud chain exists, nothing local changes. After, a failed match says "Deployed as <id>…",
 * the browser copy is put back and `deployed` is not recorded (the copies differ); a failed put-back is reported too.
 * `onStep` is called as each step starts, with its under-the-hood detail.
 */
export async function deployChain(o: {
  chain: ChainHandle; account: LocalAccount; code: string; client: NodeClient
  registry: Pick<ReturnType<typeof createChainRegistry>, 'replaceState' | 'setDeployed'>
  onStep(step: DeployStep, detail: string): void
}): Promise<CreateChainResult> {
  const { chain, account, client, registry, onStep } = o
  const why = cannotDeploy(chain.info)
  if (why) throw at(new Error(why), 'prepare')
  const pending = chain.approach.pending?.() ?? 0
  if (pending > 0) throw at(new Error(`Wait for ${pending} pending transactions to settle, then deploy`), 'prepare')
  const id = chain.info.id
  const dump = await chain.approach.snapshot!()
  const nonce = Number(BigInt((await chain.request('eth_getTransactionCount', [account.address, 'latest'])) as string))
  const setup = await setupTxs(account, nonce, 31337)
  onStep('prepare', `set-up txs ${keccak256(setup[0])}, ${keccak256(setup[1])} from ${account.address}`)

  let claim: Hex
  try {
    const root = (await client.health()).root
    if (!root) throw new Error(`${client.baseUrl} has no root chain yet`)
    claim = await claimTx(account, await client.nonce('root'), o.code.trim(), root.access)
  } catch (e) { throw at(e as Error, 'code') }
  onStep('code', `claim tx ${keccak256(claim)} on the root chain at ${client.baseUrl}`)
  onStep('node', `POST ${new URL('/chains', client.baseUrl).href}`)
  let r: CreateChainResult
  try {
    r = await client.createChain({ dump, setup, claim })
  } catch (e) {
    // one request checks the code (403 refused, 429 too many failures) and then starts the node (anything else)
    throw at(e as Error, e instanceof NodeError && (e.status === 403 || e.status === 429) ? 'code' : 'node')
  }

  onStep('replace', `chain ${r.chainId} at ${r.url}, head #${r.head.number} ${r.head.hash}`)
  try {
    if (r.dump.blocks.at(-1)?.hash !== r.head.hash) throw new Error(MISMATCH)
    const h = await registry.replaceState(id, r.dump)
    const local = (await h.request('eth_getBlockByNumber', ['latest', false])) as { hash?: string } | null
    if (local?.hash !== r.head.hash) throw new Error(MISMATCH)
    await registry.setDeployed(id, { nodeUrl: client.baseUrl, chainId: r.chainId, at: new Date().toISOString(), head: r.head.number })
  } catch (e) {
    let text = `Deployed as ${r.chainId} (${r.url}), but your browser copy couldn't be matched: ${msg(e)}`
    try { await registry.replaceState(id, dump) } catch (back) { text += `; putting your browser copy back failed too: ${msg(back)}` }
    throw at(new Error(text), 'replace', { chainId: r.chainId })
  }
  return r
}
