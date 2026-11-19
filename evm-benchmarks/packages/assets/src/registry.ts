import type { Address } from 'viem'
import type { Asset, AssetId } from './types'
import type { KeyValueStore } from './store'

export const assetId = (chainId: string, address?: Address): AssetId =>
  `${chainId}:${address ? address.toLowerCase() : 'native'}`

export const nativeAsset = (chainId: string): Asset => ({
  id: assetId(chainId), chainId, kind: 'native', symbol: 'ETH', name: 'Native coin',
  decimals: 18, origin: 'native', mintable: false, addedAt: '',
})

export const rebase = (a: Asset, newChainId: string): Asset =>
  ({ ...a, chainId: newChainId, id: assetId(newChainId, a.address) })

const ns = (chainId: string) => `assets:${chainId}`
const key = (address: string) => address.toLowerCase()
const isStored = (a: Asset): a is Asset & { address: Address } => a.kind === 'erc20' && !!a.address

export function createAssetRegistry(store: KeyValueStore) {
  const stored = (chainId: string) => store.list<Asset>(ns(chainId))
  return {
    /** Stored tokens by addedAt, then native. */
    async list(chainId: string): Promise<Asset[]> {
      const rows = (await stored(chainId)).sort((a, b) => a.addedAt.localeCompare(b.addedAt))
      return [...rows, nativeAsset(chainId)]
    },
    async get(id: AssetId): Promise<Asset | undefined> {
      const i = id.indexOf(':')
      const chainId = id.slice(0, i), rest = id.slice(i + 1)
      return rest === 'native' ? nativeAsset(chainId) : store.get<Asset>(ns(chainId), rest)
    },
    /** Idempotent per id: the first record is kept. */
    async add(a: Asset) {
      if (!isStored(a)) return
      if (!(await store.get(ns(a.chainId), key(a.address)))) await store.set(ns(a.chainId), key(a.address), a)
    },
    async remove(id: AssetId) {
      const i = id.indexOf(':')
      if (id.slice(i + 1) === 'native') throw new Error("The native asset can't be removed")
      await store.del(ns(id.slice(0, i)), id.slice(i + 1))
    },
    /** Make the chain's stored tokens exactly `assets` (native ignored). Writes first, then prunes. */
    async replace(chainId: string, assets: Asset[]) {
      const keep = assets.filter(isStored)
      for (const a of keep) await store.set(ns(chainId), key(a.address), a)
      const ids = new Set(keep.map(a => key(a.address)))
      for (const a of await stored(chainId)) if (!ids.has(key(a.address!))) await store.del(ns(chainId), key(a.address!))
    },
    async removeChain(chainId: string) {
      for (const a of await stored(chainId)) await store.del(ns(chainId), key(a.address!))
    },
  }
}
