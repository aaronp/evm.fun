import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

export type Account = { label: string; address: `0x${string}`; privateKey: `0x${string}` }

const KEY = 'evmb.accounts'

// Plaintext keys in localStorage (playground only), memory when storage is blocked.
export function createAccounts() {
  let items: Account[] = []
  let persistent = false
  const subs = new Set<() => void>()
  try {
    const raw = localStorage.getItem(KEY)
    items = raw ? JSON.parse(raw) : []
    persistent = true
  } catch {
    items = []
  }
  const save = () => {
    if (!persistent) return
    try { localStorage.setItem(KEY, JSON.stringify(items)) } catch {
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
    remove(address: string) {
      items = items.filter(a => a.address.toLowerCase() !== address.toLowerCase())
      save()
    },
    onPersistenceChange: (cb: () => void) => (subs.add(cb), () => void subs.delete(cb)),
    get persistent() { return persistent },
  }
}

export const accounts = createAccounts()
