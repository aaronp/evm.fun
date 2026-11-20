const pow10 = (n: number) => 10n ** BigInt(n)

/** Quote raw units for `amount` base raw units at `price` (quote raw per whole base). Taker pays 'up', receives 'down'. */
export const quoteFor = (amount: bigint, price: bigint, baseDecimals: number, round: 'up' | 'down'): bigint => {
  const n = amount * price, d = pow10(baseDecimals)
  return round === 'up' ? (n + d - 1n) / d : n / d
}

export const tickOf = (quoteDecimals: number): bigint => pow10(Math.max(quoteDecimals - 4, 0))

/** 4 dp, trailing zeros kept: "1.2700"; a negative difference keeps its sign: "-0.0300". */
export const priceText = (price: bigint, quoteDecimals: number): string => {
  if (price < 0n) return `-${priceText(-price, quoteDecimals)}`
  const v = quoteDecimals >= 4 ? price / pow10(quoteDecimals - 4) : price * pow10(4 - quoteDecimals)
  return `${v / 10000n}.${(v % 10000n).toString().padStart(4, '0')}`
}

/** Raw quote units for a price typed with at most 4 dp; throws on anything else, zero, or a value off the tick. */
export const parsePrice = (text: string, quoteDecimals: number): bigint => {
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text.trim())
  if (!m) throw new Error('Price must be a number with at most 4 decimals')
  const frac = (m[2] ?? '').padEnd(4, '0')
  if (quoteDecimals < 4 && /[1-9]/.test(frac.slice(quoteDecimals))) throw new Error(`Price must have at most ${quoteDecimals} decimals`)
  const v = BigInt(m[1]!) * 10000n + BigInt(frac)
  const raw = quoteDecimals >= 4 ? v * pow10(quoteDecimals - 4) : v / pow10(4 - quoteDecimals)
  if (raw === 0n) throw new Error('Price must be above zero')
  return raw
}
