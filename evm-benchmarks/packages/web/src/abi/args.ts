import { getAddress, isAddress } from 'viem'

// Minimal constructor-arg parsing (string, address, uint256). Task 6 extends this.
export function parseArg(type: string, input: string): unknown {
  const s = input.trim()
  if (type === 'string') return input
  if (type === 'address') {
    if (!isAddress(s, { strict: false })) throw new Error(`"${s}" is not a valid address`)
    return getAddress(s.toLowerCase())
  }
  if (/^uint\d*$/.test(type)) {
    if (!/^\d+$/.test(s)) throw new Error(`"${s}" is not a non-negative integer`)
    const n = BigInt(s)
    const bits = BigInt(type.slice(4) || 256)
    if (n >= 1n << bits) throw new Error(`${s} does not fit in ${type}`)
    return n
  }
  throw new Error(`Unsupported argument type: ${type}`)
}
