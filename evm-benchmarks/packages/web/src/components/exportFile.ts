import { NO_SNAPSHOT } from '../chain/snapshotUi'
import { ENGINE } from '../chain/revm'
import { encodeChainFile, fileNameFor, type ChainFile } from '../chain/chainFile'
import type { ChainHandle } from '../chain/handle'
import type { Snapshot } from '../chain/snapshots'
import { contractsRegistry } from '../contracts/registry'

/** Download the chain's current state, or `snap` (a snapshot of that chain), as a `.evmfun.json` file. Never includes keys. */
export async function exportChain(chain: ChainHandle, snap?: Snapshot) {
  if (!chain.approach.snapshot) throw new Error(NO_SNAPSHOT)
  const dump = snap ? snap.dump : await chain.approach.snapshot!()
  const height = snap ? snap.height : Number(BigInt((await chain.request('eth_blockNumber', [])) as string))
  const contracts = snap ? snap.contracts : await contractsRegistry.list(chain.info.id)
  const file: ChainFile = {
    format: 'evm.fun/chain', version: 1, exportedAt: new Date().toISOString(), chainId: 31337, engine: ENGINE,
    chain: { name: chain.info.name, type: chain.info.type }, dump, contracts, ...(chain.info.source && { source: chain.info.source }),
  }
  const url = URL.createObjectURL(new Blob([encodeChainFile(file)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileNameFor(chain.info.name, height)
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
