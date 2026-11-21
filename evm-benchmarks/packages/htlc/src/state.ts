import { isAddressEqual, type Address, type Hex } from 'viem'
import type { Request } from '@evmb/assets'
import { locksFor, type LockView } from './read'

/** One chain's HashLock: `chain` is the registry chain id, `fromBlock` the contract's deploy block, `head` its head now. */
export type Side = { chain: string; request: Request; address: Address; head: bigint; fromBlock: bigint }
export type Phase = 'offered' | 'answered' | 'claimedB' | 'complete' | 'refundedA' | 'refundedB' | 'refundedBoth' | 'expiring'
export type SwapState = {
  opening?: LockView; answer?: LockView; phase: Phase
  /** the pair judged with both heads now; only once answered */
  safe?: boolean
  /** timeout − head per lock (≤ 0 once refundable) */
  blocksLeft: { a?: bigint; b?: bigint }
}

export const MARGIN = 10n
/** Safe for the taker iff the maker's lock has at least `margin` more blocks left than the taker's. */
export const isSafe = (tA: bigint, headA: bigint, tB: bigint, headB: bigint, margin = MARGIN) => tA - headA >= tB - headB + margin

/** The swap's two locks: the earliest opening lock on A with this hash, and the earliest answer on B that pairs with it. */
export async function findPair(a: Side, b: Side | undefined, hash: Hex): Promise<{ opening?: LockView; answer?: LockView }> {
  const opening = (await locksFor(a.request, a.address, a.fromBlock, { hash, chain: a.chain })).find(l => l.wantChain !== '')
  // an answer counts only on the chain and HashLock the offer named, from its recipient to its sender, in its token, for ≥ its amount
  if (!opening || !b || b.chain !== opening.wantChain || !isAddressEqual(b.address, opening.wantLock)) return { opening }
  const answer = (await locksFor(b.request, b.address, b.fromBlock, { hash, chain: b.chain, sender: opening.recipient, recipient: opening.sender }))
    .find(l => l.wantChain === '' && isAddressEqual(l.token, opening.wantToken) && l.amount >= opening.wantAmount)
  return { opening, answer }
}

/** Where the swap stands, from both chains. Without an opening lock it reads `offered` with no locks. */
export async function swapState(a: Side, b: Side | undefined, hash: Hex): Promise<SwapState> {
  const { opening, answer } = await findPair(a, b, hash)
  const blocksLeft = { ...(opening && { a: opening.timeoutBlock - a.head }), ...(answer && b && { b: answer.timeoutBlock - b.head }) }
  const sa = opening?.status, sb = answer?.status
  const near = (l: LockView | undefined, left: bigint | undefined) => l?.status === 'locked' && left! <= MARGIN
  const phase: Phase =
    sa === 'refunded' && sb === 'refunded' ? 'refundedBoth'
    : sa === 'refunded' ? 'refundedA'
    : sb === 'refunded' ? 'refundedB'
    : sa === 'claimed' && sb === 'claimed' ? 'complete'
    : near(opening, blocksLeft.a) || near(answer, blocksLeft.b) ? 'expiring'
    : sb === 'claimed' ? 'claimedB'
    : answer ? 'answered' : 'offered'
  return { ...(opening && { opening }), ...(answer && { answer }), phase,
    ...(opening && answer && b && { safe: isSafe(opening.timeoutBlock, a.head, answer.timeoutBlock, b.head) }), blocksLeft }
}
