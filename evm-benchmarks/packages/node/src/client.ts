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
/**
 * Largest POST /chains body the worker takes (413 above it; checked before auth). The root DO forwards the dump to the
 * new chain's DO over RPC and the 201 carries the new dump back (Workers RPC messages are capped at 32 MiB), so 8 MiB
 * leaves room for both hops and the DO's 128 MB memory. evm.fun refuses a larger chain before spending a code.
 */
export const MAX_CREATE_BYTES = 8 * 1024 * 1024
const tx = { type: 'eip1559', maxFeePerGas: 0n, maxPriorityFeePerGas: 0n } as const

export interface BlockSummary { number: number; hash: string; stateRoot: string }
export interface CreateChainRequest { dump: SerializedState; setup: [Hex, Hex]; claim?: Hex }
export interface CreateChainResult { chainId: string; url: string; head: BlockSummary; dump: SerializedState }
export interface RemoteChainInfo { chainId: string; head: BlockSummary; admin: Address; access: Address; aliases: Address }
export interface CodeRecord { hash: Hex; expiry: number; usesLeft: number; redeemed: { by: Address; chainId: string; at: number }[] }
/** A block as GET /chains/:id/blocks serves it: header, raw txs, receipts. */
export type BlockRecord = StoredBlock
export interface Member { address: Address; role: 'admin' | 'writer' | 'reader'; name?: string; block?: number; behind?: number; seenAt?: number }
export interface NodesView { head: BlockSummary; admin: Address; readOpen: boolean; members: Member[] }
type RootInfo = { chainId: 'root'; admin: Address; access: Address; head: number }

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

export const accessTx = (account: LocalAccount, nonce: number, access: Address, fn: 'removeReader' | 'removeWriter' | 'setReadOpen' | 'revokeInvite', arg: Address | boolean | Hex) =>
  call(account, nonce, access, encodeFunctionData({ abi: ChainAccess.abi, functionName: fn, args: [arg] } as never))

export class NodeError extends Error {
  constructor(readonly status: number, readonly error: string) { super(`${status}: ${error}`) }
}

export class NodeClient {
  constructor(readonly baseUrl: string, private account?: LocalAccount, private opts: { name?: string } = {}) {}

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
    const res = await fetch(url, { method, headers, body: text || undefined })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new NodeError(res.status, (out as { error?: string }).error ?? res.statusText)
    return out as T
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
  submit(chainId: string, txs: Hex[]) { return this.req<{ head: BlockSummary }>('POST', `/chains/${chainId}/submit`, { txs }) }
  createChain(r: CreateChainRequest) { return this.req<CreateChainResult>('POST', '/chains', r) }
  codes() { return this.req<CodeRecord[]>('GET', '/chains/root/codes') }
}
