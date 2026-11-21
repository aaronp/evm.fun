import { isSafe, MARGIN, type LockView, type SwapState } from '@evmb/htlc'

/** Pure helpers for the Cross-chain swap page: roles, which buttons, countdowns and copy. */

const same = (x?: string, y?: string) => !!x && !!y && x.toLowerCase() === y.toLowerCase()
const s = (n: bigint) => (n === 1n ? '' : 's')

export type Role = 'maker' | 'taker'
export type Action = 'accept' | 'claimB' | 'claimA' | 'refundA' | 'refundB'

/** The acting account is the maker of an opening lock it sent and the taker of one addressed to it. */
export const roleOf = (opening: Pick<LockView, 'sender' | 'recipient'> | undefined, acting?: string): Role | undefined =>
  !opening ? undefined : same(opening.sender, acting) ? 'maker' : same(opening.recipient, acting) ? 'taker' : undefined

/**
 * The buttons the acting account gets for a swap. Only from `claimable`/`refundable` (canClaim/canRefund at each
 * chain's head), never from `phase` or a simulation. `secret`: the maker's secret is in this browser; `b`: chain B's
 * HashLock (the one the terms name) is open here.
 */
export function actionsFor(st: Pick<SwapState, 'opening' | 'answer' | 'claimable' | 'refundable'>, acting: string | undefined,
  has: { secret?: boolean; b?: boolean }): Action[] {
  const role = roleOf(st.opening, acting), out: Action[] = []
  if (role === 'maker') {
    if (st.answer && st.claimable.b && has.secret) out.push('claimB')
    if (st.refundable.a) out.push('refundA')
  }
  if (role === 'taker') {
    if (!st.answer && has.b && st.claimable.a) out.push('accept')
    if (st.answer?.status === 'claimed' && st.claimable.a) out.push('claimA')
    if (st.refundable.b) out.push('refundB')
  }
  return out
}

type Copy = { amtA: string; base: string; chainA: string; amtB: string; quote: string; chainB: string }
/** Button copy; `make` is the maker's opening lock. */
export function actionText(a: Action | 'make', x: Copy): string {
  switch (a) {
    case 'make': return `Lock ${x.amtA} ${x.base} on ${x.chainA}`
    case 'accept': return `Lock ${x.amtB} ${x.quote} on ${x.chainB} to accept`
    case 'claimB': return `Claim ${x.amtB} ${x.quote} on ${x.chainB} (reveals the secret)`
    case 'claimA': return `Claim ${x.amtA} ${x.base} on ${x.chainA}`
    default: return 'Refund'
  }
}

/** A lock's status in blocks: a tx mines at head + 1, so it says "refundable now" from timeout − 1, as canRefund does. */
export function countdown(l: Pick<LockView, 'status' | 'timeoutBlock' | 'closedBlock'>, head: bigint): string {
  if (l.status === 'claimed' || l.status === 'refunded') return `${l.status} in block ${l.closedBlock}`
  const n = l.timeoutBlock - head - 1n
  return n > 0n ? `claimable for ${n} more block${s(n)} · timeout block ${l.timeoutBlock}` : `timeout block ${l.timeoutBlock} · refundable now`
}

export const titleOf = (base?: string, chainA?: string, quote?: string, chainB?: string) =>
  base && quote && chainA && chainB ? `Cross-chain swap · ${base} (${chainA}) ⇄ ${quote} (${chainB})` : 'Cross-chain swap'

/** A registry chain id by name; an id this browser doesn't have says so. */
export const chainLabel = (id: string, chains: { id: string; name: string }[]) => chains.find(c => c.id === id)?.name ?? 'chain not in this browser'

/** Default timeouts, in blocks from each chain's head: the maker's on A, the taker's on B. */
export const defaults = { a: 100n, b: 50n }

export function parseBlocks(text: string): bigint | { error: string } {
  const t = text.trim()
  return /^[1-9]\d{0,9}$/.test(t) ? BigInt(t) : { error: 'Enter a whole number of blocks (1 or more).' }
}

/** The taker's check before locking on B (`isSafe`), with the copy the page shows. */
export function safety(tA: bigint, headA: bigint, tB: bigint, headB: bigint, chainA: string, chainB: string): { safe: boolean; text: string } {
  const la = tA - headA, lb = tB - headB
  return isSafe(tA, headA, tB, headB)
    ? { safe: true, text: `Safe: the maker’s lock has ${la} blocks left on ${chainA}; yours would have ${lb} on ${chainB}, at least ${MARGIN} fewer.` }
    : { safe: false, text: `Unsafe timeouts: the maker’s lock has ${la} blocks left on ${chainA}; yours would have ${lb} on ${chainB}. Yours should end at least ${MARGIN} blocks sooner (${la - MARGIN} or fewer), or the maker could claim your side after theirs has timed out. Blocks are only a proxy for time across chains.` }
}

/** The secret with every digit hidden (the maker's view until "Reveal"). */
export const maskSecret = (_secret: string) => `0x${'•'.repeat(16)}`
