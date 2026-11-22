import type { Address, Hash, Hex } from 'viem'
import { closedBy, type LockView } from './read'
import { isSafe, swapState, type Phase, type Side } from './state'

type Str<T> = { [K in keyof T]: T[K] extends bigint ? string : T[K] extends bigint | undefined ? string | undefined : T[K] }
/** A lock as plain data (bigints as decimal strings), without its secret: the report carries that once, top level. */
export type LockJson = Str<Omit<LockView, 'secret'>>
/** `taker lost`: A refunded and B claimed (the maker has both sides); `maker lost`: A claimed and B refunded. */
export type SwapOutcome = 'completed' | 'refunded (maker)' | 'refunded (taker)' | 'refunded (both)' | 'taker lost' | 'maker lost' | 'stuck'
// every closed combination, A/B ('-' = no answer); a lock is never labelled refunded unless it was
const OUTCOME: Record<string, SwapOutcome> = {
  'claimed/claimed': 'completed', 'claimed/-': 'completed', 'refunded/refunded': 'refunded (both)', 'refunded/-': 'refunded (maker)',
  'refunded/claimed': 'taker lost', 'claimed/refunded': 'maker lost',
}
export type SwapStep = { chain: string; action: 'lock' | 'claim' | 'refund'; side: 'maker' | 'taker'; id: string; tx: Hash; block: string }
/** Plain, JSON-ready data: bigints are decimal strings. */
export type SwapReport = {
  hash: Hex; chainA: string; chainB?: string; phase: Phase; outcome: SwapOutcome
  /** the pair failed `isSafe` at the answer (see README: judged from each lock's own lock block unless `headAAtAnswer`) */
  unsafe: boolean
  opening: LockJson; answer?: LockJson
  /** lock, answer, then claims/refunds in the order they happened in the swap */
  steps: SwapStep[]
  /** net token changes per chain from the swap's locks (an escrowed lock shows the HashLock holding it) */
  balanceChanges: { chain: string; holder: Address; token: Address; delta: string }[]
  /** locks still claimable before, and refundable from, `timeoutBlock` */
  stillLocked: { chain: string; id: string; timeoutBlock: string }[]
  /** only once the B-side lock is claimed (the claim made it public) */
  secret?: Hex
}

const plain = ({ secret: _, ...l }: LockView): LockJson =>
  Object.fromEntries(Object.entries(l).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : v])) as LockJson

/** The swap's report from both chains' state and events. Throws when A has no opening lock with this hash. */
export async function swapReport(a: Side, b: Side | undefined, hash: Hex, opts: { headAAtAnswer?: bigint } = {}): Promise<SwapReport> {
  const { opening, answer, phase } = await swapState(a, b, hash)
  if (!opening) throw new Error('No opening lock with this hash')
  const locks = [opening, ...(answer ? [answer] : [])]
  const side = (l: LockView, action: SwapStep['action']): SwapStep['side'] => (l === opening) === (action === 'lock' || action === 'refund') ? 'maker' : 'taker'
  const closes = await Promise.all(locks.map(async l => ({ l, c: await closedBy(l === opening ? a.request : b!.request, l) })))
  const steps: SwapStep[] = [
    ...locks.map(l => ({ chain: l.chain, action: 'lock' as const, side: side(l, 'lock'), id: String(l.id), tx: l.lockedTx!, block: String(l.lockedBlock) })),
    // B's claim precedes A's (it reveals the secret); refunds follow their own timeouts, B's first
    ...closes.reverse().flatMap(({ l, c }) => c ? [{ chain: l.chain, action: l.status === 'claimed' ? 'claim' as const : 'refund' as const,
      side: side(l, l.status === 'claimed' ? 'claim' : 'refund'), id: String(l.id), tx: c.tx, block: String(c.block) }] : []),
  ]
  const balanceChanges = locks.flatMap(l => l.status === 'refunded' ? [] : [
    { chain: l.chain, holder: l.sender, token: l.token, delta: String(-l.amount) },
    { chain: l.chain, holder: l.status === 'claimed' ? l.recipient : l.address, token: l.token, delta: String(l.amount) },
  ])
  const stillLocked = locks.filter(l => l.status === 'locked').map(l => ({ chain: l.chain, id: String(l.id), timeoutBlock: String(l.timeoutBlock) }))
  const sa = opening.status, sb = answer?.status
  // ponytail: 'refunded (taker)' (B refunded, A untouched) can't be reached: A is then still locked → stuck
  const outcome: SwapOutcome = stillLocked.length ? 'stuck' : OUTCOME[`${sa}/${sb ?? '-'}`] ?? 'stuck'
  const unsafe = !!answer && !isSafe(opening.timeoutBlock, opts.headAAtAnswer ?? opening.lockedBlock!, answer.timeoutBlock, answer.lockedBlock!)
  return {
    hash, chainA: a.chain, ...(b && { chainB: b.chain }), phase, outcome, unsafe,
    opening: plain(opening), ...(answer && { answer: plain(answer) }), steps, balanceChanges, stillLocked,
    ...(sb === 'claimed' && { secret: answer!.secret }),
  }
}
