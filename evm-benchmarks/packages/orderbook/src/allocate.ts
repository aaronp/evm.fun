import type { Resting } from './types'

/**
 * Split one maker's `available` give-asset (min of balance and allowance) over their orders, oldest seq first.
 * `giveOf(o)` = what `o.remaining` needs (sell: the base; buy: quoteFor(.., 'up')). Returns covered remaining per id;
 * a partly covered order gets the pro-rata base, rounded down, so its own need never exceeds what's left.
 */
export function allocate(orders: Resting[], available: bigint, giveOf: (o: Resting) => bigint): Map<string, bigint> {
  const out = new Map<string, bigint>()
  for (const o of [...orders].sort((a, b) => a.seq - b.seq)) {
    const need = giveOf(o)
    if (need <= available) { out.set(o.id, o.remaining); available -= need }
    else { out.set(o.id, (o.remaining * available) / need); available = 0n }
  }
  return out
}
