import { privateKeyToAccount } from 'viem/accounts'
import { signTx, type Receipt } from '@evmb/core'
import type { Address, Hex } from 'viem'
import type { ChainHandle } from '../chain/handle'
import type { Account } from '../store/accounts'

/** Sign with a stored playground account and send. Nonce from the pending pool, gas = estimate x 1.2 (3M fallback). */
export async function signAndSend(
  handle: ChainHandle,
  account: Account,
  tx: { to?: Address; data?: Hex; value?: bigint },
): Promise<Receipt> {
  const nonce = Number(BigInt((await handle.request('eth_getTransactionCount', [account.address, 'pending'])) as string))
  let gas = 3_000_000n
  try {
    const est = BigInt(
      (await handle.request('eth_estimateGas', [
        { from: account.address, to: tx.to, data: tx.data, value: tx.value === undefined ? undefined : `0x${tx.value.toString(16)}` },
      ])) as string,
    )
    gas = (est * 12n) / 10n
  } catch {
    // estimate unsupported or the call reverts: fall back and let the receipt report it
  }
  return handle.send(await signTx(privateKeyToAccount(account.privateKey), nonce, { ...tx, gas }))
}
