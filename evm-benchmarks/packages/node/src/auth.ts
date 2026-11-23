// Request auth (ported from spike/cf-chain): EIP-191 personal_sign over method, target, sha256(body), ts, nonce.
import { recoverMessageAddress, type Hex, type LocalAccount } from 'viem'

export const AUTH_VERSION = 'cf-chain v1'
export const SKEW_S = 300
const AUTH_PARAMS = ['ts', 'nonce', 'sig']

export function canonicalTarget(url: URL) {
  const u = new URL(url)
  for (const p of AUTH_PARAMS) u.searchParams.delete(p)
  return u.pathname + u.search
}

export async function sha256Hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const authMessage = async (method: string, url: URL, body: string, ts: string, nonce: string) =>
  `${AUTH_VERSION}\n${method} ${canonicalTarget(url)}\n${await sha256Hex(body)}\n${ts}\n${nonce}`

export async function signRequest(account: LocalAccount, method: string, url: URL, body: string) {
  const ts = String(Math.floor(Date.now() / 1000))
  const nonce = crypto.randomUUID()
  const sig = await account.signMessage!({ message: await authMessage(method, url, body, ts, nonce) })
  return { ts, nonce, sig }
}

export async function recoverSigner(method: string, url: URL, body: string, a: { ts: string; nonce: string; sig: string }) {
  const message = await authMessage(method, url, body, a.ts, a.nonce)
  return (await recoverMessageAddress({ message, signature: a.sig as Hex })).toLowerCase()
}
