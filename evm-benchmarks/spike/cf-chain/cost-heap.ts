// bun spike/cf-chain/cost-heap.ts
// JS heap held by one node as the chain grows (1-tx ETH transfers); then a fresh node loaded from a state-only vs a full dump.
const S = import.meta.dir
const { applyBlock, makeChain } = await import(`${S}/src/chain.ts`)
const { privateKeyToAccount } = await import("viem/accounts")
const { readFileSync } = await import('node:fs')
const wasm = readFileSync(require.resolve("revm-wasm/revm.wasm"))
const A = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const c = await makeChain({ chainId: 777, timestamp: 1_700_000_000, alloc: { [A.address]: String(10n ** 21n) } }, wasm)
const heap = () => { Bun.gc(true); return process.memoryUsage().heapUsed / 2 ** 20 }
const h0 = heap()
for (let n = 1; n <= 10000; n++) {
  await applyBlock(c, 1_700_000_000 + n, [await A.signTransaction({ type: 'eip1559', chainId: 777, nonce: n - 1, to: `0x${(n % 200).toString(16).padStart(40, '0')}`, value: 1n, gas: 21000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n })])
  if (n % 2500 === 0) { console.log(JSON.stringify({ blocks: n, nodeHeapMB: +(heap() - h0).toFixed(1) })) }
}
const full = await c.node.dumpState()
const lite = JSON.stringify({ ...full, blocks: full.blocks.slice(-256), receipts: {}, transactions: {} })
const fullS = JSON.stringify(full)
for (const [name, s] of [['stateOnly', lite], ['fullDump', fullS]] as const) {
  const b = heap(); const x = await makeChain({ chainId: 777, timestamp: 1_700_000_000, alloc: { [A.address]: String(10n ** 21n) } }, wasm); await x.node.loadState(JSON.parse(s))
  console.log(JSON.stringify({ freshNodeLoaded: name, heapMB: +(heap() - b).toFixed(1), root: (await x.node.getStateRoot()) === (await c.node.getStateRoot()) }))
  ;(globalThis as any)[name] = x
}
