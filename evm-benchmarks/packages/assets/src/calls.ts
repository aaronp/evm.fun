import { encodeFunctionData, erc20Abi, parseAbi, type Address, type Hex } from 'viem'
import type { Asset } from './types'

export const MAX_UINT256 = 2n ** 256n - 1n
type Call = { to: Address; data: Hex }
const mintAbi = parseAbi(['function mint(address to, uint256 amount)'])

const contract = (a: Asset): Address => {
  if (a.kind === 'native' || !a.address) throw new Error('Native asset has no contract')
  return a.address
}

export const transferCall = (a: Asset, to: Address, amount: bigint): Call =>
  ({ to: contract(a), data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount] }) })
export const approveCall = (a: Asset, spender: Address, amount: bigint): Call =>
  ({ to: contract(a), data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }) })
export const mintCall = (a: Asset, to: Address, amount: bigint): Call =>
  ({ to: contract(a), data: encodeFunctionData({ abi: mintAbi, functionName: 'mint', args: [to, amount] }) })
