// UI-free client for the chain worker: deploy codes, set-up txs and a signing HTTP client.
import { encodeAbiParameters, encodeDeployData, encodeFunctionData, getContractAddress, keccak256, toBytes, type Address, type Hex, type LocalAccount } from 'viem'
import type { SerializedState } from 'webevm'
import { Aliases, ChainAccess } from '@evmb/contracts'
import { signRequest } from './auth'
import type { StoredBlock } from './store'
import { WORDS } from './words'

export const GRANT_READER = 1
export const GRANT_WRITER = 2
export const GRANT_CREATE_CHAIN = 4
export const GRANT_DEPLOY = 8
/**
 * Largest POST /chains body the worker takes (413 above it; checked before auth). The root DO forwards the dump to the
 * new chain's DO over RPC and the 201 carries the new dump back (Workers RPC messages are capped at 32 MiB), so 8 MiB
 * leaves room for both hops and the DO's 128 MB memory. evm.fun refuses a larger chain before spending a code.
 */
export const MAX_CREATE_BYTES = 8 * 1024 * 1024
/**
 * Largest POST /chains/:id/submit body the worker takes (413 above it; checked before auth). Other routes take 64 KiB.
 * 512 KiB keeps a block's stored row (txs plus receipts) well under Durable Object SQLite's 2 MB row limit.
 */
export const MAX_SUBMIT_BYTES = 512 * 1024
const tx = { type: 'eip1559', maxFeePerGas: 0n, maxPriorityFeePerGas: 0n } as const

export interface BlockSummary { number: number; hash: string; stateRoot: string }
/** One submitted tx's outcome. `refused` txs are not on chain: `nonce` = wrong nonce for its sender now, `invalid` = anything else. */
export type TxResult = { hash: Hex; result: 'mined'; block: number } | { hash: Hex; result: 'refused'; code: 'nonce' | 'invalid'; reason: string }
/** Submit reply: the head after the request, and one result per tx in request order. */
export interface SubmitResult { head: BlockSummary; results: TxResult[] }
/** `r` if every tx was mined; else throws naming the first refused tx and its reason. For callers that need all of a submit on chain. */
export function mined(r: SubmitResult): SubmitResult {
  const no = r.results.find((x) => x.result === 'refused')
  if (no?.result === 'refused') throw new Error(`tx ${no.hash} refused (${no.code}): ${no.reason}`)
  return r
}
/** Three forms: neither `claim` nor `chainId` (root admin creates root); `claim` (evm.fun's ChainAccess code); `chainId` (+ `redeem`, an Onboarding `redeem(code, chainId)` tx, unless already granted). */
export interface CreateChainRequest { dump: SerializedState; setup: [Hex, Hex]; claim?: Hex; chainId?: string; redeem?: Hex }
export interface CreateChainResult { chainId: string; url: string; head: BlockSummary; dump: SerializedState }
export interface RemoteChainInfo { chainId: string; head: BlockSummary; admin: Address; access: Address; aliases: Address }
export interface CodeRecord { hash: Hex; expiry: number; usesLeft: number; redeemed: { by: Address; chainId: string; at: number }[] }
/** A block as GET /chains/:id/blocks serves it: header, raw txs, receipts. */
export type BlockRecord = StoredBlock
export interface Member { address: Address; role: 'admin' | 'writer' | 'reader'; deploy: boolean; name?: string; block?: number; behind?: number; seenAt?: number }
export interface NodesView { head: BlockSummary; admin: Address; readOpen: boolean; /** false on a chain whose ChainAccess predates the deploy role (writers deploy) */ deployRole: boolean; members: Member[] }
type RootInfo = { chainId: 'root'; admin: Address; access: Address; head: number; onboarding: Address | null }

export const codeHash = (code: string): Hex => keccak256(toBytes(code))

export function generateCode(): string {
  const r = crypto.getRandomValues(new Uint32Array(4))
  // ponytail: modulo bias on a ~300-word list is negligible (2^-22); fine for a rate-limited code
  return [...r].map((n) => WORDS[n % WORDS.length]).join('-')
}

/** Deploy ChainAccess (nonce) then Aliases pointing at it (nonce + 1); the signer becomes admin. */
export async function setupTxs(account: LocalAccount, nonce: number, chainId: number): Promise<[Hex, Hex]> {
  const access = getContractAddress({ from: account.address, nonce: BigInt(nonce) })
  const data = (c: typeof ChainAccess, args?: unknown[]) => encodeDeployData({ abi: c.abi, bytecode: c.bytecode, args } as never)
  return Promise.all([
    account.signTransaction({ ...tx, chainId, nonce, data: data(ChainAccess), gas: 3_000_000n }),
    account.signTransaction({ ...tx, chainId, nonce: nonce + 1, data: data(Aliases, [access]), gas: 1_500_000n }),
  ])
}

