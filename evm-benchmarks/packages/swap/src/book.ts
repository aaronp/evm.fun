import { parseUnits } from 'viem'
import type { Address } from 'viem'
import type { Offer } from './types'

export type Side = 'ask' | 'bid'
type Frac = { num: bigint; den: bigint }
export type BookRow = Offer & { side: Side; base: bigint; quote: bigint; price: Frac }
type Token = { address: Address; decimals: number }

const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase()
// price (quote per base, in whole units) as an exact fraction; a < b  <=>  a.num * b.den < b.num * a.den
const cmp = (a: Frac, b: Frac) => { const d = a.num * b.den - b.num * a.den; return d < 0n ? -1 : d > 0n ? 1 : 0 }

export function book(offers: Offer[], base: Token, quote: Token) {
  const rows: BookRow[] = []
  for (const o of offers) {
    if (o.status !== 'open') continue
    const ask = same(o.giveToken, base.address) && same(o.getToken, quote.address)
    const bid = same(o.giveToken, quote.address) && same(o.getToken, base.address)
    if (!ask && !bid) continue
    const [b, q] = ask ? [o.giveAmt, o.getAmt] : [o.getAmt, o.giveAmt]
    rows.push({ ...o, side: ask ? 'ask' : 'bid', base: b, quote: q,
      price: { num: q * 10n ** BigInt(base.decimals), den: b * 10n ** BigInt(quote.decimals) } })
  }
  const byId = (a: BookRow, b: BookRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const asks = rows.filter(r => r.side === 'ask').sort((a, b) => cmp(a.price, b.price) || byId(a, b))
  const bids = rows.filter(r => r.side === 'bid').sort((a, b) => cmp(b.price, a.price) || byId(a, b))
  const bestAsk = asks[0], bestBid = bids[0]
  const spread = bestAsk && bestBid
    ? { num: bestAsk.price.num * bestBid.price.den - bestBid.price.num * bestAsk.price.den, den: bestAsk.price.den * bestBid.price.den }
    : undefined
  let eb = 0n, eq = 0n
  for (const r of rows) r.side === 'ask' ? (eb += r.giveAmt) : (eq += r.giveAmt)
  return { asks, bids, bestBid, bestAsk, spread, escrowed: { base: eb, quote: eq } }
}

/** num/den as decimal text with `dp` places, rounded half-up (negative values keep their sign). */
export function priceText(price: Frac, dp = 4): string {
  const neg = price.num < 0n !== price.den < 0n && price.num !== 0n
  const n = price.num < 0n ? -price.num : price.num
  const d = price.den < 0n ? -price.den : price.den
  const scaled = (n * 10n ** BigInt(dp) * 2n + d) / (d * 2n)
  const s = scaled.toString().padStart(dp + 1, '0')
  const text = dp ? `${s.slice(0, -dp)}.${s.slice(-dp)}` : s
  return neg ? `-${text}` : text
}

/** amount (base units) x price (decimal string, quote per whole base) in quote units, half-up. */
export function quoteFor(amount: bigint, price: string, baseDecimals: number, quoteDecimals: number): bigint {
  if (!/^\d+(\.\d{1,18})?$/.test(price.trim())) throw new Error('Invalid price')
  const frac = price.trim().split('.')[1]?.length ?? 0
  const p = parseUnits(price.trim(), frac) // price * 10^frac
  if (p <= 0n) throw new Error('Invalid price')
  const den = 10n ** BigInt(frac + baseDecimals)
  return (amount * p * 10n ** BigInt(quoteDecimals) * 2n + den) / (den * 2n)
}
