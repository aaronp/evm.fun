import { decodeEventLog, decodeFunctionResult, encodeEventTopics, encodeFunctionData, getAddress, toHex, type Address, type Hash, type Hex } from 'viem'
import type { Request } from '@evmb/assets'
import { hashLockAbi } from './abi'

export type LockStatus = 'none' | 'locked' | 'claimed' | 'refunded'
const STATUS: LockStatus[] = ['none', 'locked', 'claimed', 'refunded']
/** The contract's `Status` enum value (e.g. `NotLocked.args.status`) as a `LockStatus`. */
export const statusName = (n: number | bigint): LockStatus => STATUS[Number(n)] ?? 'none'

export type Lock = {
  sender: Address; recipient: Address; token: Address; amount: bigint; hash: Hex; timeoutBlock: bigint
  status: LockStatus
  /** the block it was claimed or refunded in (0 while locked) */
  closedBlock: bigint
  /** the preimage, stored by `claim` (zero bytes until then) */
  secret: Hex
  /** the terms: empty `wantChain` (and zero rest) on an answer */
  wantChain: string; wantLock: Address; wantToken: Address; wantAmount: bigint
}
/** A lock with where it lives; `lockedBlock`/`lockedTx` are set when it was found from its `Locked` log. */
export type LockView = Lock & { id: bigint; chain: string; address: Address; lockedBlock?: bigint; lockedTx?: Hash }

/** One lock, read live from the chain. `chain` is the registry chain id the caller knows it by. */
export async function readLock(request: Request, address: Address, id: bigint, chain = ''): Promise<LockView> {
  const data = encodeFunctionData({ abi: hashLockAbi, functionName: 'locks', args: [id] })
  const out = (await request('eth_call', [{ to: address, data }, 'latest'])) as Hex
  const [sender, recipient, token, amount, hash, timeoutBlock, status, closedBlock, secret, wantChain, wantLock, wantToken, wantAmount] =
    decodeFunctionResult({ abi: hashLockAbi, functionName: 'locks', data: out })
  return { id, chain, address: getAddress(address), sender, recipient, token, amount, hash, timeoutBlock: BigInt(timeoutBlock),
    status: statusName(status), closedBlock: BigInt(closedBlock), secret, wantChain, wantLock, wantToken, wantAmount }
}

type RpcLog = { address: Address; topics: [Hex, ...Hex[]]; data: Hex; blockNumber: Hex; transactionHash: Hash }
const topic = (a?: Address) => (a ? toHex(BigInt(a), { size: 32 }) : null)

/**
 * Locks found from `Locked` logs since `fromBlock` (the HashLock's deploy block), filtered by the indexed sender and
 * recipient and by hash, oldest first, each read live. `chain` labels the views.
 * ponytail: one log scan from the deploy block per call, O(locks on the contract) (risks, backlog; ADR-0021).
 */
export async function locksFor(request: Request, address: Address, fromBlock: bigint,
  f: { recipient?: Address; sender?: Address; hash?: Hex; chain?: string } = {}): Promise<LockView[]> {
  const [locked] = encodeEventTopics({ abi: hashLockAbi, eventName: 'Locked' })
  const logs = (await request('eth_getLogs', [{ address, fromBlock: toHex(fromBlock), toBlock: 'latest',
    topics: [locked, null, topic(f.sender), topic(f.recipient)] }])) as RpcLog[]
  const found = logs.map(l => ({ l, e: decodeEventLog({ abi: hashLockAbi, eventName: 'Locked', ...l }).args }))
    .filter(({ e }) => !f.hash || e.hash.toLowerCase() === f.hash.toLowerCase())
  return Promise.all(found.map(async ({ l, e }) => ({
    ...await readLock(request, address, e.id, f.chain), lockedBlock: BigInt(l.blockNumber), lockedTx: l.transactionHash,
  })))
}

/** The tx and block that claimed or refunded a closed lock: one block's logs, from its stored `closedBlock`. */
export async function closedBy(request: Request, l: LockView): Promise<{ tx: Hash; block: bigint } | undefined> {
  if (l.status !== 'claimed' && l.status !== 'refunded') return undefined
  const [t] = encodeEventTopics({ abi: hashLockAbi, eventName: l.status === 'claimed' ? 'Claimed' : 'Refunded' })
  const at = toHex(l.closedBlock)
  const [log] = (await request('eth_getLogs', [{ address: l.address, fromBlock: at, toBlock: at,
    topics: [t, toHex(l.id, { size: 32 })] }])) as RpcLog[]
  return log && { tx: log.transactionHash, block: l.closedBlock }
}
