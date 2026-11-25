// Onboarding codes as the apps type and show them (on chain: 4–16 of A–Z 0–9).
export const normalizeCode = (s: string) => s.replace(/[\s-]/g, '').toUpperCase()
export const isValidCode = (s: string) => /^[A-Z0-9]{4,16}$/.test(normalizeCode(s))
/** "205117" → "205 117"; any other code as stored. */
export const formatCode = (c: string) => (/^\d{6}$/.test(c) ? `${c.slice(0, 3)} ${c.slice(3)}` : c)

export function generateCode(): string {
  // ponytail: modulo bias of 2^32 % 10^6 is ~2^-12 per draw; fine for a rate-limited code
  return String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0')
}

export const VALID_FOR = [
  { key: '1m', label: '1 minute', seconds: 60 },
  { key: '10m', label: '10 minutes', seconds: 600 },
  { key: '1h', label: '1 hour', seconds: 3600 },
  { key: '1d', label: '1 day', seconds: 86400 },
  { key: '1w', label: '1 week', seconds: 604800 },
] as const satisfies readonly { key: '1m' | '10m' | '1h' | '1d' | '1w'; label: string; seconds: number }[]
export const VOUCH_SECONDS = 600
