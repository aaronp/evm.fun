import type { Asset } from '@evmb/assets'
import { priceText, type book } from '@evmb/swap'
import { formatAmount, shortAddress } from '../assets/ui'

type Book = ReturnType<typeof book>
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** Amounts on the Swap page: 2 dp, as in the mockup. */
export const amountText = (v: bigint, decimals: number) => formatAmount(v, decimals, 2)

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
