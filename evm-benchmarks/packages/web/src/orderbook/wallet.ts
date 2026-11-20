import { formatTransactionReceipt, type RpcTransactionReceipt } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Wallet } from '@evmb/orderbook'
import type { ChainHandle } from '../chain/handle'
import type { Account } from '../store/accounts'
import { signAndSend } from '../tx/send'

/** The acting account as an order-book `Wallet`: sends with `signAndSend`, signs typed data with its stored key. */
export function walletOf(chain: ChainHandle, account: Account, onSent?: () => void): Wallet {
  return {
    address: account.address,
    async sendTransaction(tx) {
      const r = await signAndSend(chain, account, tx, onSent)
      const rc = (await chain.request('eth_getTransactionReceipt', [r.hash]).catch(() => null)) as RpcTransactionReceipt | null
      if (!rc) throw new Error(`Transaction ${r.status}${r.error ? `: ${r.error}` : ''}`) // rejected: never mined
      return formatTransactionReceipt(rc)
    },
    signTypedData: td => privateKeyToAccount(account.privateKey).signTypedData(td as any),
  }
}
