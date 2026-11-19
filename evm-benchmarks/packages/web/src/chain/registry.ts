import type { Address, ApproachHost } from '@evmb/core'
import plain from '@evmb/approach-01-webevm-baseline'
import sequencer from '@evmb/approach-02-seq-memory'
import type { Kv } from '../store/kv'
import { makeHandle, type ChainHandle, type ChainInfo, type ChainType } from './handle'

export type { ChainHandle, ChainInfo, ChainType }

const STORE = 'chains'
const factories = { plain, sequencer }
const PREFUND = 10n ** 21n

export function createChainRegistry(deps: {
  kv: Kv
  host: (chainId: string) => ApproachHost
  /** delete the chain's persisted state */
  purge?: (chainId: string) => Promise<void>
}) {
  const live = new Map<string, ChainHandle>()
  const opening = new Map<string, Promise<ChainHandle>>() // concurrent open(id) shares one node
  const build = (info: ChainInfo) => makeHandle(info, factories[info.type]({}, deps.host(info.id)))
  const track = (h: ChainHandle) => (live.set(h.info.id, h), h)

  return {
    async list(): Promise<ChainInfo[]> {
      const stored = await deps.kv.list<ChainInfo>(STORE)
      const ephemeral = [...live.values()].map(h => h.info).filter(i => i.ephemeral)
      return [...stored.sort((a, b) => a.createdAt.localeCompare(b.createdAt)), ...ephemeral]
    },
    async create(name: string, type: ChainType, prefund: Address[]): Promise<ChainHandle> {
      const info: ChainInfo = { id: crypto.randomUUID(), name, type, createdAt: new Date().toISOString() }
      const h = build(info)
      await h.approach.setup({ prefund: Object.fromEntries(prefund.map(a => [a, PREFUND])) })
      await deps.kv.set(STORE, info.id, info)
      return track(h)
    },
    open(id: string): Promise<ChainHandle> {
      const cached = live.get(id)
      if (cached) return Promise.resolve(cached)
      let p = opening.get(id)
      if (!p) {
        p = (async () => {
          const info = await deps.kv.get<ChainInfo>(STORE, id)
          if (!info) throw new Error(`unknown chain ${id}`)
          const h = build(info)
          try {
            await h.approach.open!()
          } catch (e) {
            await h.dispose().catch(() => {})
            throw e
          }
          return track(h)
        })().finally(() => opening.delete(id))
        opening.set(id, p)
      }
      return p
    },
    async remove(id: string) {
      await live.get(id)?.dispose()
      live.delete(id)
      await deps.kv.del(STORE, id)
      await deps.purge?.(id)
    },
    addEphemeral(handle: ChainHandle) {
      handle.info.ephemeral = true
      live.set(handle.info.id, handle)
    },
  }
}
