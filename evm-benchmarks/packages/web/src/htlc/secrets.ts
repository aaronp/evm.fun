import type { Hex } from 'viem'
import { hashOf } from '@evmb/htlc'
import { kv as appKv, type Kv } from '../store/kv'

/** kv table (workspace data: saved in files, cleared by New, replaced by Open). */
export const SECRETS = 'secrets'
/** The maker's secret for a hash; `lockId` is the opening lock's id (decimal), '' until it is mined. */
export type SecretEntry = { secret: Hex; chain: string; lockId: string }

export const createSecrets = (kv: Kv) => ({
  async put(hash: Hex, e: SecretEntry) {
    if (hashOf(e.secret) !== hash.toLowerCase()) throw new Error('secret does not match its hash')
    await kv.set(SECRETS, hash.toLowerCase(), { secret: e.secret, chain: e.chain, lockId: e.lockId })
  },
  get: (hash: Hex) => kv.get<SecretEntry>(SECRETS, hash.toLowerCase()),
  all: async () => (await kv.list<SecretEntry>(SECRETS)).map(e => ({ hash: hashOf(e.secret), ...e })),
})

export const secrets = createSecrets(appKv)

/** kv table: chain A's head when the taker locked on B, by hash (decimal), so the swap report judges `unsafe` exactly.
 * Not saved in workspace files: a reopened file's report falls back to the lock-block proxy (see @evmb/htlc README). */
export const ANSWERS = 'xswapAnswers'
export const createAnswers = (kv: Kv) => ({
  put: (hash: Hex, headA: bigint) => kv.set(ANSWERS, hash.toLowerCase(), String(headA)),
  get: (hash: Hex) => kv.get<string>(ANSWERS, hash.toLowerCase()),
})
export const answers = createAnswers(appKv)
