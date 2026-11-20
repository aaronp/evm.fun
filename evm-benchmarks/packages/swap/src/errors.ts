import { decodeErrorResult, type Hex } from 'viem'
import { swapAbi } from './abi'

// Swap's ABI doesn't carry OpenZeppelin's ERC-20 errors, so they are listed here.
const erc20Errors = [
  { type: 'error', name: 'ERC20InsufficientAllowance', inputs: [
    { name: 'spender', type: 'address' }, { name: 'allowance', type: 'uint256' }, { name: 'needed', type: 'uint256' }] },
  { type: 'error', name: 'ERC20InsufficientBalance', inputs: [
    { name: 'sender', type: 'address' }, { name: 'balance', type: 'uint256' }, { name: 'needed', type: 'uint256' }] },
] as const
const abi = [...swapAbi.filter(e => e.type === 'error'), ...erc20Errors]

export function decodeSwapError(data: Hex): { name: string; args: Record<string, unknown> } | undefined {
  try {
    const { errorName, args } = decodeErrorResult({ abi, data })
    const inputs = (abi.find(e => e.name === errorName) as { inputs: readonly { name: string }[] }).inputs
    return { name: errorName, args: Object.fromEntries(inputs.map((x, i) => [x.name, (args ?? [])[i]])) }
  } catch {
    return undefined
  }
}
