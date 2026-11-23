// Deploy a browser chain to the worker with a deploy code (spec: 2026-11-23-deploy-to-cf-design, "Deploying a chain").
import { getAddress, keccak256, numberToHex, type Address, type Hex, type LocalAccount } from 'viem'
import { MAX_CREATE_BYTES, NodeClient, NodeError, claimTx, setupTxs, type CreateChainResult } from '@evmb/node/src/client'
import type { ChainHandle, ChainInfo, Deployed } from '../chain/handle'
import type { createChainRegistry } from '../chain/registry'

export type DeployStep = 'prepare' | 'code' | 'node' | 'replace'
export const MISMATCH = "the deployed chain differs from your browser's"

/** The deployed chain's URL (a stored nodeUrl is validated on Open, but never let a bad one break a page). */
export function deployedUrl(d: Pick<Deployed, 'nodeUrl' | 'chainId'>): string {
  try { return new URL(`/chains/${d.chainId}`, d.nodeUrl).href } catch { return `${d.nodeUrl}/chains/${d.chainId}` }
}

/** Why this chain can't be deployed, if it can't. */
export const cannotDeploy = (info: ChainInfo): string | undefined =>
  info.follows ? `Already follows ${info.follows.chainId}`
    : info.deployed ? `Already deployed as ${info.deployed.chainId}`
    : info.ephemeral ? "Benchmark chains aren't saved, so they can't be deployed"
    : info.type !== 'plain' ? 'Only plain chains can be deployed for now' : undefined

/** An error tagged with the step it failed at (`chainId`, `url`: the cloud chain exists). */
const at = <E extends Error>(e: E, step: DeployStep, extra: { chainId?: string; url?: string } = {}) => Object.assign(e, { step }, extra)
const msg = (e: unknown) => (e instanceof NodeError ? e.error : e instanceof Error ? e.message : String(e))

/**
 * Upload the chain with two set-up txs signed by `account` and a claim of `code` on the root chain; on success the
 * local chain is replaced by the deployed one, its head hash checked, then converted to a follower of it (same id)
 * signing as `account`. Errors carry `step` (where it failed). Before the cloud chain exists, nothing local changes.
 * After, a failed match says "Deployed as <id>…", the browser copy is put back and `deployed` is not recorded (the
 * copies differ); a failed put-back is reported too. A failed conversion says "Deployed as <id>…" too and leaves a
 * plain chain matching the cloud head with `deployed` recorded, so `convertDeployed` converts it when next opened.
 * `onStep` is called as each step starts, with its under-the-hood detail.
 */
export async function deployChain(o: {
  chain: ChainHandle; account: LocalAccount; code: string; client: NodeClient
  registry: Pick<ReturnType<typeof createChainRegistry>, 'replaceState' | 'setDeployed' | 'convertToFollower'>
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
  // the claim tx (added below) is a few hundred bytes; the dump is ASCII JSON, so length = bytes
  const size = JSON.stringify({ dump, setup }).length + 1024
  if (size > MAX_CREATE_BYTES) throw at(new Error(`Your chain is too large to deploy (${(size / 2 ** 20).toFixed(1)} MB, limit ${MAX_CREATE_BYTES / 2 ** 20} MB)`), 'prepare')
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
  } catch (e) {
    let text = `Deployed as ${r.chainId} (${r.url}), but your browser copy couldn't be matched: ${msg(e)}`
    try { await registry.replaceState(id, dump) } catch (back) { text += `; putting your browser copy back failed too: ${msg(back)}` }
    throw at(new Error(text), 'replace', { chainId: r.chainId, url: r.url })
  }
  try {
    await registry.convertToFollower(id, { nodeUrl: client.baseUrl, chainId: r.chainId, account: account.address })
  } catch (e) {
    let text = `Deployed as ${r.chainId} (${r.url}), but your browser copy couldn't be switched to follow it: ${msg(e)}`
    try {
      await registry.setDeployed(id, { nodeUrl: client.baseUrl, chainId: r.chainId, at: new Date().toISOString(), head: r.head.number })
    } catch (rec) { text += `; recording the deploy failed too: ${msg(rec)}` }
    throw at(new Error(text), 'replace', { chainId: r.chainId, url: r.url })
  }
  return r
}

/**
 * A plain chain deployed before deploys converted (it has `deployed`): make it a follower of its cloud chain, signing
 * as the cloud chain's admin (whichever of `accounts` it is). Converts when the local block at `deployed.head` is the
 * cloud's (same hash), is the head, and nothing is pending — or when `force` (the user confirmed). Otherwise
 * `'diverged'`, nothing changed. Without the admin's key it refuses, nothing changed.
 */
export async function convertDeployed(id: string, o: {
  registry: Pick<ReturnType<typeof createChainRegistry>, 'open' | 'convertToFollower'>
  /** this browser's keys: the admin among them signs the follower */
  accounts: LocalAccount[]
  force?: boolean
}): Promise<'converted' | 'diverged'> {
  const h = await o.registry.open(id)
  const d = h.info.deployed
  if (!d || h.info.type !== 'plain') throw new Error(`chain ${id} isn't a deployed plain chain`)
  const n = Number(BigInt((await h.request('eth_blockNumber', [])) as string))
  if (!o.force && (n !== d.head || (h.approach.pending?.() ?? 0) > 0)) return 'diverged'
  let admin: LocalAccount | undefined, known: Address | undefined
  for (const a of o.accounts) {
    try {
      known = (await new NodeClient(d.nodeUrl, a).info(d.chainId)).admin
      if (known.toLowerCase() === a.address.toLowerCase()) { admin = a; break }
    } catch (e) { if (!(e instanceof NodeError && e.status === 403)) throw e } // not a member: try the next key
  }
  if (!admin) throw new Error(`Needs the chain admin's key${known ? ` (${known})` : ''}`)
  if (!o.force) {
    const cloud = (await new NodeClient(d.nodeUrl, admin).blocks(d.chainId, d.head - 1)).blocks[0]
    const local = (await h.request('eth_getBlockByNumber', [numberToHex(d.head), false])) as { hash?: string } | null
    if (!cloud || cloud.header.hash !== local?.hash) return 'diverged'
  }
  await o.registry.convertToFollower(id, { nodeUrl: d.nodeUrl, chainId: d.chainId, account: getAddress(admin.address) })
  return 'converted'
}
