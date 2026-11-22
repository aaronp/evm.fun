// End-to-end demo: wrangler dev (local workerd) + two device replicas + an outsider.
//   bun spike/cf-chain/demo.ts
// Starts wrangler dev twice against the same --persist-to dir to prove restart persistence.
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'
import { Device, Replica } from './src/replica'
import { ACCESS, accessCall } from './src/chain'

const DIR = import.meta.dir
const PORT = 8799
const BASE = `http://127.0.0.1:${PORT}`
const PERSIST = join(DIR, '.wrangler/demo-state')
const WASM = readFileSync(require.resolve('revm-wasm/revm.wasm'))

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures++ }

import { startWrangler as start, stopWrangler } from './dev'
const startWrangler = () => start(DIR, PORT, PERSIST)
const stop = (p: Bun.Subprocess) => stopWrangler(p, PORT)

// anvil keys 0,1,2
const A = new Device(BASE, privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'))
const B = new Device(BASE, privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'))
const X = new Device(BASE, privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'))

// counter: runtime SSTORE(0, SLOAD(0)+1)
const COUNTER_INIT = '0x600a600c600039600a6000f3' + '600054600101600055' + '00'
async function tx(r: Replica, dev: Device, to: Hex | null, data: Hex = '0x', value = 0n) {
  const nonce = Number(await r.request('eth_getTransactionCount', [dev.account.address, 'latest']))
  return dev.account.signTransaction!({
    type: 'eip1559', chainId: 777, nonce, to, value, data, gas: 200_000n, maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
  }) as Promise<Hex>
}
let pendingNonce = 0 // A's next nonce when batching several txs into one block
async function txN(dev: Device, to: Hex | null, data: Hex = '0x', value = 0n) {
  return dev.account.signTransaction!({
    type: 'eip1559', chainId: 777, nonce: pendingNonce++, to, value, data, gas: 200_000n, maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
  }) as Promise<Hex>
}

rmSync(PERSIST, { recursive: true, force: true })
let wr = await startWrangler()
try {
  // ---- create + membership ----
  const genesis = { chainId: 777, timestamp: Math.floor(Date.now() / 1000), alloc: { [A.address]: String(10n ** 21n), [B.address]: String(10n ** 21n) } }
  const created = await A.createChain(genesis)
  check(created.status === 201, `A creates chain -> ${created.status} ${created.data.chainId}`)
  const id = created.data.chainId
  check((await B.call('GET', `/chains/${id}`)).status === 403, 'B (not yet approved) refused with 403')
  // membership is the on-chain ChainAccess contract now: approve = an addWriter tx from the admin
  const head0 = (await A.call('GET', `/chains/${id}/head`)).data.hash
  pendingNonce = 0
  const selfAdd = await B.call('POST', `/chains/${id}/submit`, { expectedHead: head0, txs: [await B.account.signTransaction!({ type: 'eip1559', chainId: 777, nonce: 0, to: ACCESS, data: accessCall('addWriter', [B.address]), gas: 200_000n, maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n })] })
  check(selfAdd.status === 403, `B cannot add itself (not a writer) -> ${selfAdd.status} ${selfAdd.data.error}`)
  check((await A.call('POST', `/chains/${id}/submit`, { expectedHead: head0, txs: [await txN(A, ACCESS, accessCall('addWriter', [B.address]))] })).status === 200, 'A (admin) approves B with an addWriter tx')
  const unsigned = await fetch(`${BASE}/chains/${id}`)
  check(unsigned.status === 401, `unsigned request refused with ${unsigned.status}`)

  // ---- replicas ----
  const rA = await Replica.open(A, id, WASM)
  const rB = await Replica.open(B, id, WASM)
  await rA.sync(); await rB.sync()
  let bHeads = 0
  const ws = await rB.subscribe(() => bHeads++)

  // block 2: deploy counter + transfer to B (2 txs)
  const r1 = await rA.submit([await txN(A, null, COUNTER_INIT as Hex), await txN(A, B.account.address, '0x', 10n ** 18n)])
  check(r1.status === 200, `A submits block 2 (deploy + transfer) -> ${r1.status}`)
  const counter = (r1.data.block.receipts[0] as any).contractAddress as Hex
  // blocks 2..21: one counter increment each, for timings
  const timings: any[] = [r1.data.timings]
  for (let i = 0; i < 20; i++) {
    const r = await rA.submit([await txN(A, counter)])
    if (r.status !== 200) { check(false, `block ${i + 2}: ${r.status} ${JSON.stringify(r.data)}`); break }
    timings.push({ ...r.data.timings, localMs: r.localMs })
  }
  // a block with 50 txs
  const big = await rA.submit(await Promise.all(Array.from({ length: 50 }, () => txN(A, counter))))
  check(big.status === 200, `A submits a 50-tx block -> ${big.status}`)
  timings.push({ ...big.data.timings, localMs: big.localMs, txs: 50 })

  for (let i = 0; i < 100 && rB.head.number < rA.head.number; i++) await Bun.sleep(50)
  check(rB.head.number === rA.head.number && rB.head.hash === rA.head.hash, `B followed via subscription to block ${rB.head.number} (${bHeads} notifications)`)
  check(rA.checks.every((c) => c.rootOk && c.hashOk), `A: optimistic local root+hash == DO for ${rA.checks.length} blocks`)
  check(rB.checks.length > 0 && rB.checks.every((c) => c.rootOk && c.hashOk), `B: replayed root+hash == DO for ${rB.checks.length} blocks`)
  const slot = await rB.request('eth_getStorageAt', [counter, '0x0', 'latest'])
  check(BigInt(slot as string) === 70n, `B's local counter storage = ${BigInt(slot as string)} (expect 70)`)

  // ---- stale head ----
  const stale = await B.call('POST', `/chains/${id}/submit`, { expectedHead: (await B.call('GET', `/chains/${id}/blocks?after=0`)).data[0].hash, txs: [await tx(rB, B, A.account.address)] })
  check(stale.status === 409, `B submits on a stale head -> ${stale.status} ${stale.data.error}`)
  const bOk = await rB.submit([await tx(rB, B, A.account.address, '0x', 1n)])
  check(bOk.status === 200, `B submits on current head -> ${bOk.status} block ${bOk.data.block?.number}`)
  await rA.sync()
  check(rA.head.hash === rB.head.hash, 'A syncs B\'s block, heads equal')

  // ---- outsider ----
  check((await X.call('GET', `/chains/${id}`)).status === 403, 'non-member X: GET chain -> 403')
  check((await X.call('GET', `/chains/${id}/blocks?after=0`)).status === 403, 'non-member X: fetch blocks -> 403')
  check((await X.call('POST', `/chains/${id}/submit`, { expectedHead: rA.head.hash, txs: [await X.account.signTransaction!({ type: 'eip1559', chainId: 777, nonce: 0, to: X.account.address, gas: 21_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })] })).status === 403, 'non-member X: submit -> 403')
  let xws = 'open'
  try { const s = await X.socket(id); await new Promise((ok, err) => { s.onopen = () => ok(0); s.onerror = err; s.onclose = err }); } catch { xws = 'refused' }
  check(xws === 'refused', `non-member X: subscribe -> ${xws}`)
  // replayed signed request
  const url = new URL(`/chains/${id}`, BASE)
  const { signRequest } = await import('./src/chain')
  const a = await signRequest(A.account, 'GET', url, '')
  const h = { 'x-ts': a.ts, 'x-nonce': a.nonce, 'x-sig': a.sig }
  const first = await fetch(url, { headers: h }), second = await fetch(url, { headers: h })
  check(first.status === 200 && second.status === 401, `replayed signed request: first ${first.status}, replay ${second.status}`)
  // removal kicks the socket
  const closed = new Promise<number>((ok) => ws.addEventListener('close', (e) => ok(e.code)))
  await rA.submit([await txN(A, ACCESS, accessCall('removeWriter', [B.address]))])
  check((await B.call('GET', `/chains/${id}`)).status === 403 && (await closed) === 4003, 'A removes B (removeWriter tx) -> B refused, B\'s socket closed 4003')
  await rA.submit([await txN(A, ACCESS, accessCall('addWriter', [B.address]))])

  const snapGrowth = (await A.call('GET', `/chains/${id}/blocks?after=-1`)).data.map((b: any) => [b.number, b.snapshotBytes])
  const headBefore = rA.head
  const instanceBefore = (await A.call('GET', `/chains/${id}`)).data.instance

  // ---- restart ----
  await stop(wr)
  wr = await startWrangler()
  let t0 = performance.now()
  const info = await A.call('GET', `/chains/${id}`)
  const coldMs = performance.now() - t0
  t0 = performance.now()
  await A.call('GET', `/chains/${id}`)
  const warmMs = performance.now() - t0
  check(info.data.head.hash === headBefore.hash, `after restart DO head = ${info.data.head.number} ${info.data.head.hash.slice(0, 10)}… (same as before)`)
  check(info.data.engine === 'revm-wasm', `DO node engine = ${info.data.engine}`)
  check(info.data.instance !== instanceBefore, `restart gave a new DO instance (${instanceBefore.slice(0, 8)} -> ${info.data.instance.slice(0, 8)})`)
  const after = await rA.submit([await txN(A, counter)])
  check(after.status === 200 && after.data.block.parentHash === headBefore.hash, `post-restart block ${after.data.block?.number} extends old head`)
  await rB.sync()
  check(rB.head.hash === rA.head.hash && rB.checks.every((c) => c.rootOk && c.hashOk), 'B replays post-restart block, root+hash match')
  const rC = await Replica.open(B, id, WASM) // fresh device replica replaying from genesis
  t0 = performance.now()
  await rC.sync()
  const fullReplayMs = performance.now() - t0
  check(rC.head.hash === rA.head.hash && rC.checks.every((c) => c.rootOk && c.hashOk), `fresh replica replays ${rC.checks.length} blocks from genesis in ${fullReplayMs.toFixed(0)} ms, all match`)
  ws.close()

  console.log('\n--- measurements ---')
  console.log(`DO cold request after restart: ${coldMs.toFixed(1)} ms (DO boot: ${info.data.bootMs.toFixed(1)} ms in-DO), warm: ${warmMs.toFixed(1)} ms`)
  const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!.toFixed(2)
  const single = timings.slice(1, 21)
  console.log(`1-tx blocks (n=${single.length}) median ms: execute ${med(single.map((t) => t.executeMs))}, dump ${med(single.map((t) => t.dumpMs))}, persist ${med(single.map((t) => t.persistMs))}, replica-local ${med(single.map((t) => t.localMs))}`)
  console.log(`50-tx block ms: execute ${big.data.timings.executeMs.toFixed(2)}, dump ${big.data.timings.dumpMs.toFixed(2)}, persist ${big.data.timings.persistMs.toFixed(2)}, replica-local ${big.localMs.toFixed(2)}`)
  console.log(`post-restart block ms: ${JSON.stringify(after.data.timings)}`)
  console.log(`replay ms per block (B, median): ${med(rB.checks.map((c) => c.replayMs))}`)
  console.log(`snapshot bytes by block: ${snapGrowth.filter(([n]: number[]) => n % 5 === 0 || n >= 21).map(([n, s]: number[]) => `${n}:${s}`).join(' ')}`)
} finally {
  await stop(wr)
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
process.exit(failures ? 1 : 0)
