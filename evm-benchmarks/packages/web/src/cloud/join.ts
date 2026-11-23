// Join a cloud chain with an invite code: this browser then follows it (read-only), signing as the joining account.
import { getAddress, type LocalAccount } from 'viem'
import { NodeClient, NodeError, claimTx } from '@evmb/node/src/client'
import type { ChainHandle } from '../chain/handle'
import type { createChainRegistry } from '../chain/registry'

/** "Joined <short id>": the chain name the form suggests. */
export const joinName = (chainId: string) => `Joined ${chainId.slice(0, 8)}`

const isUrl = (u: string) => { try { return /^https?:$/.test(new URL(u).protocol) } catch { return false } }
const isChainId = (s: string) => /^[A-Za-z0-9_-]{1,100}$/.test(s)

/** `#/cloud/join?node=…&chain=…`: the worker URL and chain id to prefill, when usable. Never a code (codes aren't put in links). */
export function joinPrefill(search: string): { nodeUrl?: string; chainId?: string } {
  const p = new URLSearchParams(search)
  const node = p.get('node')?.trim() ?? '', chain = p.get('chain')?.trim() ?? ''
  return { ...(isUrl(node) && { nodeUrl: node }), ...(isChainId(chain) && { chainId: chain }) }
}

/** The join link for chain `chainId` on `nodeUrl` (`base`: the app's URL without the hash). Never carries a code. */
export const joinLink = (base: string, nodeUrl: string, chainId: string) =>
  `${base}#/cloud/join?${new URLSearchParams({ node: nodeUrl, chain: chainId })}`

/**
 * Claim `code` on cloud chain `chainId` as `account`, then follow it as a new chain named `name`. A refusal throws
 * the worker's message and adds nothing. `client` signs as `account` (with its label as the device name).
 * Once the code is spent the chain is saved before it is opened, so a failure to open keeps it listed: that throws
 * "Joined, but couldn't open it yet: …" with `joined` (the new chain's id).
 */
export async function joinChain(o: {
  client: NodeClient; chainId: string; code: string; account: LocalAccount; name: string
  registry: Pick<ReturnType<typeof createChainRegistry>, 'putFollower' | 'open' | 'assertRoom'>
}): Promise<ChainHandle> {
  const { client, chainId, account, registry } = o
  registry.assertRoom() // before the code is spent
  try {
    const { nonce, access } = await client.joinInfo(chainId)
    await client.join(chainId, await claimTx(account, nonce, o.code.trim(), access))
  } catch (e) {
    throw e instanceof NodeError ? new Error(e.error) : e
  }
  const id = crypto.randomUUID()
  await registry.putFollower({ id, name: o.name.trim() || joinName(chainId), createdAt: new Date().toISOString(), contracts: [], follows: { nodeUrl: client.baseUrl, chainId, account: getAddress(account.address) } })
  try {
    return await registry.open(id)
  } catch (e) {
    throw Object.assign(new Error(`Joined, but couldn't open it yet: ${e instanceof Error ? e.message : String(e)}`), { joined: id })
  }
}
