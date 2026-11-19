import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAbiItem, getAddress, isAddress, parseAbi, toEventSelector, type Address, type Hex } from 'viem'
import type { Asset } from './types'

export type Request = (method: string, params: unknown[]) => Promise<unknown>

const ownerAbi = parseAbi(['function owner() view returns (address)'])
const approvalTopic = toEventSelector(getAbiItem({ abi: erc20Abi, name: 'Approval' }))
const word = (t: Hex): Address => getAddress(`0x${t.slice(-40)}`)

async function call(request: Request, to: Address, abi: any, functionName: string, args: unknown[] = []) {
  const data = encodeFunctionData({ abi, functionName, args } as any)
  const out = (await request('eth_call', [{ to, data }, 'latest'])) as Hex
  return decodeFunctionResult({ abi, functionName, data: out } as any) as any
}

const erc20 = (a: Asset): Address => a.address!

export async function readTokenInfo(request: Request, address: Address) {
  const notToken = () => new Error(`Not an ERC-20 at ${address}`)
  if (!isAddress(address)) throw notToken()
  try {
    if (((await request('eth_getCode', [address, 'latest'])) as Hex) === '0x') throw notToken()
    const [symbol, decimals, supply] = await Promise.all([
      call(request, address, erc20Abi, 'symbol'), call(request, address, erc20Abi, 'decimals'), call(request, address, erc20Abi, 'totalSupply'),
    ])
    if (Number(decimals) > 255) throw notToken()
    // EIP-20 makes name() optional, so fall back to the symbol.
    const name = await call(request, address, erc20Abi, 'name').catch(() => symbol)
    const owner = await call(request, address, ownerAbi, 'owner').catch(() => undefined)
    return { name: name as string, symbol: symbol as string, decimals: Number(decimals), totalSupply: supply as bigint, ...(owner ? { owner: owner as Address } : {}) }
  } catch {
    throw notToken()
  }
}

export async function totalSupply(request: Request, asset: Asset): Promise<bigint | undefined> {
  return asset.kind === 'native' ? undefined : call(request, erc20(asset), erc20Abi, 'totalSupply')
}

export async function balances(request: Request, asset: Asset, holders: Address[]): Promise<Map<Address, bigint>> {
  const rows = await Promise.all(holders.map(async h =>
    [h, asset.kind === 'native'
      ? BigInt((await request('eth_getBalance', [h, 'latest'])) as string)
      : ((await call(request, erc20(asset), erc20Abi, 'balanceOf', [h])) as bigint)] as const))
  return new Map(rows)
}

/** Pairs come from Approval logs; amounts are re-read live so spent allowances show the remainder. */
export async function allowances(request: Request, asset: Asset) {
  if (asset.kind === 'native') return []
  const logs = (await request('eth_getLogs', [{ address: erc20(asset), topics: [approvalTopic], fromBlock: '0x0', toBlock: 'latest' }])) as { topics: Hex[] }[]
  const pairs = new Map<string, { owner: Address; spender: Address }>()
  for (const l of logs) {
    if (l.topics.length < 3) continue
    const owner = word(l.topics[1]), spender = word(l.topics[2])
    pairs.set(`${owner}:${spender}`.toLowerCase(), pairs.get(`${owner}:${spender}`.toLowerCase()) ?? { owner, spender })
  }
  const rows = await Promise.all([...pairs.values()].map(async p =>
    ({ ...p, amount: (await call(request, erc20(asset), erc20Abi, 'allowance', [p.owner, p.spender])) as bigint })))
  return rows.filter(r => r.amount > 0n)
}