const call = (account: LocalAccount, nonce: number, to: Address, data: Hex) =>
  account.signTransaction({ ...tx, chainId: 31337, nonce, to, data, gas: 300_000n })

export const claimTx = (account: LocalAccount, nonce: number, code: string, access: Address) =>
  call(account, nonce, access, encodeFunctionData({ abi: ChainAccess.abi, functionName: 'claim', args: [code] }))

export const inviteTx = (account: LocalAccount, nonce: number, access: Address, code: string, ttlS: number, uses: number, grants = GRANT_CREATE_CHAIN) =>
  call(account, nonce, access, encodeFunctionData({ abi: ChainAccess.abi, functionName: 'invite', args: [codeHash(code), BigInt(ttlS), uses, grants] }))

export const accessTx = (account: LocalAccount, nonce: number, access: Address, fn: 'removeReader' | 'removeWriter' | 'addDeployer' | 'removeDeployer' | 'setReadOpen' | 'revokeInvite', arg: Address | boolean | Hex) =>
  call(account, nonce, access, encodeFunctionData({ abi: ChainAccess.abi, functionName: fn, args: [arg] } as never))

export class NodeError extends Error {
  constructor(readonly status: number, readonly error: string) { super(`${status}: ${error}`) }
}

export class NodeClient {
  /** `timeoutMs` (default 30 s): a hung request must not block dispose, delete, New or Open; it rejects with a TimeoutError. */
  constructor(readonly baseUrl: string, readonly account?: LocalAccount, private opts: { name?: string; timeoutMs?: number } = {}) {}

  private async req<T>(method: string, path: string, body?: unknown, sign = true): Promise<T> {
    const url = new URL(path, this.baseUrl)
    const text = body === undefined ? '' : JSON.stringify(body)
    const headers: Record<string, string> = text ? { 'content-type': 'application/json' } : {}
    if (sign) {
      if (this.opts.name) headers['x-node-name'] = encodeURIComponent(this.opts.name)
      if (!this.account) throw new Error('this request needs a signing account')
      const s = await signRequest(this.account, method, url, text)
      Object.assign(headers, { 'x-ts': s.ts, 'x-nonce': s.nonce, 'x-sig': s.sig })
    }
    // not AbortSignal.timeout: its timer outlives the request; this one is cleared as soon as the body is read
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(new DOMException('request timed out', 'TimeoutError')), this.opts.timeoutMs ?? 30_000)
    let res: Response, out: unknown
    try {
      res = await fetch(url, { method, headers, body: text || undefined, signal: ctl.signal })
      out = await res.json().catch(() => { if (ctl.signal.aborted) throw ctl.signal.reason; return {} })
    } finally { clearTimeout(timer) }
    if (!res.ok) throw new NodeError(res.status, (out as { error?: string }).error ?? res.statusText)
    return out as T
  }

  /** A `ws(s):` URL for GET /chains/:id/subscribe, signed in its query (a socket can't carry headers). */
  async subscribeUrl(chainId: string) {
    if (!this.account) throw new Error('this request needs a signing account')
    const url = new URL(`/chains/${chainId}/subscribe`, this.baseUrl)
    const s = await signRequest(this.account, 'GET', url, '')
    for (const [k, v] of Object.entries(s)) url.searchParams.set(k, v)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.href
  }

  health() { return this.req<{ ok: true; root: null | RootInfo }>('GET', '/health', undefined, false) }
  info(chainId: string) { return this.req<RemoteChainInfo>('GET', `/chains/${chainId}`) }
  async nonce(chainId: string) { return (await this.joinInfo(chainId)).nonce }
  /** The signer's nonce and the chain's ChainAccess address: what a non-member needs to build its `claimTx`. */
  joinInfo(chainId: string) { return this.req<{ nonce: number; access: Address }>('GET', `/chains/${chainId}/nonce`) }
  state(chainId: string) { return this.req<{ head: BlockSummary; dump: SerializedState }>('GET', `/chains/${chainId}/state`) }
  blocks(chainId: string, after: number) { return this.req<{ head: BlockSummary; blocks: BlockRecord[] }>('GET', `/chains/${chainId}/blocks?after=${after}`) }
  nodes(chainId: string) { return this.req<NodesView>('GET', `/chains/${chainId}/nodes`) }
  join(chainId: string, claim: Hex) { return this.req<{ head: BlockSummary; role: 'reader' | 'writer' }>('POST', `/chains/${chainId}/join`, { claim }) }
  submit(chainId: string, txs: Hex[]) { return this.req<SubmitResult>('POST', `/chains/${chainId}/submit`, { txs }) }
  createChain(r: CreateChainRequest) { return this.req<CreateChainResult>('POST', '/chains', r) }
  codes() { return this.req<CodeRecord[]>('GET', '/chains/root/codes') }
}
