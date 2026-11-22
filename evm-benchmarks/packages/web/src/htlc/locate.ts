import { isAddressEqual, parseEventLogs, type Address, type Hex } from 'viem'
import { HashLock } from '@evmb/contracts'
import { hashLockAbi, locksFor, type Side } from '@evmb/htlc'
import type { ChainHandle } from '../chain/handle'
import { contractsRegistry } from '../contracts/registry'
import type { Account } from '../store/accounts'
import { deployContract, inDeployOrder } from '../swap/locate'

/** A recorded HashLock and its deploy block (where `locksFor` starts): the one at `prefer` when recorded, else the newest-deployed. */
export async function hashLockAt(chain: ChainHandle, prefer?: Address): Promise<{ address: Address; block: bigint } | undefined> {
  const all = await inDeployOrder(chain, (await contractsRegistry.list(chain.info.id)).filter(r => r.name === 'HashLock'))
  const r = (prefer && all.find(x => isAddressEqual(x.address as Address, prefer))) || all.at(-1)
  return r && { address: r.address as Address, block: r.block < 0n ? 0n : r.block }
}

/** This chain's HashLock: the newest-deployed `HashLock` record. */
export const hashLockFor = async (chain: ChainHandle) => (await hashLockAt(chain))?.address

export const headOf = async (chain: ChainHandle) => BigInt((await chain.request('eth_blockNumber', [])) as string)

/** `chain`'s HashLock (see `hashLockAt`) as a `Side` for swapState/swapReport, with its head now. */
export async function sideOf(chain: ChainHandle, prefer?: Address): Promise<Side | undefined> {
  const at = await hashLockAt(chain, prefer)
  return at && { chain: chain.info.id, request: chain.request, address: at.address, head: await headOf(chain), fromBlock: at.block }
}

/**
 * The swap's sides: A's newest HashLock, and B's only when `b` is the chain the opening lock's terms name and the
 * HashLock they name (`wantLock`) is recorded there.
 * ponytail: an opening lock on an older HashLock of A isn't found; search every record when redeploys matter.
 */
export async function sidesFor(a: ChainHandle, b: ChainHandle | undefined, hash: Hex): Promise<{ a?: Side; b?: Side }> {
  const sa = await sideOf(a)
  if (!sa) return {}
  const opening = (await locksFor(sa.request, sa.address, sa.fromBlock, { hash, chain: sa.chain })).find(l => l.wantChain !== '')
  const sb = b && opening && b.info.id === opening.wantChain ? await sideOf(b, opening.wantLock) : undefined
  return { a: sa, ...(sb && isAddressEqual(sb.address, opening!.wantLock) && { b: sb }) }
}

/** Deploy HashLock.sol from `from` and save its contract record. Refused on benchmark chains. */
export const deployHashLock = (chain: ChainHandle, from: Account, onSent?: () => void) => deployContract(chain, from, 'HashLock', HashLock, onSent)

/** The id of the lock `tx` made, from its Locked event; throws when the receipt has none. */
export async function lockedId(chain: ChainHandle, tx: Hex): Promise<bigint> {
  const rc = (await chain.request('eth_getTransactionReceipt', [tx])) as { logs: Parameters<typeof parseEventLogs>[0]['logs'] }
  const id = parseEventLogs({ abi: hashLockAbi, eventName: 'Locked', logs: rc.logs })[0]?.args.id
  if (id === undefined) throw new Error(`No Locked event in ${tx}`)
  return id
}
