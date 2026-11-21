import { decodeErrorResult, type Hex } from 'viem'
import { poolAbi } from './abi'

// Pool's ABI carries its own errors and OpenZeppelin's ERC-20 ones (the pool is its own LP token).
const abi = poolAbi.filter(e => e.type === 'error')

export function decodePoolError(data: Hex): { name: string; args: Record<string, unknown> } | undefined {
  try {
    const { errorName, args } = decodeErrorResult({ abi, data }) as { errorName: string; args?: readonly unknown[] }
    // viem decodes Solidity's built-in Error(string) / Panic(uint256) without them being in `abi`
    if (errorName === 'Error') return { name: 'Error', args: { message: args?.[0] } }
    if (errorName === 'Panic') return { name: 'Panic', args: { code: args?.[0] } }
    const inputs = abi.find(e => e.name === errorName)!.inputs as readonly { name: string }[]
    return { name: errorName, args: Object.fromEntries(inputs.map((x, i) => [x.name, (args ?? [])[i]])) }
  } catch {
    return undefined
  }
}
