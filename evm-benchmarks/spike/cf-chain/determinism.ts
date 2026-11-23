// What breaks replay determinism? Same genesis + same signed tx, vary one input, compare root/hash.
//   bun spike/cf-chain/determinism.ts
import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { applyBlock, makeChain, type Genesis } from './src/chain'

const wasm = readFileSync(require.resolve('revm-wasm/revm.wasm'))
const A = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const g: Genesis = { chainId: 777, timestamp: 1_700_000_000, alloc: { [A.address]: String(10n ** 21n) } }
// runtime: SSTORE(0, TIMESTAMP); a contract that reads the block env
const STAMP = '0x6007600c60003960076000f3' + '4260005500' + '0000'
const tx = (nonce: number, to: `0x${string}` | null, data: `0x${string}` = '0x') => A.signTransaction({ type: 'eip1559', chainId: 777, nonce, to, data, gas: 200_000n, maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n })

async function run(genesis: Genesis, ts: number, sleepMs = 0) {
  if (sleepMs) await Bun.sleep(sleepMs)
  const c = await makeChain(genesis, wasm)
  const b1 = await applyBlock(c, ts, [await tx(0, '0x000000000000000000000000000000000000dead')]) // plain transfer
  const b2 = await applyBlock(c, ts + 1, [await tx(1, null, STAMP as any)])
  const contract = (b2.receipts[0] as any).contractAddress
  const b3 = await applyBlock(c, ts + 2, [await tx(2, contract)])
  return { b1, b3 }
}
const base = await run(g, g.timestamp + 10)
const same = await run(g, g.timestamp + 10, 1100) // a second later on the wall clock
const ts = await run(g, g.timestamp + 11)
const gen = await run({ ...g, timestamp: g.timestamp + 1 }, g.timestamp + 10)
const cmp = (n: string, x: typeof base) => console.log(`${n.padEnd(40)} transfer-block: root ${x.b1.stateRoot === base.b1.stateRoot ? 'same' : 'DIFF'} hash ${x.b1.hash === base.b1.hash ? 'same' : 'DIFF'} | TIMESTAMP-reading block: root ${x.b3.stateRoot === base.b3.stateRoot ? 'same' : 'DIFF'} hash ${x.b3.hash === base.b3.hash ? 'same' : 'DIFF'}`)
cmp('pinned inputs, rerun 1.1 s later', same)
cmp('block timestamp +1 s', ts)
cmp('genesis timestamp +1 s', gen)
