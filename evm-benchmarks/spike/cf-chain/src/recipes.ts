// View recipes: recipe id -> (rpc, contract, params) -> JSON of the contract's current state.
// Adding a recipe = one more entry in RECIPES (and an alias that names it). bigints stay bigints here;
// the worker's JSON replacer prints them as decimal strings.
import { decodeFunctionResult, encodeFunctionData, erc20Abi, parseAbi, toEventSelector, type Abi, type AbiFunction, type Hex } from 'viem'

export interface Rpc { request(a: { method: string; params: unknown[] }): Promise<unknown> }
export interface Cost { ethCalls: number; logScans: number; logs: number }
export type Recipe = (rpc: Rpc, contract: Hex, params: string) => Promise<Record<string, unknown>>

/** Wrap an rpc so the view's cost (eth_calls, log scans, logs returned) can be reported. */
export function counted(rpc: Rpc) {
  const cost: Cost = { ethCalls: 0, logScans: 0, logs: 0 }
  const wrapped: Rpc = {
    async request(a) {
      if (a.method === 'eth_call') cost.ethCalls++
      const r = await rpc.request(a)
      if (a.method === 'eth_getLogs') { cost.logScans++; cost.logs += (r as unknown[]).length }
      return r
    },
  }
  return { rpc: wrapped, cost }
}

async function call(rpc: Rpc, to: Hex, abi: Abi, functionName: string, args: unknown[] = []) {
  const data = encodeFunctionData({ abi, functionName, args } as any)
  return decodeFunctionResult({ abi, functionName, data: (await rpc.request({ method: 'eth_call', params: [{ to, data }, 'latest'] })) as Hex } as any)
}

/**
 * params: ';'-separated human-readable ABI fragments, each optionally prefixed `key=` to rename the JSON field,
 * e.g. `read=function readers() view returns (address[])`. Every zero-arg view is called once (one eth_call each).
 */
const selfDescribing: Recipe = async (rpc, contract, params) => {
  const entries = params.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [, key, frag] = s.match(/^(?:([\w-]+)=)?(.*)$/)!
    const abi = parseAbi([frag!]) as Abi
    return { key, abi, f: abi[0] as AbiFunction }
  }).filter(({ f }) => f.type === 'function' && (f.stateMutability === 'view' || f.stateMutability === 'pure') && f.inputs.length === 0)
  if (!entries.length) throw new Error('self-describing: no zero-arg view functions declared')
  const out: Record<string, unknown> = {}
  for (const { key, abi, f } of entries) {
    const v = await call(rpc, contract, abi, f.name)
    // multi-return: object by output name (or index)
    out[key ?? f.name] = f.outputs.length > 1 ? Object.fromEntries(f.outputs.map((o, i) => [o.name || i, (v as unknown[])[i]])) : v
  }
  return out
}

const TRANSFER = toEventSelector('Transfer(address,address,uint256)')
/** ERC-20: metadata + balances of everyone who ever received a Transfer (from params = deploy block), read now, zeros omitted. */
const erc20: Recipe = async (rpc, token, params) => {
  // ponytail: rescans every Transfer since deploy on each request, O(transfers); a real build folds events into a holder set incrementally
  const fromBlock = `0x${Number(params || 0).toString(16)}`
  const logs = (await rpc.request({ method: 'eth_getLogs', params: [{ address: token, fromBlock, toBlock: 'latest', topics: [TRANSFER] }] })) as { topics: Hex[] }[]
  const holders = [...new Set(logs.map((l) => `0x${l.topics[2]!.slice(26)}`))]
  const balances: Record<string, bigint> = {}
  for (const h of holders) {
    const b = (await call(rpc, token, erc20Abi, 'balanceOf', [h])) as bigint
    if (b !== 0n) balances[h] = b
  }
  const [name, symbol, decimals, totalSupply] = await Promise.all((['name', 'symbol', 'decimals', 'totalSupply'] as const).map((f) => call(rpc, token, erc20Abi, f)))
  return { name, symbol, decimals, totalSupply, holders: Object.keys(balances).length, balances }
}

export const RECIPES: Record<string, Recipe> = { 'self-describing': selfDescribing, erc20 }

/** The built-in access-controls view: ChainAccess served through the self-describing recipe. */
export const ACCESS_VIEWS = [
  'function admin() view returns (address)',
  'function readOpen() view returns (bool)',
  'read=function readers() view returns (address[])',
  'write=function writers() view returns (address[])',
].join(';')
