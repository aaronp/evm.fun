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
 * Workspace data like `secrets` (saved in files as `answers`, cleared by New, replaced by Open). */
export const ANSWERS = 'xswapAnswers'
export type AnswerEntry = { hash: Hex; headA: string }
export const createAnswers = (kv: Kv) => ({
  put: (hash: Hex, headA: bigint | string) => kv.set(ANSWERS, hash.toLowerCase(), { hash: hash.toLowerCase(), headA: String(headA) }),
  get: async (hash: Hex) => (await kv.get<AnswerEntry>(ANSWERS, hash.toLowerCase()))?.headA,
  all: () => kv.list<AnswerEntry>(ANSWERS),
})
export const answers = createAnswers(appKv)
