import { MAX_UINT256, type Asset } from '@evmb/assets'
import { book, priceText, quoteFor, type ActivityItem, type BookRow, type Offer, type Reason, takerOf, type Side } from '@evmb/swap'
import { formatAmount, parseAmount, shortAddress } from '../assets/ui'

type Book = ReturnType<typeof book>
export const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** Amounts on the Swap page: 2 dp, as in the mockup. */
export const amountText = (v: bigint, decimals: number) => formatAmount(v, decimals, 2)

/** Exact amount: every significant digit, at least 2 dp. */
export const exactText = (v: bigint, decimals: number) => formatAmount(v, decimals).replace(/(\.\d\d\d*?)0+$/, '$1')

/** Allowance text: "unlimited" for the max approval. */
export const allowText = (v: bigint, decimals: number) => (v === MAX_UINT256 ? 'unlimited' : amountText(v, decimals))

const tok = (a: Asset) => ({ address: a.address!, decimals: a.decimals })

/** An offer as a row of the base/quote book whatever its status; undefined when it's another pair. */
export function rowOf(o: Offer, base: Asset, quote: Asset): BookRow | undefined {
  const b = book([{ ...o, status: 'open' }], tok(base), tok(quote))
  const r = b.asks[0] ?? b.bids[0]
  return r && { ...r, status: o.status }
}

/** Who took a filled offer, from the offer itself (stored by the contract), named by `name`. */
export const takenBy = (o: Offer, name: (a: string) => string) => (t => t && name(t))(takerOf(o))

type Leg = { asset: Asset; amount: bigint }
const POSITIVE = 'Amount and price must be positive numbers.'

/** Make-offer form: what is escrowed now and what comes back when taken (quote = amount x price, half-up). */
export function formQuote(side: Side, amount: string, price: string, base: Asset, quote: Asset): { give: Leg; get: Leg } | { error: string } {
  const text = amount.replace(/,/g, '').trim()
  if (!text || !price.trim()) return { error: 'Enter both an amount and a price.' }
  const positive = (t: string) => /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t) && /[1-9]/.test(t)
  if (!positive(text) || !positive(price.trim())) return { error: POSITIVE }
  if ((text.split('.')[1] ?? '').length > base.decimals) return { error: `${base.symbol} has ${base.decimals} decimals — use at most ${base.decimals} after the point.` }
  const a = parseAmount(text, base.decimals)
  if ('error' in a) return { error: POSITIVE }
  let q: bigint
  try { q = quoteFor(a.ok, price, base.decimals, quote.decimals) } catch { return { error: POSITIVE } }
  if (q === 0n) return { error: `Rounds to ${exactText(0n, quote.decimals)} ${quote.symbol} — raise the amount or price.` }
  const b = { asset: base, amount: a.ok }, qt = { asset: quote, amount: q }
  return side === 'ask' ? { give: b, get: qt } : { give: qt, get: b }
}

/** The advisory note when a new offer at `price` would cross the book's best opposite offer. */
export function crosses(side: Side, price: string, b: Book): string | undefined {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(price.trim())
  const best = side === 'ask' ? b.bestBid : b.bestAsk
  if (!m || !best) return
  const frac = m[2] ?? ''
  const num = BigInt(m[1]! + frac), den = 10n ** BigInt(frac.length) // price = num/den
  const d = num * best.price.den - best.price.num * den // sign of price - best
  if (num === 0n || (side === 'ask' ? d > 0n : d < 0n)) return
  return `Someone is already ${side === 'ask' ? 'buying' : 'selling'} at ${priceText(best.price)} or better — take their offer instead. Swap doesn’t match offers for you.`
}

const REASON = { filled: 'already taken', cancelled: 'offer cancelled', other: 'reverted' }
/** Why a take reverted, short: "USD allowance too low", "already taken", … */
const reasonText = (r: Reason, paySymbol = 'token') => (r === 'allowance' || r === 'balance' ? `${paySymbol} ${r} too low` : REASON[r])

/** The Swap page's flash after a take; the reason comes from the take's report. */
export const takeFlash = (id: bigint, status: 'success' | 'reverted', reason?: Reason, paySymbol?: string) =>
  status === 'success' ? `Offer #${id} settled in one transaction.` : `Take #${id} reverted${reason ? ` — ${reasonText(reason, paySymbol)}` : ''}.`

/** One Activity line, as in the mockup. */
export function activityText(i: ActivityItem, l: { name(a: string): string; offer(id: bigint): Offer | undefined; base: Asset; quote: Asset }): string {
  const who = l.name(i.actor)
  const o = i.id === undefined ? undefined : l.offer(i.id)
  const t = (addr?: string) => [l.base, l.quote].find(x => same(x.address, addr))
  const amt = (v: bigint, addr: string) => { const x = t(addr); return x ? `${amountText(v, x.decimals)} ${x.symbol}` : `${v} ${shortAddress(addr)}` }
  switch (i.kind) {
    case 'approved': {
      const x = t(i.token)
      return `${who} approved Swap for ${x ? `${allowText(i.amount!, x.decimals)} ${x.symbol}` : amt(i.amount!, i.token!)}`
    }
    case 'reverted': {
      return `${who} tried to take #${i.id} — ${reasonText(i.reason ?? 'other', t(o?.getToken)?.symbol)}`
    }
    case 'taken': return `#${i.id} taken by ${who}${o ? ` · ${amt(o.giveAmt, o.giveToken)} ⇄ ${amt(o.getAmt, o.getToken)}` : ''}`
    case 'cancelled': return `#${i.id} cancelled by ${who}${o ? ` · ${amt(o.giveAmt, o.giveToken)} returned` : ''}`
    case 'offered': {
      const r = o && rowOf(o, l.base, l.quote)
      return `#${i.id} by ${who}${r ? ` · ${r.side === 'ask' ? 'sell' : 'buy'} ${amountText(r.base, l.base.decimals)} ${l.base.symbol} @ ${priceText(r.price)}` : ''}`
    }
  }
}

/** Base/quote from the chain's ERC-20 assets: URL addresses when they match, else the first two. */
export function pickPair(assets: Asset[], base?: string | null, quote?: string | null): { tokens: Asset[]; base?: Asset; quote?: Asset; error?: string } {
  const tokens = assets.filter(a => a.kind === 'erc20')
  if (tokens.length < 2) return { tokens, error: 'Swap needs two ERC-20 assets on this chain.' }
  if (same(base, quote)) return { tokens, error: 'Pick two different tokens.' }
  const b = tokens.find(t => same(t.address, base)) ?? tokens.find(t => !same(t.address, quote))!
  const q = tokens.find(t => same(t.address, quote) && t !== b) ?? tokens.find(t => t !== b)!
  return { tokens, base: b, quote: q }
}

/** Stat-card and spread-row text for a book. */
export function statsText(b: Book, base: Asset, quote: Asset) {
  return {
    bestBid: b.bestBid ? priceText(b.bestBid.price) : '—',
    bestAsk: b.bestAsk ? priceText(b.bestAsk.price) : '—',
    spread: b.spread ? priceText(b.spread) : '—',
    escrowBase: amountText(b.escrowed.base, base.decimals),
    escrowQuote: amountText(b.escrowed.quote, quote.decimals),
  }
}

/** "you" for the acting account, else the account's name, else a short address. */
export function makerLabel(maker: string, acting: string | undefined, people: { label: string; address: string }[]): string {
  if (same(maker, acting)) return 'you'
  return people.find(p => same(p.address, maker))?.label ?? shortAddress(maker)
}
