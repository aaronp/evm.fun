// 10,000-block chain-store soak (t-129): `make soak-node`. Exits non-zero on a root/hash mismatch,
// JS heap + external (wasm memory) >= 128 MB, or per-block commit time growing > 2x from blocks 1,000-2,000 to the last 1,000.
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChainNode, ChainStore } from './src'
import { bunSql } from './test/bunSql'
import { wasm, workload } from './test/workload'

const BLOCKS = 10_000
const BOOT_AT = [2500, 5000, 10_000]
const cfg = { wasm, rebuildEvery: 1000 }
const dir = mkdtempSync(join(tmpdir(), 'soak-'))
const db = new Database(join(dir, 'chain.db'))
const sql = bunSql(db)
// Counts what one commit writes by wrapping store.commit: rows = diff keys + 1 block row; bytes = JSON length of diff + block; ms = the SQL commit only.
const store = new ChainStore(sql)
const w = workload()
let failures: string[] = []
try {
  const live = await ChainNode.create(store, await w.genesis(), cfg)

  // finalizers of disposed nodes (wasm instances) run after a tick, so collect, yield, collect before reading the heap
  const settle = async () => (Bun.gc(true), await Bun.sleep(50), Bun.gc(true))
  const MB = 1048576
  const heapMB = () => process.memoryUsage().heapUsed / MB
  // a DO's 128 MB covers wasm linear memory and buffers too: heapUsed + external
  const memMB = () => ((m) => (m.heapUsed + m.external) / MB)(process.memoryUsage())
  failures = []
  const commitMs: number[] = []
  let peak = 0
  let rows = 0
  let bytes = 0
  let ms = 0
  const origCommit = store.commit.bind(store)
  store.commit = (block, diff) => {
    const t = performance.now()
    origCommit(block, diff)
    ms += performance.now() - t
    rows += 1 + Object.keys(diff.accounts).length + Object.keys(diff.code).length + Object.values(diff.storage).reduce((n, s) => n + Object.keys(s).length, 0)
    bytes += JSON.stringify(diff).length + JSON.stringify(block).length
  }

  for (let i = 1; i <= BLOCKS; i++) {
    const txs = await w.nextBlock(i)
    let bootNext
    if (BOOT_AT.includes(i - 1)) {
      // boot from a copy of the store; the live run is unaffected
      const booted = await ChainNode.boot(new ChainStore(bunSql(Database.deserialize(db.serialize()))), cfg)
      const [a, b] = [await live.stateRoot(), await booted.stateRoot()]
      if (a !== b) failures.push(`height ${i - 1}: boot root ${b} != live ${a}`)
      bootNext = (await booted.apply(w.timestamp(i), txs)).header
      await booted.dispose() // a booted node left alive keeps its wasm heap
    }
    const blk = await live.apply(w.timestamp(i), txs)
    if (bootNext && (bootNext.hash !== blk.header.hash || bootNext.stateRoot !== blk.header.stateRoot))
      failures.push(`height ${i}: boot next block ${bootNext.hash} != live ${blk.header.hash}`)
    if (i % 1000 === 0) {
      await settle()
      const avg = ms / 1000
      commitMs.push(avg)
      peak = Math.max(peak, memMB())
      console.log(JSON.stringify({ height: i, commitMsAvg: +avg.toFixed(3), rowsWrittenAvg: +(rows / 1000).toFixed(1), bytesWrittenAvg: Math.round(bytes / 1000), heapMB: +heapMB().toFixed(1), memMB: +memMB().toFixed(1) }))
      ;[rows, bytes, ms] = [0, 0, 0]
    }
  }
  // the loop boots before blocks 2501 and 5001; the 10,000 check needs a block 10,001, so it runs here
  {
    const booted = await ChainNode.boot(new ChainStore(bunSql(Database.deserialize(db.serialize()))), cfg)
    const [a, b] = [await live.stateRoot(), await booted.stateRoot()]
    if (a !== b) failures.push(`height ${BLOCKS}: boot root ${b} != live ${a}`)
    const txs = await w.nextBlock(BLOCKS + 1)
    const [x, y] = [await booted.apply(w.timestamp(BLOCKS + 1), txs), await live.apply(w.timestamp(BLOCKS + 1), txs)]
    await booted.dispose()
    if (x.header.hash !== y.header.hash) failures.push(`height ${BLOCKS + 1}: boot next block ${x.header.hash} != live ${y.header.hash}`)
  }
  await settle()
  const mem = Math.max(peak, memMB())
  if (mem >= 128) failures.push(`mem (heap + external) ${mem.toFixed(1)} MB >= 128`)
  if (commitMs[9]! > 2 * commitMs[1]!) failures.push(`commitMsAvg ${commitMs[9]} (last 1,000) > 2x ${commitMs[1]} (blocks 1,000-2,000)`)
  console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'OK: roots and next blocks match at 2500, 5000, 10000; memory and commit time flat')
} finally {
  db.close()
  rmSync(dir, { recursive: true, force: true })
}
process.exit(failures.length ? 1 : 0)
