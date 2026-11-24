// Cost spike: per-block node cost (full snapshot vs state diff), per-device payloads, join cost at 100/1k/10k blocks.
//   bun spike/cf-chain/cost.ts [maxBlocks=10000]      results -> docs/spikes/cf-cost.md
// Mixed workload, deterministic: ETH transfer / ERC-20 transfer / Notice.post (title + 3 lines), round-robin over 3 senders.
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { encodeAbiParameters, encodeFunctionData, keccak256, toHex, recoverTransactionAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { MintableToken } from '../../packages/contracts/index'
import NOTICE from './src/Notice.json'
import { accessView, applyBlock, makeChain, type BlockRecord, type Genesis } from './src/chain'

const wasm = readFileSync(require.resolve('revm-wasm/revm.wasm'))
const MAX = Number(process.argv[2] ?? 10_000)
const KEYS = ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3e9ff4f6ab0f4d7f'] as const
const [A, B, C] = KEYS.map((k) => privateKeyToAccount(k))
const senders = [A!, B!, C!]
const T0 = 1_700_000_000
const G: Genesis = { chainId: 777, timestamp: T0, alloc: Object.fromEntries(senders.map((s) => [s.address, String(10n ** 24n)])), access: { admin: A!.address, writers: senders.map((s) => s.address) } }
const pool = Array.from({ length: 200 }, (_, i) => `0x${keccak256(toHex(i)).slice(26)}` as Hex) // recipients
const nonce = [0, 0, 0]
let seq = 0, ts = T0
const sign = (i: number, to: Hex | undefined, data: Hex = '0x', value = 0n, gas = 300_000n) =>
  senders[i]!.signTransaction({ type: 'eip1559', chainId: 777, nonce: nonce[i]!++, to, data, value, gas, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n })

const c = await makeChain(G, wasm)
const all: BlockRecord[] = [] // the DO's blocks table
const block = async (txs: Hex[]) => { const b = await applyBlock(c, ++ts, txs); all.push(b); return b }
// setup: deploy token (A), mint to everyone, deploy Notice (A)
const deployData = (art: { bytecode: string }, args: string) => (art.bytecode + args) as Hex
await block([await sign(0, undefined, deployData(MintableToken, encodeAbiParameters([{ type: 'string' }, { type: 'string' }], ['Tok', 'TOK']).slice(2)), 0n, 3_000_000n)])
const TOKEN = (all[0]!.receipts[0] as any).contractAddress as Hex
await block(await Promise.all(senders.map((s) => sign(0, TOKEN, encodeFunctionData({ abi: MintableToken.abi, functionName: 'mint', args: [s.address, 10n ** 30n] })))))
await block([await sign(0, undefined, deployData(NOTICE, encodeAbiParameters([{ type: 'string' }], ['notes']).slice(2)), 0n, 3_000_000n)])
const NOTICE_ADDR = (all[2]!.receipts[0] as any).contractAddress as Hex

const nextTx = () => {
  const k = seq++ % 3, s = seq % 3, to = pool[(seq * 7919) % pool.length]!
  if (k === 0) return sign(s, to, '0x', 1n, 21_000n)
  if (k === 1) return sign(s, TOKEN, encodeFunctionData({ abi: MintableToken.abi, functionName: 'transfer', args: [to, BigInt(seq)] }))
  return sign(0, NOTICE_ADDR, encodeFunctionData({ abi: NOTICE.abi, functionName: 'post', args: [`rev ${seq}`, [`line a ${seq}`, `line b ${seq}`, `line c ${seq}`]] }))
}

// ---- storage emulation: the worker's tables in bun:sqlite (rows/bytes are what count; timings are Bun's, not workerd's) ----
const db = new Database(`${process.env.TMPDIR ?? '/tmp'}/cf-cost-${process.pid}.sqlite`)
db.exec(`CREATE TABLE blocks(number INTEGER PRIMARY KEY, hash TEXT, parent_hash TEXT, timestamp INTEGER, state_root TEXT, proposer TEXT, txs TEXT, receipts TEXT, snapshot_bytes INTEGER);
  CREATE TABLE snapshot(i INTEGER PRIMARY KEY, data TEXT);
  CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT);`) // kv = design (b): one row per account / code / slot
const CHUNK = 1_000_000
const blockRow = (b: BlockRecord) => [b.number, b.hash, b.parentHash, b.timestamp, b.stateRoot, A!.address, JSON.stringify(b.txs), JSON.stringify(b.receipts, (_, x) => typeof x === 'bigint' ? x.toString() : x)] as const
const flat = (d: any) => { // state only, as key -> value
  const m = new Map<string, string>()
  for (const [a, v] of Object.entries(d.accounts)) m.set(`a:${a}`, v as string)
  for (const [a, v] of Object.entries(d.code)) m.set(`c:${a}`, v as string)
  for (const [a, s] of Object.entries(d.storage)) for (const [k, v] of Object.entries(s as object)) m.set(`s:${a}:${k}`, v as string)
  return m
}
const insBlock = db.prepare('INSERT INTO blocks VALUES (?,?,?,?,?,?,?,?,?)')
const insChunk = db.prepare('INSERT INTO snapshot VALUES (?,?)')
const upsert = db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')
const delKv = db.prepare('DELETE FROM kv WHERE k=?')
for (const b of all) insBlock.run(...blockRow(b), 0)
let prev = flat(await c.node.dumpState())
db.transaction(() => { for (const [k, v] of prev) upsert.run(k, v) })()

/** One submit, worker-style: admission (ecrecover + canWrite per tx), execute, then persist both ways. */
async function measuredSubmit(n: number) {
  const txs = await Promise.all(Array.from({ length: n }, nextTx))
  const t0 = performance.now()
  for (const raw of txs) await accessView(c.node, 'canWrite', [await recoverTransactionAddress({ serializedTransaction: raw as any })])
  const t1 = performance.now()
  const b = await block(txs)
  const t2 = performance.now()
  const dump = await c.node.dumpState(); const snap = JSON.stringify(dump)
  const t3 = performance.now()
  const row = blockRow(b)
  const oldChunks = (db.query('SELECT count(*) n FROM snapshot').get() as any).n as number
  db.transaction(() => { insBlock.run(...row, snap.length); db.exec('DELETE FROM snapshot'); for (let i = 0; i * CHUNK < snap.length; i++) insChunk.run(i, snap.slice(i * CHUNK, (i + 1) * CHUNK)) })()
  const t4 = performance.now()
  const next = flat(dump), changed: [string, string | null][] = []
  for (const [k, v] of next) if (prev.get(k) !== v) changed.push([k, v])
  for (const k of prev.keys()) if (!next.has(k)) changed.push([k, null])
  prev = next
  const t5 = performance.now()
  db.prepare('DELETE FROM blocks WHERE number=?').run(b.number) // re-insert for design (b) timing
  db.transaction(() => { insBlock.run(...row, 0); for (const [k, v] of changed) v === null ? delKv.run(k) : upsert.run(k, v) })()
  const t6 = performance.now()
  const blockBytes = row.slice(1).reduce<number>((s, x) => s + String(x).length, 0)
  const diffBytes = changed.reduce((s, [k, v]) => s + k.length + (v?.length ?? 0), 0)
  return { b, n, admitMs: t1 - t0, execMs: t2 - t1, dumpMs: t3 - t2, fullWriteMs: t4 - t3, diffWriteMs: t6 - t5,
    snapBytes: snap.length, fullRows: 1 + oldChunks + Math.ceil(snap.length / CHUNK), blockBytes, diffRows: 1 + changed.length, diffBytes,
    keys: { acc: changed.filter(([k]) => k[0] === 'a').length, slots: changed.filter(([k]) => k[0] === 's').length } }
}
const avg = (rs: any[], k: string) => rs.reduce((s, r) => s + r[k], 0) / rs.length
const fmt = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(2))
const gz = (s: string) => Bun.gzipSync(Buffer.from(s)).length
const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`

/** Device payloads for one block: the WS notification and the GET /blocks?after=N response body. */
function devicePayload(b: BlockRecord) {
  const ws = JSON.stringify({ type: 'head', number: b.number, hash: b.hash })
  const [number, hash, parentHash, timestamp, stateRoot, proposer, txs, receipts] = blockRow(b)
  const body = JSON.stringify([{ number, hash, parentHash, timestamp, stateRoot, proposer, txs: JSON.parse(txs), receipts: JSON.parse(receipts), snapshotBytes: 0 }])
  return { ws: ws.length, body: body.length, bodyGz: gz(body), txsOnly: JSON.stringify(b.txs).length }
}

async function join(N: number) {
  const out: Record<string, string> = { blocks: String(N) }
  // (a) replay every block (what Replica.sync downloads: block rows with receipts)
  const pages = all.slice(0, N); const wire = JSON.stringify(pages, (_, x) => typeof x === 'bigint' ? x.toString() : x)
  let t = performance.now(); const r = await makeChain(G, wasm)
  for (const b of pages) await applyBlock(r, b.timestamp, b.txs)
  const ok = (await r.node.getStateRoot()) === pages.at(-1)!.stateRoot
  const slim = JSON.stringify(pages.map((b) => ({ n: b.number, h: b.hash, t: b.timestamp, r: b.stateRoot, txs: b.txs })))
  out.replayTxsOnly = `${kb(slim.length)} (gz ${kb(gz(slim))})`
  out.replay = `${kb(wire.length)} (gz ${kb(gz(wire))}), ${fmt(performance.now() - t)} ms, root ${ok ? 'ok' : 'MISMATCH'}`
  const full = await c.node.dumpState()
  // (b) state-only: accounts/code/storage + last 256 headers (BLOCKHASH window), no receipts/txs
  const lite = JSON.stringify({ ...full, blocks: full.blocks.slice(-256), receipts: {}, transactions: {} })
  t = performance.now(); const s = await makeChain(G, wasm); await s.node.loadState(JSON.parse(lite))
  const sOk = (await s.node.getStateRoot()) === all.at(-1)!.stateRoot
  const bare = JSON.stringify({ accounts: full.accounts, code: full.code, storage: full.storage })
  out.stateNoHeaders = `${kb(bare.length)} (gz ${kb(gz(bare))}), code ${kb(JSON.stringify(full.code).length)}`
  out.stateOnly = `${kb(lite.length)} (gz ${kb(gz(lite))}), ${fmt(performance.now() - t)} ms, root ${sOk ? 'ok' : 'MISMATCH'}`
  // (c) the current full dump
  const fs = JSON.stringify(full)
  t = performance.now(); const f = await makeChain(G, wasm); await f.node.loadState(JSON.parse(fs))
  out.fullDump = `${kb(fs.length)} (gz ${kb(gz(fs))}), ${fmt(performance.now() - t)} ms`
  // does the state-only joiner then build the same next block?
  const txs = [await nextTx()]; const mine = await block(txs); const theirs = await applyBlock(s, mine.timestamp, txs)
  out.nextBlockSame = String(theirs.hash === mine.hash && theirs.stateRoot === mine.stateRoot)
  return out
}

const checkpoints = [100, 1000, 10_000].filter((n) => n <= MAX)
for (const cp of checkpoints) {
  while (all.length < cp - 10) await block([await nextTx()])
  prev = flat(await c.node.dumpState()) // diff baseline = state just before the measured blocks
  const one = []; for (let i = 0; i < 5; i++) one.push(await measuredSubmit(1))
  const twenty = []; for (let i = 0; i < 5; i++) twenty.push(await measuredSubmit(20))
  for (const [label, rs] of [['1-tx', one], ['20-tx', twenty]] as const) {
    const row: Record<string, string> = { height: String(all.length), block: label }
    for (const k of ['admitMs', 'execMs', 'dumpMs', 'fullWriteMs', 'diffWriteMs', 'snapBytes', 'fullRows', 'blockBytes', 'diffRows', 'diffBytes']) row[k] = fmt(avg(rs, k))
    row.changedAccSlots = `${fmt(avg(rs.map((r) => r.keys), 'acc'))}/${fmt(avg(rs.map((r) => r.keys), 'slots'))}`
    const dp = rs.map((r) => devicePayload(r.b))
    row.wsBytes = fmt(avg(dp, 'ws')); row.getBody = fmt(avg(dp, 'body')); row.getBodyGz = fmt(avg(dp, 'bodyGz')); row.txsOnly = fmt(avg(dp, 'txsOnly'))
    console.log(JSON.stringify(row))
  }
  const j = await join(all.length); console.log(JSON.stringify(j))
}
const st = flat(await c.node.dumpState())
console.log(JSON.stringify({ final: all.length, stateKeys: st.size, mem: `${(process.memoryUsage().rss / 2 ** 20).toFixed(0)}MB rss` }))
