import { bytesToHex } from 'viem'
import { pbkdf2, randomBytes } from './crypto'
import type { Grant, KeyPersistence, UnlockProvider, UnlockRef, WithGrantOptions } from './types'

/** ask(purpose) returns the passphrase or null (cancelled → throws Error "cancelled"). Stores its PBKDF2 salt under meta "passphrase-salt". */
export function passphraseProvider(o: {
  persistence: KeyPersistence
  ask(purpose: string): Promise<string | null>
  id?: string
}): UnlockProvider {
  const { persistence } = o
  let ref: UnlockRef = { mechanism: 'passphrase', passphraseId: o.id ?? '' }
  let init: Promise<Uint8Array> | undefined
  // Salt and id are each created on first use if missing; `ref` carries the id once loaded.
  const salt = () => (init ??= (async () => {
    const s = await persistence.ensureMeta('passphrase-salt', () => randomBytes(32))
    const id = await persistence.ensureMeta('passphrase-id', () => randomBytes(16))
    ref = { mechanism: 'passphrase', passphraseId: o.id ?? bytesToHex(id).slice(2) }
    return s
  })().catch((e) => { init = undefined; throw e }))

  async function withGrant<A>(a: WithGrantOptions | ((g: Grant) => Promise<A>), b?: (g: Grant) => Promise<A>): Promise<A> {
    const [opts, fn] = typeof a === 'function' ? [{} as WithGrantOptions, a] : [a, b!]
    const pbkdfSalt = await salt()
    const passphrase = await o.ask(opts.purpose ?? '')
    if (passphrase === null) throw new Error('cancelled')
    const secret = await pbkdf2(passphrase, pbkdfSalt)
    try {
      return await fn({ ref, secret, salt: opts.salt })
    } finally {
      secret.fill(0)
    }
  }

  return { get ref() { return ref }, mechanism: 'passphrase', withGrant }
}
