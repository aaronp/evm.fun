export interface KeyValueStore {
  get<T>(ns: string, key: string): Promise<T | undefined>
  set(ns: string, key: string, value: unknown): Promise<void>
  del(ns: string, key: string): Promise<void>
  list<T>(ns: string): Promise<T[]>
}

export function memoryStore(): KeyValueStore {
  const m = new Map<string, Map<string, unknown>>()
  const ns = (n: string) => m.get(n) ?? m.set(n, new Map()).get(n)!
  return {
    get: async (n, k) => structuredClone(ns(n).get(k)) as any,
    set: async (n, k, v) => void ns(n).set(k, structuredClone(v)),
    del: async (n, k) => void ns(n).delete(k),
    list: async n => structuredClone([...ns(n).values()]) as any,
  }
}
