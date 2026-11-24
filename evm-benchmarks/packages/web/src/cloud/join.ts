// Join a cloud chain with an invite code: this browser then follows it (read-only), signing as the joining account.
import { getAddress, type LocalAccount } from 'viem'
import { NodeClient, NodeError, claimTx } from '@evmb/node/src/client'
import type { ChainHandle } from '../chain/handle'
import type { createChainRegistry } from '../chain/registry'

/** "Joined <short id>": the chain name the form suggests. */
export const joinName = (chainId: string) => `Joined ${chainId.slice(0, 8)}`

const isUrl = (u: string) => { try { return /^https?:$/.test(new URL(u).protocol) } catch { return false } }
const isChainId = (s: string) => /^[A-Za-z0-9_-]{1,100}$/.test(s)

/** The longest invite code a join link carries (once trimmed); the invite wizard enforces the same limit. */
export const MAX_CODE_LENGTH = 200
export const codeUsable = (code: string) => { const c = code.trim(); return c.length > 0 && c.length <= MAX_CODE_LENGTH }

/** `#/cloud/join?node=…&chain=…&code=…`: the worker URL, chain id and invite code to prefill, when usable (a code is 1-200 chars once trimmed). */
export function joinPrefill(search: string): { nodeUrl?: string; chainId?: string; code?: string } {
  const p = new URLSearchParams(search)
  const node = p.get('node')?.trim() ?? '', chain = p.get('chain')?.trim() ?? '', code = p.get('code')?.trim() ?? ''
  return { ...(isUrl(node) && { nodeUrl: node }), ...(isChainId(chain) && { chainId: chain }), ...(code && code.length <= MAX_CODE_LENGTH && { code }) }
}

/** The join link for chain `chainId` on `nodeUrl` (`base`: the app's URL without the hash); carries `code` only when given and non-blank. */
export const joinLink = (base: string, nodeUrl: string, chainId: string, code?: string) =>
  `${base}#/cloud/join?${new URLSearchParams({ node: nodeUrl, chain: chainId, ...(code?.trim() && { code: code.trim() }) })}`

/** `search` without its `code` param (also an unusable one), with no bare "?" left. */
export function stripCode(search: string) {
  const p = new URLSearchParams(search); p.delete('code')
  return p.size ? `?${p}` : ''
}

/** The code a join link brought, kept after it leaves the address bar: only for that link's own node and chain. */
export const heldCodeFor = (held: { code: string; nodeUrl?: string; chainId?: string } | undefined, link: { nodeUrl?: string; chainId?: string }) =>
  held && held.nodeUrl === link.nodeUrl && held.chainId === link.chainId ? held.code : undefined

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
