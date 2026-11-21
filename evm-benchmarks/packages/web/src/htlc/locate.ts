import type { Address } from 'viem'
import { HashLock } from '@evmb/contracts'
import type { ChainHandle } from '../chain/handle'
import { contractsRegistry } from '../contracts/registry'
import type { Account } from '../store/accounts'
import { deployContract, inDeployOrder } from '../swap/locate'

/** This chain's HashLock: the newest-deployed `HashLock` record. */
export async function hashLockFor(chain: ChainHandle): Promise<Address | undefined> {
  const named = (await contractsRegistry.list(chain.info.id)).filter(r => r.name === 'HashLock')
  return (named.length < 2 ? named : await inDeployOrder(chain, named)).at(-1)?.address
}

/** Deploy HashLock.sol from `from` and save its contract record. Refused on benchmark chains. */
export const deployHashLock = (chain: ChainHandle, from: Account, onSent?: () => void) => deployContract(chain, from, 'HashLock', HashLock, onSent)
