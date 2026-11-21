import { decodeErrorResult, type Address, type Hex } from 'viem'
import { hashLockAbi } from './abi'
import { statusName } from './read'

// HashLock's ABI doesn't carry OpenZeppelin's ERC-20 errors, so they are listed here.
const erc20Errors = [
  { type: 'error', name: 'ERC20InsufficientAllowance', inputs: [
    { name: 'spender', type: 'address' }, { name: 'allowance', type: 'uint256' }, { name: 'needed', type: 'uint256' }] },
  { type: 'error', name: 'ERC20InsufficientBalance', inputs: [
    { name: 'sender', type: 'address' }, { name: 'balance', type: 'uint256' }, { name: 'needed', type: 'uint256' }] },
] as const
const abi = [...hashLockAbi.filter(e => e.type === 'error'), ...erc20Errors]

/** What the page knows about the failed call: the chain's id and head (for "Advance …"), and the token (for amounts). */
export type ErrorContext = { chain?: string; head?: bigint; token?: Address }
export type HtlcError = { name: string; args: Record<string, unknown>; fix: string }

function fixFor(name: string, x: Record<string, any>, c: ErrorContext): string {
  const amt = (v: bigint) => (c.token ? `{amount:${c.token}:${v}}` : String(v))
  switch (name) {
    case 'NotLocked': {
      const s = statusName(x.status)
      return s === 'none' ? `There is no lock #${x.id} on this HashLock.` : `Lock #${x.id} was already ${s}.`
    }
    case 'NotRecipient': return 'Only the lock’s recipient can claim it. Act as the recipient.'
    case 'NotSender': return 'Only the lock’s sender can refund it. Act as the sender.'
    case 'BadSecret': return 'The secret doesn’t match the lock’s hash. Use the secret revealed by the claim on the other chain.'
    case 'Expired': return `The lock expired at block ${x.timeoutBlock}; it can no longer be claimed. The sender can refund it.`
    case 'NotExpired': {
      if (c.chain === undefined || c.head === undefined) return `Refund from block ${x.timeoutBlock}.`
      // the refund needs block.number ≥ timeout, and the next tx is mined at head + 1
      const n = (x.timeoutBlock as bigint) - c.head - 1n
      return n <= 0n ? `Refund now: the next block on ${c.chain} is the timeout block.` : `Advance ${c.chain} ${n} block${n === 1n ? '' : 's'}, then refund.`
    }
    case 'BadLock': return 'Check the lock: a non-zero amount and recipient, a timeout after the current block, and for an offer the wanted token and HashLock.'
    case 'ERC20InsufficientAllowance': return `Approve HashLock to spend at least ${amt(x.needed)}, then lock again.`
    case 'ERC20InsufficientBalance': return `Get at least ${amt(x.needed)} into the sender’s wallet, then lock again.`
    case 'SafeERC20FailedOperation': return 'The token transfer failed: the token is not a standard ERC-20.'
    case 'ReentrancyGuardReentrantCall': return 'HashLock refused a reentrant call.'
    case 'Error': return `The transaction reverted: ${x.message}`
    default: return `The contract panicked (code ${x.code}).`
  }
}

/** Decodes a HashLock revert (its errors, OZ ERC-20's, `Error(string)`, `Panic(uint256)`) with fix copy; else `undefined`. */
export function decodeHtlcError(data: Hex, ctx: ErrorContext = {}): HtlcError | undefined {
  let name: string, args: Record<string, unknown>
  try {
    const d = decodeErrorResult({ abi, data }) as { errorName: string; args?: readonly unknown[] }
    name = d.errorName
    // viem decodes Solidity's built-in Error(string) / Panic(uint256) without them being in `abi`
    if (name === 'Error') args = { message: d.args?.[0] }
    else if (name === 'Panic') args = { code: d.args?.[0] }
    else {
      const inputs = (abi.find(e => e.name === name) as { inputs: readonly { name: string }[] }).inputs
      args = Object.fromEntries(inputs.map((x, i) => [x.name, (d.args ?? [])[i]]))
    }
  } catch {
    return undefined
  }
  return { name, args, fix: fixFor(name, args, ctx) }
}
