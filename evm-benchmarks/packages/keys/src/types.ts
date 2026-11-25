import type { Address } from 'viem'
import type { LocalAccount } from 'viem/accounts'

export type UnlockRef =
  | { readonly mechanism: 'passkey-prf'; readonly credentialId: string }
  | { readonly mechanism: 'passphrase'; readonly passphraseId: string }
  | { readonly mechanism: 'unused' }
export type Grant = { readonly ref: UnlockRef; readonly secret: Uint8Array; readonly salt?: Uint8Array }
export type WithGrantOptions = { readonly salt?: Uint8Array; readonly purpose?: string }
export type UnlockProvider = {
  readonly ref: UnlockRef
  readonly mechanism?: UnlockRef['mechanism']
  withGrant<A>(fn: (g: Grant) => Promise<A>): Promise<A>
  withGrant<A>(o: WithGrantOptions, fn: (g: Grant) => Promise<A>): Promise<A>
}
export type KeyScope = { withSigner<A>(fn: (signer: LocalAccount) => Promise<A>): Promise<A> }
export type KeyStore = {
  readonly id: string
  hasKey(a: Address): Promise<boolean>
  list(): Promise<Address[]>
  /** Throws KeyNotFound if the address isn't held. */
  resolve(a: Address, purpose: string): Promise<KeyScope>
}
export type KeyGenerator = { readonly id: string; generate(): Promise<Address> }
export type StoredKey = { address: Address; encryptedPrivateKey: Uint8Array; iv: Uint8Array; ref: UnlockRef; createdAt: number }
export type KeyPersistence = {
  store(e: StoredKey): Promise<void>
  list(): Promise<StoredKey[]>
  getMeta(k: string): Promise<Uint8Array | undefined>
  setMeta(k: string, v: Uint8Array): Promise<void>
}

export class KeyNotFound extends Error {
  constructor(a: Address) {
    super(`Key not found: ${a}`)
    this.name = 'KeyNotFound'
  }
}
export class WrongPassphrase extends Error {
  constructor() {
    super('Wrong passphrase')
    this.name = 'WrongPassphrase'
  }
}
