import { decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeFunctionData, type Abi, type Address, type Hex } from 'viem'
import type { ChainHandle } from '../chain/handle'

const HASH = /^0x[0-9a-fA-F]{64}$/
const ADDR = /^0x[0-9a-fA-F]{40}$/

type RawTx = { hash: Hex; from: Address; to: Address | null; value: Hex; input: Hex; [k: string]: unknown }
type RawBlock = { number: Hex; hash: Hex; timestamp: Hex; transactions: (RawTx | Hex)[]; [k: string]: unknown }
type RawLog = { address: Address; topics: Hex[]; data: Hex }
type RawReceipt = { status: Hex; blockNumber: Hex; gasUsed: Hex; contractAddress: Address | null; logs: RawLog[]; [k: string]: unknown }

/** Never throws: a node error (bad params, unknown method) reads as "nothing there". */
const get = async <T>(h: ChainHandle, m: string, p: unknown[]): Promise<T | null> => {
  try { return ((await h.request(m, p)) as T | null) ?? null } catch { return null }
}
/** Malformed or missing node fields read as 0 instead of throwing. */
const big = (v: unknown): bigint => { try { return BigInt(v as string) } catch { return 0n } }
const hex = (n: number) => `0x${n.toString(16)}`
const head = async (h: ChainHandle) => Number(big(await get<Hex>(h, 'eth_blockNumber', [])))

export function classify(query: string): 'block' | 'tx' | 'address' | 'invalid' {
  const q = query.trim()
  if (HASH.test(q)) return 'tx'
  if (ADDR.test(q)) return 'address'
  if (/^\d+$/.test(q) && Number.isSafeInteger(Number(q))) return 'block'
  return 'invalid'
}

/** Newest first. Page 0 starts at the head. */
export async function latestBlocks(h: ChainHandle, page: number, size = 20) {
  const top = (await head(h)) - page * size
  const nums = Array.from({ length: Math.max(0, Math.min(size, top + 1)) }, (_, i) => top - i)
  const out = await Promise.all(nums.map(n => get<RawBlock>(h, 'eth_getBlockByNumber', [hex(n), false])))
  return out.flatMap(b => (b && typeof b === 'object' ? [{ number: Number(big(b.number)), hash: b.hash, timestamp: Number(big(b.timestamp)), txCount: Array.isArray(b.transactions) ? b.transactions.length : 0 }] : []))
}

export async function block(h: ChainHandle, n: number, txPage: number, size = 50) {
  if (!Number.isSafeInteger(n) || n < 0) return null
  const b = await get<RawBlock>(h, 'eth_getBlockByNumber', [hex(n), true])
  if (!b || typeof b !== 'object') return null
  const all = (Array.isArray(b.transactions) ? b.transactions : []).filter((t): t is RawTx => !!t && typeof t === 'object')
  const txs = all.slice(Math.max(0, txPage) * size, (Math.max(0, txPage) + 1) * size).map(t => ({ hash: t.hash, from: t.from, to: t.to ?? null, value: big(t.value) }))
  return { header: b, txs, txTotal: all.length }
}

/** `abis` are the contract-registry ABIs for this chain; decoding is best effort. */
export async function tx(h: ChainHandle, hash: string, abis: Abi[]) {
  if (!HASH.test(hash)) return null
  const [t, receipt] = await Promise.all([get<RawTx>(h, 'eth_getTransactionByHash', [hash]), get<RawReceipt>(h, 'eth_getTransactionReceipt', [hash])])
  if (!t || !receipt || typeof t !== 'object' || typeof receipt !== 'object') return null
  const input = typeof t.input === 'string' ? t.input : '0x'
  const logs = Array.isArray(receipt.logs) ? receipt.logs : []
  let decodedInput: { functionName: string; args?: readonly unknown[] } | undefined
  if (input.length >= 10) for (const abi of abis) {
    try { decodedInput = decodeFunctionData({ abi, data: input }); break } catch {}
  }
  const decodedLogs = logs.map(l => {
    for (const abi of abis) {
      try { return decodeEventLog({ abi, data: l.data, topics: l.topics as [Hex] }) as { eventName: string; args: unknown } } catch {}
    }
    return null
  })
  return { tx: t, receipt, decodedInput, decodedLogs }
}

/** `tokens`: ERC-20 contracts (with their ABI) to read balanceOf from. Failed reads are omitted. */
export async function address(h: ChainHandle, addr: string, tokens: { address: Address; name: string; abi: Abi }[]) {
  if (!ADDR.test(addr)) return null
  const a = addr as Address
  const [bal, nonce, code] = await Promise.all([
    get<Hex>(h, 'eth_getBalance', [a, 'latest']),
    get<Hex>(h, 'eth_getTransactionCount', [a, 'latest']),
    get<Hex>(h, 'eth_getCode', [a, 'latest']),
  ])
  const tokenBalances = (
    await Promise.all(tokens.map(async t => {
      try {
        const data = encodeFunctionData({ abi: t.abi, functionName: 'balanceOf', args: [a] })
        const out = await get<Hex>(h, 'eth_call', [{ to: t.address, data }, 'latest'])
        return out ? [{ token: t.address, name: t.name, balance: decodeFunctionResult({ abi: t.abi, functionName: 'balanceOf', data: out }) as bigint }] : []
      } catch { return [] }
    }))
  ).flat()
  return { balance: big(bal), nonce: Number(big(nonce)), isContract: !!code && code !== '0x', tokenBalances }
}
