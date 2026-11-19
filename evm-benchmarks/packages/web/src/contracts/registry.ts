import { kv, type Kv } from '../store/kv'

export type DeployedContract = {
  address: `0x${string}`
  name: string
  abi: any[]
  deployer: `0x${string}`
  txHash: `0x${string}`
}
type Row = DeployedContract & { chainId: string }

// kv.list is per store, so one store per chain.
const store = (chainId: string) => `contracts:${chainId}`
const key = (address: string) => address.toLowerCase()

export const createContractsRegistry = (kv: Kv) => ({
  list: (chainId: string) => kv.list<Row>(store(chainId)).then(rows => rows as DeployedContract[]),
  add: (chainId: string, c: DeployedContract) => kv.set(store(chainId), key(c.address), { ...c, chainId }),
  remove: (chainId: string, address: string) => kv.del(store(chainId), key(address)),
  /** Make the chain's records exactly `records`. */
  async replace(chainId: string, records: DeployedContract[]) {
    // write first, then drop stale: a mid-way failure never leaves the chain with none
    for (const r of records) await kv.set(store(chainId), key(r.address), { ...r, chainId })
    const keep = new Set(records.map(r => key(r.address)))
    for (const r of await kv.list<Row>(store(chainId))) if (!keep.has(key(r.address))) await kv.del(store(chainId), key(r.address))
  },
})

export const contractsRegistry = createContractsRegistry(kv)
