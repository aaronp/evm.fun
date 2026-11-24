import { privateKeyToAccount } from 'viem/accounts'
import { signTx, type Receipt } from '@evmb/core'
import { decodeFunctionResult, encodeFunctionData, getAddress, type Abi, type Address, type Hex } from 'viem'
import type { ChainHandle } from '../chain/handle'
import type { Account } from '../store/accounts'

const MAX_FEE = 2_000_000_000n // signTx's maxFeePerGas

/** Sign with a stored playground account and send. Nonce from the pending pool, gas = estimate x 1.2 (3M fallback).
 *  Throws a gas shortfall (see `gasShortfall`) without sending when the account can't pay the fees. */
export async function signAndSend(
  handle: ChainHandle,
  account: Account,
  tx: { to?: Address; data?: Hex; value?: bigint },
  /** called once the tx has settled, e.g. to refresh balances */
  onSent?: () => void,
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
  // the sender must afford its whole gas limit at the max fee plus the value: refuse here, typed, rather than send
  // (a sequencer chain's executor stops for good on such a tx). ponytail: ignores the sender's other pending txs
  const need = gas * MAX_FEE + (tx.value ?? 0n)
  const have = BigInt((await handle.request('eth_getBalance', [account.address, 'latest'])) as string)
  if (have < need) throw new Error(`insufficient funds for gas * price + value: address ${account.address} have ${have} want ${need} — ${account.label} needs ETH to pay for this transaction (value and fees).`)
  const receipt = await handle.send(await signTx(privateKeyToAccount(account.privateKey), nonce, { ...tx, gas }))
  onSent?.()
  return receipt
}

/** eth_call a view/pure function and decode the result. */
export async function readContract(handle: ChainHandle, to: Address, abi: Abi, functionName: string, args: unknown[] = []): Promise<unknown> {
  const data = encodeFunctionData({ abi, functionName, args } as any)
  const out = (await handle.request('eth_call', [{ to, data }, 'latest'])) as Hex
  return decodeFunctionResult({ abi, functionName, data: out } as any)
}

/** A send the sender can't pay fees for: `need` (gas limit × max fee + value) when the node said, and what it has. */
export type GasShortfall = { address: Address; need?: bigint; have?: bigint }
const GAS_SHORT = /insufficient funds for gas \* price \+ value: address (0x[0-9a-fA-F]{40}) have (\d+) want (\d+)/

/** The one place that decides "no ETH for fees": the node's message, wherever it ended up — a thrown error, a
 *  rejected receipt's `error`, or the text a page shows ("Transfer rejected: …"). */
export function gasShortfall(e: unknown): GasShortfall | undefined {
  const text = typeof e === 'string' ? e : e instanceof Error ? e.message : (e as { error?: unknown } | undefined)?.error
  const m = typeof text === 'string' ? GAS_SHORT.exec(text) : null
  return m ? { address: getAddress(m[1]!), have: BigInt(m[2]!), need: BigInt(m[3]!) } : undefined
}
