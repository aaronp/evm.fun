import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

export type Account = { label: string; address: `0x${string}`; privateKey: `0x${string}` }

export const ACCOUNTS_KEY = 'evmb.accounts'

// Plaintext keys in localStorage (playground only), memory when storage is blocked.
export function createAccounts() {
  let items: Account[] = []
  let persistent = false
  const subs = new Set<() => void>()
  const changes = new Set<() => void>()
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    items = raw ? JSON.parse(raw) : []
    persistent = true
  } catch {
    items = []
  }
  const save = () => {
    changes.forEach(cb => cb()) // every change saves
    if (!persistent) return
    try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(items)) } catch {
      persistent = false
      subs.forEach(cb => cb())
    }
  }
  return {
    list: () => [...items],
    create(label: string): Account {
      const privateKey = generatePrivateKey()
      const a = { label, address: privateKeyToAccount(privateKey).address, privateKey }
      items.push(a)
      save()
      return a
    },
    /** Add an existing key (e.g. the root admin's from .env.local); refused if malformed or already here. */
    import(label: string, privateKey: string): Account {
      const k = privateKey.trim()
      if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error('A key is 0x followed by 64 hex characters')
      const address = privateKeyToAccount(k as `0x${string}`).address
      if (items.some(a => a.address.toLowerCase() === address.toLowerCase())) throw new Error(`${address} is already here`)
      const a = { label, address, privateKey: k as `0x${string}` }
      items.push(a)
      save()
      return a
    },
    rename(address: string, label: string) {
      const name = label.trim()
      if (!name) throw new Error('A name is needed')
      const i = items.findIndex(a => a.address.toLowerCase() === address.toLowerCase())
      if (i < 0) throw new Error(`no account ${address}`)
      items[i] = { ...items[i]!, label: name }
      save()
    },
    remove(address: string) {
      items = items.filter(a => a.address.toLowerCase() !== address.toLowerCase())
      save()
    },
    onPersistenceChange: (cb: () => void) => (subs.add(cb), () => void subs.delete(cb)),
    /** an account was added, renamed or removed; returns the unsubscribe */
    onChange: (cb: () => void) => (changes.add(cb), () => void changes.delete(cb)),
    get persistent() { return persistent },
  }
}

export const accounts = createAccounts()
