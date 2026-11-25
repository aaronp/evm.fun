import { describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { hexToBytes, recoverMessageAddress, type Hex } from 'viem'
import { BrowserKeyStore, KeyNotFound, MemoryKeyPersistence, WrongPassphrase, passphraseProvider, type StoredKey } from '../src'

function setup(answers: (string | null)[] | string = 'hunter2', persistence = new MemoryKeyPersistence()) {
  const asked: string[] = []
  const ask = async (purpose: string) => {
    asked.push(purpose)
    return typeof answers === 'string' ? answers : (answers.shift() ?? null)
  }
  const store = new BrowserKeyStore({ persistence, provider: passphraseProvider({ persistence, ask }) })
  return { store, persistence, asked }
}

const sign = (store: BrowserKeyStore, a: Hex, purpose = 'test') =>
  store.resolve(a, purpose).then((s) => s.withSigner((signer) => signer.signMessage({ message: 'hi' })))

const includes = (hay: Uint8Array, needle: Uint8Array) =>
  Buffer.from(hay).indexOf(Buffer.from(needle)) !== -1

describe('BrowserKeyStore', () => {
  test('generate → list/hasKey; resolve signs a message recoverable to the address', async () => {
    const { store } = setup()
    const a = await store.generate()
    expect(await store.list()).toEqual([a])
    expect(await store.hasKey(a)).toBe(true)
    expect(await store.hasKey(a.toLowerCase() as Hex)).toBe(true)
    store.lock()
    const sig = await sign(store, a)
    expect(await recoverMessageAddress({ message: 'hi', signature: sig })).toBe(a)
  })

  test('persistence holds no plaintext (the private key bytes don\'t appear in any stored field)', async () => {
    const { store, persistence } = setup()
    const pk = generatePrivateKey()
    await store.importKey(pk)
    const raw = hexToBytes(pk)
    const [e] = await persistence.list() as StoredKey[]
    for (const v of Object.values(e!)) if (v instanceof Uint8Array) expect(includes(v, raw)).toBe(false)
    expect(JSON.stringify(e, (_, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v))).not.toContain(pk.slice(2))
  })

  test('import is idempotent and the imported key signs', async () => {
    const { store, asked } = setup()
    const pk = generatePrivateKey()
    const a = await store.importKey(pk)
    expect(a).toBe(privateKeyToAccount(pk).address)
    expect(await store.importKey(pk)).toBe(a)
    expect(await store.list()).toEqual([a])
    expect(asked.length).toBe(1)
    store.lock()
    const sig = await sign(store, a)
    expect(await recoverMessageAddress({ message: 'hi', signature: sig })).toBe(a)
  })

  test('wrong passphrase → WrongPassphrase, storage unchanged; right one signs', async () => {
    const { store, persistence } = setup(['right', 'wrong', 'wrong', 'right'])
    const a = await store.generate()
    store.lock()
    const before = await persistence.list()
    const meta = () => Promise.all(['wallet-salt', 'passphrase-salt', 'passphrase-id'].map((k) => persistence.getMeta(k)))
    const metaBefore = await meta()
    expect(metaBefore.every((m) => m instanceof Uint8Array)).toBe(true)
    const err = await sign(store, a).catch((e) => e)
    expect(err).toBeInstanceOf(WrongPassphrase)
    expect(err.message).toBe('Wrong passphrase')
    // a wrong passphrase must not add a key either
    expect(await store.importKey(generatePrivateKey()).catch((e) => e)).toBeInstanceOf(WrongPassphrase)
    expect(await persistence.list()).toEqual(before)
    expect(await meta()).toEqual(metaBefore)
    const sig = await sign(store, a)
    expect(await recoverMessageAddress({ message: 'hi', signature: sig })).toBe(a)
  })

  test('cancelled prompt → rejects "cancelled"', async () => {
    const { store, persistence } = setup([null, 'pw', null])
    await expect(store.generate()).rejects.toThrow('cancelled')
    expect(await persistence.list()).toEqual([])
    const a = await store.generate()
    store.lock()
    await expect(sign(store, a)).rejects.toThrow('cancelled')
  })

  test('lock() makes the next resolve prompt again; within the session no second prompt', async () => {
    const { store, asked } = setup()
    const a = await store.generate()
    expect(asked).toEqual(['generate'])
    await sign(store, a)
    await sign(store, a)
    expect(asked.length).toBe(1)
    store.lock()
    await sign(store, a, 'deploy')
    expect(asked).toEqual(['generate', 'deploy'])
    await sign(store, a)
    expect(asked.length).toBe(2)
  })

  test('idle timeout locks', async () => {
    const persistence = new MemoryKeyPersistence()
    const asked: string[] = []
    const provider = passphraseProvider({ persistence, ask: async (p) => (asked.push(p), 'pw') })
    const store = new BrowserKeyStore({ persistence, provider, idleLockMs: 20 })
    const a = await store.generate()
    await Bun.sleep(60)
    await sign(store, a)
    expect(asked.length).toBe(2)
    store.lock()
  })

  test('unknown address → KeyNotFound', async () => {
    const { store, asked } = setup()
    await expect(store.resolve(privateKeyToAccount(generatePrivateKey()).address, 'x')).rejects.toBeInstanceOf(KeyNotFound)
    expect(asked).toEqual([])
  })

  test('two stores with different wallet salts produce different ciphertexts for the same key', async () => {
    const pk = generatePrivateKey()
    const one = setup()
    const two = setup()
    await one.store.importKey(pk)
    await two.store.importKey(pk)
    const [s1, s2] = await Promise.all([one.persistence.getMeta('wallet-salt'), two.persistence.getMeta('wallet-salt')])
    expect(s1!.length).toBe(32)
    expect(s1).not.toEqual(s2)
    const [e1] = await one.persistence.list()
    const [e2] = await two.persistence.list()
    expect(e1!.encryptedPrivateKey).not.toEqual(e2!.encryptedPrivateKey)
  })

  test('lock() during an in-flight generate wins: the new signer is not cached', async () => {
    const { store, asked } = setup()
    const pending = store.generate()
    store.lock()
    const a = await pending
    await sign(store, a)
    expect(asked.length).toBe(2)
    store.lock()
  })

  test('ensureMeta never replaces an existing value', async () => {
    const p = new MemoryKeyPersistence()
    const first = await p.ensureMeta('wallet-salt', () => new Uint8Array([1]))
    expect(await p.ensureMeta('wallet-salt', () => new Uint8Array([2]))).toEqual(first)
    expect(await p.getMeta('wallet-salt')).toEqual(new Uint8Array([1]))
  })
})
