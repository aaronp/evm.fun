import { kv } from '../store/kv'

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

export const contractsRegistry = {
  list: (chainId: string) => kv.list<Row>(store(chainId)).then(rows => rows as DeployedContract[]),
  add: (chainId: string, c: DeployedContract) => kv.set(store(chainId), key(c.address), { ...c, chainId }),
  remove: (chainId: string, address: string) => kv.del(store(chainId), key(address)),
}
