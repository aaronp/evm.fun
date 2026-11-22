// Shared by the Durable Object and the device replicas: the same node config and the
// same block-application step on both sides is what makes replay comparable.
import { createNode, type SlimNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { recoverMessageAddress, type Hex, type LocalAccount } from 'viem'

export interface Genesis { chainId: number; timestamp: number; alloc: Record<string, string> }
export interface BlockRecord {
  number: number; hash: string; parentHash: string; timestamp: number; stateRoot: string
  txs: Hex[]; receipts: unknown[]; proposer?: string
}
export interface Chain { node: SlimNode; env: { timestamp?: bigint } }

type Wasm = Parameters<typeof createRevmEngine>[0]['wasm']

export async function makeChain(g: Genesis, wasm: Wasm): Promise<Chain> {
  // ponytail: webevm has no per-block timestamp knob (no evm_setNextBlockTimestamp), but it keeps
  // options.blockEnv by reference and reads .timestamp at each mine, so we mutate it per block.
  // Relies on webevm 0.9.1 internals; a real build wants a mine({timestamp}) option upstream.
  const env: { timestamp?: bigint } = {}
  const node = await createNode({
    chainId: g.chainId,
    computeStateRoot: true,
    miningConfig: { type: 'manual' },
    genesisTimestamp: BigInt(g.timestamp),
    initialBalances: Object.fromEntries(Object.entries(g.alloc).map(([a, b]) => [a, BigInt(b)])),
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
