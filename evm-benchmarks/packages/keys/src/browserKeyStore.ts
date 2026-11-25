import { bytesToHex, getAddress, hexToBytes, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount, type LocalAccount } from 'viem/accounts'
import { aesKey, decrypt, encrypt, randomBytes } from './crypto'
import { KeyNotFound, WrongPassphrase, type Grant, type KeyGenerator, type KeyPersistence, type KeyScope, type KeyStore, type StoredKey, type UnlockProvider } from './types'

/** Keys encrypted at rest (AES-256-GCM, key from the provider's grant); decrypted signers kept until lock() or idle. */
export class BrowserKeyStore implements KeyStore, KeyGenerator {
  readonly id = 'browser'
  private readonly persistence: KeyPersistence
  private readonly provider: UnlockProvider
  private readonly idleLockMs: number
  private signers = new Map<string, Promise<LocalAccount>>()
  private salt: Promise<Uint8Array> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private epoch = 0 // bumped by lock(); an unlock that started before a lock() doesn't cache its signer

  constructor(o: { persistence: KeyPersistence; provider: UnlockProvider; idleLockMs?: number }) {
    this.persistence = o.persistence
    this.provider = o.provider
    this.idleLockMs = o.idleLockMs ?? 15 * 60_000
  }

  async list() { return (await this.persistence.list()).map((e) => e.address) }
  async hasKey(a: Address) { return (await this.find(a)) !== undefined }

  async resolve(a: Address, purpose: string): Promise<KeyScope> {
    if (!(await this.find(a))) throw new KeyNotFound(a)
    await this.signer(a, purpose)
    return { withSigner: async (fn) => fn(await this.signer(a, purpose)) }
  }

  generate() { return this.add(generatePrivateKey(), 'generate') }

  /** Idempotent for a held address (no prompt). */
  async importKey(privateKey: Hex): Promise<Address> {
    const { address } = privateKeyToAccount(privateKey)
    return (await this.find(address)) ? address : this.add(privateKey, 'import')
  }

  /** Forget decrypted signers. */
  lock() {
    this.epoch++
    this.signers.clear()
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private async find(a: Address) {
    const l = a.toLowerCase()
    return (await this.persistence.list()).find((e) => e.address.toLowerCase() === l)
  }

  private walletSalt() {
    return (this.salt ??= this.persistence.ensureMeta('wallet-salt', () => randomBytes(32)).catch((e) => { this.salt = undefined; throw e }))
  }

  private async withKey<A>(purpose: string, fn: (key: CryptoKey, g: Grant) => Promise<A>): Promise<A> {
    const salt = await this.walletSalt()
    return this.provider.withGrant({ salt, purpose }, async (g) => fn(await aesKey(g.secret, salt), g))
  }

  private async open(key: CryptoKey, e: StoredKey): Promise<LocalAccount> {
    const plain = await decrypt(key, e.iv, e.encryptedPrivateKey).catch(() => { throw new WrongPassphrase() })
    try {
      return privateKeyToAccount(bytesToHex(plain))
    } finally {
      plain.fill(0)
    }
  }

  /** The cached signer, or unlock it (one prompt even for concurrent callers). */
  private signer(a: Address, purpose: string): Promise<LocalAccount> {
    const k = a.toLowerCase()
    let p = this.signers.get(k)
    if (!p) {
      p = (async () => {
        const e = await this.find(a)
        if (!e) throw new KeyNotFound(a)
        return this.withKey(purpose, (key) => this.open(key, e))
      })()
      this.signers.set(k, p)
      p.catch(() => { if (this.signers.get(k) === p) this.signers.delete(k) })
    }
    return p.then((s) => (this.touch(), s))
  }

  private async add(privateKey: Hex, purpose: string): Promise<Address> {
    const account = privateKeyToAccount(privateKey)
    const epoch = this.epoch
    const held = await this.persistence.list()
    await this.withKey(purpose, async (key, g) => {
      // With keys held, the passphrase must open one of them; the first-ever passphrase is accepted as is.
      if (held[0]) await this.open(key, held[0])
      const plain = hexToBytes(privateKey)
      const { iv, ciphertext } = await encrypt(key, plain).finally(() => plain.fill(0))
      await this.persistence.store({ address: getAddress(account.address), encryptedPrivateKey: ciphertext, iv, ref: g.ref, createdAt: Date.now() })
    })
    if (epoch === this.epoch) {
      this.signers.set(account.address.toLowerCase(), Promise.resolve(account))
      this.touch()
    }
    return account.address
  }

  private touch() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.lock(), this.idleLockMs)
    ;(this.timer as { unref?: () => void }).unref?.()
  }
}
