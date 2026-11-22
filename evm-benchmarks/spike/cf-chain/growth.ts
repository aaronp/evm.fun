// Snapshot growth: dumpState carries every block/receipt/tx, so the per-block snapshot is O(chain).  bun spike/cf-chain/growth.ts
import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { applyBlock, makeChain } from './src/chain'
const wasm = readFileSync(require.resolve('revm-wasm/revm.wasm'))
const A = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const c = await makeChain({ chainId: 777, timestamp: 1_700_000_000, alloc: { [A.address]: String(10n ** 21n) } }, wasm)
for (let n = 1; n <= 2000; n++) {
  await applyBlock(c, 1_700_000_000 + n, [await A.signTransaction({ type: 'eip1559', chainId: 777, nonce: n - 1, to: '0x000000000000000000000000000000000000dead', value: 1n, gas: 21000n, maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n })])
  if ([10, 100, 500, 1000, 2000].includes(n)) { const t = performance.now(); const s = JSON.stringify(await c.node.dumpState()); const d = performance.now() - t; const t2 = performance.now(); await c.node.loadState(JSON.parse(s)); console.log(`blocks=${n} snapshot=${(s.length/1024).toFixed(0)}KB dump+stringify=${d.toFixed(1)}ms parse+load=${(performance.now()-t2).toFixed(1)}ms`) }
}
