// Shared by the Durable Object and the device replicas: the same node config and the
// same block-application step on both sides is what makes replay comparable.
import { createNode, type SlimNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, recoverMessageAddress, type Hex, type LocalAccount } from 'viem'
import ACCESS_ARTIFACT from './ChainAccess.json'

export const ACCESS = '0xacce550000000000000000000000000000000000' as const
export const ACCESS_ABI = ACCESS_ARTIFACT.abi as any[]
export interface AccessConfig { admin: string; readOpen?: boolean; readers?: string[]; writers?: string[] }
export interface Genesis { chainId: number; timestamp: number; alloc: Record<string, string>; access?: AccessConfig }

const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`
const mapSlot = (key: string, slot: number) => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [key as Hex, BigInt(slot)]))
/** ChainAccess pre-deployed in genesis: runtime code + storage written directly (layout checked by build-access.ts). */
export function accessGenesis(a: AccessConfig) {
  const storage: Record<string, string> = { [word(0n)]: word((a.readOpen ? 1n << 160n : 0n) | BigInt(a.admin)) }
  for (const r of a.readers ?? []) storage[mapSlot(r, 1)] = word(1n)
  for (const w of a.writers ?? []) storage[mapSlot(w, 2)] = word(1n)
  return { code: ACCESS_ARTIFACT.runtime, storage }
}
export const accessCall = (fn: string, args: unknown[]) => encodeFunctionData({ abi: ACCESS_ABI, functionName: fn, args })
export async function accessView(node: SlimNode, fn: string, args: unknown[]) {
  const ret = await node.request({ method: 'eth_call', params: [{ to: ACCESS, data: accessCall(fn, args) }, 'latest'] })
  return decodeFunctionResult({ abi: ACCESS_ABI, functionName: fn, data: ret as Hex })
}
export interface BlockRecord {
  number: number; hash: string; parentHash: string; timestamp: number; stateRoot: string
  txs: Hex[]; receipts: unknown[]; proposer?: string
}
export interface Chain { node: SlimNode; env: { timestamp?: bigint; baseFeePerGas?: bigint } }

type Wasm = Parameters<typeof createRevmEngine>[0]['wasm']

export async function makeChain(g: Genesis, wasm: Wasm): Promise<Chain> {
  // ponytail: webevm has no per-block timestamp knob (no evm_setNextBlockTimestamp), but it keeps
  // options.blockEnv by reference and reads .timestamp at each mine, so we mutate it per block.
  // Relies on webevm 0.9.1 internals; a real build wants a mine({timestamp}) option upstream.
  // baseFee 0: gas is free on a personal chain, so a fresh joiner key with no balance can send claim(code)
  const env: { timestamp?: bigint; baseFeePerGas?: bigint } = { baseFeePerGas: 0n }
  const node = await createNode({
    chainId: g.chainId,
    computeStateRoot: true,
    miningConfig: { type: 'manual' },
    genesisTimestamp: BigInt(g.timestamp),
    initialState: {
      ...Object.fromEntries(Object.entries(g.alloc).map(([a, b]) => [a.toLowerCase(), { balance: BigInt(b) }])),
      ...(g.access ? { [ACCESS]: accessGenesis(g.access) } : {}),
    },
    blockEnv: env,
    engine: await createRevmEngine({ wasm }),
  })
  return { node, env }
}

/** Execute `txs` as one block at `timestamp`. Throws if any tx is rejected (caller rolls back). */
export async function applyBlock(c: Chain, timestamp: number, txs: Hex[]) {
  c.env.timestamp = BigInt(timestamp)
  const hashes: string[] = []
  for (const raw of txs) hashes.push((await c.node.request({ method: 'eth_sendRawTransaction', params: [raw] })) as string)
  const mined = await c.node.mine()
  const receipts = await Promise.all(hashes.map((h) => c.node.request({ method: 'eth_getTransactionReceipt', params: [h] })))
  const blk = (await c.node.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })) as { parentHash: string }
  return {
    number: mined.blockNumber, hash: mined.blockHash, parentHash: blk.parentHash, timestamp,
    stateRoot: await c.node.getStateRoot(), txs, receipts,
  } satisfies BlockRecord
}

// ---- request auth: EIP-191 personal_sign over method, target, sha256(body), ts, nonce ----
export const AUTH_PARAMS = ['ts', 'nonce', 'sig'] as const

export function canonicalTarget(url: URL) {
  const u = new URL(url)
  for (const p of AUTH_PARAMS) u.searchParams.delete(p)
  return u.pathname + u.search
}

export async function sha256Hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const authMessage = (method: string, target: string, bodyHash: string, ts: string, nonce: string) =>
  `cf-chain v1\n${method} ${target}\n${bodyHash}\n${ts}\n${nonce}`

export async function signRequest(account: LocalAccount, method: string, url: URL, body: string) {
  const ts = String(Math.floor(Date.now() / 1000))
  const nonce = crypto.randomUUID()
  const sig = await account.signMessage!({ message: authMessage(method, canonicalTarget(url), await sha256Hex(body), ts, nonce) })
  return { ts, nonce, sig }
}

export async function recoverSigner(method: string, url: URL, body: string, a: { ts: string; nonce: string; sig: string }) {
  return (await recoverMessageAddress({
    message: authMessage(method, canonicalTarget(url), await sha256Hex(body), a.ts, a.nonce),
    signature: a.sig as Hex,
  })).toLowerCase()
}

// ---- self-issued read token: base64url(JSON{chain,address,exp}) + "." + personal_sign(payload) ----
const b64u = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'))
export async function makeReadToken(account: LocalAccount, chain: string, ttlS = 60) {
  const payload = b64u(JSON.stringify({ chain, address: account.address.toLowerCase(), exp: Math.floor(Date.now() / 1000) + ttlS }))
  return `${payload}.${await account.signMessage!({ message: payload })}`
}
export const MAX_TOKEN_TTL_S = 300
/** Returns the token's address, or an error string. Checks signature, chain, exp and a TTL cap. */
export async function verifyReadToken(token: string, chain: string): Promise<{ address: string } | { error: string }> {
  const [payload, sig] = token.split('.')
  let t: { chain: string; address: string; exp: number }
  try { t = JSON.parse(unb64u(payload!)) } catch { return { error: 'malformed token' } }
  const now = Math.floor(Date.now() / 1000)
  if (t.chain !== chain) return { error: 'token for another chain' }
  if (!(t.exp > now)) return { error: 'token expired' }
  if (t.exp - now > MAX_TOKEN_TTL_S) return { error: 'token ttl too long' }
  let signer: string
  try { signer = (await recoverMessageAddress({ message: payload!, signature: sig as Hex })).toLowerCase() } catch { return { error: 'bad token signature' } }
  if (signer !== t.address?.toLowerCase()) return { error: 'bad token signature' }
  return { address: signer }
}
