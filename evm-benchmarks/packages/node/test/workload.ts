// Deterministic mixed workload for ChainNode tests and the soak: ETH transfers, an AssetToken (deployed at block 1)
// with transfers to keyed holders, every 10th block one holder sends its whole balance back (its slot goes to zero),
// every 7th block 20 txs, else 1-3.
import { readFileSync } from 'node:fs'
import { createNode, type SerializedState } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { encodeAbiParameters, encodeFunctionData, getContractAddress, keccak256, toHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AssetToken } from '@evmb/contracts'

export const wasm = readFileSync(require.resolve('revm-wasm/revm.wasm'))
export const CHAIN_ID = 777
export const T0 = 1_700_000_000
const key = (i: number) => keccak256(toHex(`evmb-node-${i}`))
export const SENDERS = [0, 1, 2, 3].map((i) => privateKeyToAccount(key(i))) // 0 = token issuer
export const HOLDERS = Array.from({ length: 8 }, (_, i) => privateKeyToAccount(key(100 + i)))
export const TOKEN = getContractAddress({ from: SENDERS[0]!.address, nonce: 0n })
const pool = Array.from({ length: 50 }, (_, i) => `0x${keccak256(toHex(i)).slice(26)}` as Hex)

/** ERC20 (OZ 5) `_balances` is slot 0. */
export const balanceSlot = (holder: Hex) =>
  keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [holder, 0n]))

export function workload() {
  const nonces = new Map<string, number>()
  const balances = new Map<string, bigint>(HOLDERS.map((h) => [h.address, 0n]))
  let seq = 0
  const sign = (acct: (typeof SENDERS)[number], to: Hex | undefined, data: Hex = '0x', value = 0n, gas = 100_000n) => {
    const nonce = nonces.get(acct.address) ?? 0
    nonces.set(acct.address, nonce + 1)
    return acct.signTransaction({ type: 'eip1559', chainId: CHAIN_ID, nonce, to, data, value, gas, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
  }
  const transfer = (to: Hex, amount: bigint) => encodeFunctionData({ abi: AssetToken.abi, functionName: 'transfer', args: [to, amount] })
  const tx = () => {
    const s = seq++
    if (s % 2 === 0) return sign(SENDERS[1 + (s % 3)]!, pool[(s * 7) % pool.length], '0x', BigInt(s + 1), 21_000n)
    const h = HOLDERS[s % HOLDERS.length]!.address
    const amount = BigInt(s) * 10n ** 18n
    balances.set(h, balances.get(h)! + amount)
    return sign(SENDERS[0]!, TOKEN, transfer(h, amount))
  }
  return {
    balances,
    timestamp: (i: number) => T0 + i,
    async genesis(): Promise<SerializedState> {
      const node = await createNode({
        chainId: CHAIN_ID,
        computeStateRoot: true,
        miningConfig: { type: 'manual' },
        genesisTimestamp: BigInt(T0),
        initialState: Object.fromEntries(SENDERS.map((s) => [s.address.toLowerCase(), { balance: 10n ** 24n }])),
        engine: await createRevmEngine({ wasm }),
      })
      const dump = await node.dumpState()
      await node.dispose()
      return dump
    },
    /** Txs for block `i` (1-based); call once per block, in order (it advances nonces). */
    async nextBlock(i: number): Promise<Hex[]> {
      if (i === 1) {
        const args = encodeAbiParameters(
          [{ type: 'string' }, { type: 'string' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'address' }],
          ['Asset', 'AST', 18, 10n ** 30n, SENDERS[0]!.address],
        )
        return [await sign(SENDERS[0]!, undefined, (AssetToken.bytecode + args.slice(2)) as Hex, 0n, 3_000_000n)]
      }
      const txs = await Promise.all(Array.from({ length: i % 7 === 0 ? 20 : 1 + (i % 3) }, tx))
      if (i % 10 === 0) {
        const [h, bal] = [...balances].reduce((a, b) => (b[1] > a[1] ? b : a))
        balances.set(h, 0n)
        txs.push(await sign(HOLDERS.find((x) => x.address === h)!, TOKEN, transfer(SENDERS[0]!.address, bal)))
      }
      return txs
    },
  }
}
