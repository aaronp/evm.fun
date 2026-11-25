// WebCrypto only. AES-256-GCM under HKDF-SHA256(secret, salt, "vault-key-encryption"); passphrases via PBKDF2.
function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle
  if (!s) throw new Error('WebCrypto is unavailable: open the app over https or localhost')
  return s
}
const utf8 = (s: string) => new TextEncoder().encode(s)
// TS 5.7+ types Uint8Array<ArrayBufferLike> as not a BufferSource; ours are never shared buffers.
const buf = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>

export const randomBytes = (n: number) => (subtle(), globalThis.crypto.getRandomValues(new Uint8Array(n)))

export async function aesKey(secret: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', buf(secret), 'HKDF', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: utf8('vault-key-encryption') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encrypt(key: CryptoKey, plain: Uint8Array): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = randomBytes(12)
  return { iv, ciphertext: new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, buf(plain))) }
}

/** Rejects (OperationError) when the key is wrong: GCM authentication fails. */
export async function decrypt(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(ciphertext)))
}

export async function pbkdf2(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const base = await subtle().importKey('raw', utf8(passphrase), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations: 600_000 }, base, 256))
}
