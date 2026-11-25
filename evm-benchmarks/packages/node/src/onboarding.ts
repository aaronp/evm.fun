// Root's Onboarding: tx builders for its codes, and the root admin's one-time set-up (AllowList + Onboarding + alias).
import { encodeDeployData, encodeFunctionData, getContractAddress, pad, zeroAddress, type Address, type Hex, type LocalAccount } from 'viem'
import { Aliases, AllowList, Onboarding, type Contract } from '@evmb/contracts'
import { codeHash, mined, type NodeClient } from './client'

/** A chain id the redeem form accepts: a lowercase UUID. */
export const CHAIN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const ROOT_CHAIN_ID = 31337
const KIND_KEY = 1
const tx = { type: 'eip1559', chainId: ROOT_CHAIN_ID, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n } as const
// gas is free on root; a fixed limit, as claimTx's helper, so the app needn't estimate
const call = (account: LocalAccount, nonce: number, to: Address, data: Hex) => account.signTransaction({ ...tx, nonce, to, data, gas: 500_000n })
const onbCall = (account: LocalAccount, nonce: number, onboarding: Address, functionName: string, args: unknown[]) =>
  call(account, nonce, onboarding, encodeFunctionData({ abi: Onboarding.abi, functionName, args } as never))

export const issueTx = (account: LocalAccount, nonce: number, onboarding: Address, code: string, label: string, expiresAt: number, uses: number) =>
  onbCall(account, nonce, onboarding, 'issue', [codeHash(code), label, BigInt(expiresAt), uses])

export const revokeTx = (account: LocalAccount, nonce: number, onboarding: Address, hash: Hex) =>
  onbCall(account, nonce, onboarding, 'revoke', [hash])

export const redeemTx = (account: LocalAccount, nonce: number, onboarding: Address, code: string, chainId: string) =>
  onbCall(account, nonce, onboarding, 'redeem', [code, chainId])

/** Root admin: if root's Aliases has no "onboarding", deploy AllowList([admin]) + Onboarding and register the alias. Idempotent. */
export async function ensureOnboarding(client: NodeClient, admin: LocalAccount): Promise<{ onboarding: Address; allowList: Address }> {
  const at = (nonce: number) => getContractAddress({ from: admin.address, nonce: BigInt(nonce) })
  const [found, nonce] = [(await client.health()).root?.onboarding, await client.nonce('root')]
  if (found) {
    // ponytail: the AllowList is the admin's deploy just before Onboarding (as below); scans the admin's nonces.
    // Read Onboarding.issuers() instead once the client can eth_call root.
    for (let k = nonce - 1; k > 0; k--) if (at(k) === found) return { onboarding: found, allowList: at(k - 1) }
    throw new Error(`root's onboarding ${found} was not deployed by ${admin.address}`)
  }
  const { aliases } = await client.info('root')
  const [allowList, onboarding] = [at(nonce), at(nonce + 1)]
  const deploy = (c: Contract, args: unknown[], n: number) => admin.signTransaction({ ...tx, nonce: n, data: encodeDeployData({ abi: c.abi, bytecode: c.bytecode, args } as never), gas: 5_000_000n })
  mined(await client.submit('root', [
    await deploy(AllowList, [[{ kind: KIND_KEY, value: pad(admin.address) }]], nonce),
    await deploy(Onboarding, [allowList], nonce + 1),
    await call(admin, nonce + 2, aliases, encodeFunctionData({ abi: Aliases.abi, functionName: 'register', args: ['onboarding', onboarding, '', '', zeroAddress] })),
  ]))
  // mined() only says the txs are in a block; a reverted deploy or register shows here
  const now = (await client.health()).root?.onboarding
  if (now !== onboarding) throw new Error(`onboarding set-up failed: root's alias is ${now}, not the deployed ${onboarding}`)
  return { onboarding, allowList }
}
