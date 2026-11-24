// Submit throughput: batches of 1/10/100 ERC-20 transfers, 20 rounds each (t-132).
//   bun packages/node/scripts/throughput.ts               in-process (router over bun:sqlite, served on a local port)
//   bun packages/node/scripts/throughput.ts --url <worker>  against a worker; root admin key from .env.local
// Senders: 10 fresh keys, each owns a MintableToken and is a writer (the admin signs every request, as the ChainService checks both today).
import { join } from 'node:path'
import { encodeDeployData, encodeFunctionData, type Hex, type LocalAccount } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ChainAccess, MintableToken } from '@evmb/contracts'
import { NodeClient, claimTx, inviteTx, setupTxs } from '../src/client'
import { ChainHost, handle, type ChainHandleLike } from '../src/router'
import { bunSql } from '../test/bunSql'
import { ensureKey, freshDump, wasm } from './bootstrap'

const SENDERS = 10, ROUNDS = 20, SIZES = [1, 10, 100]
const urlArg = process.argv.indexOf('--url') > 0 ? process.argv[process.argv.indexOf('--url') + 1]! : null
const tx = (a: LocalAccount, nonce: number, to: Hex | undefined, data: Hex, gas = 300_000n) =>
  a.signTransaction({ type: 'eip1559', chainId: 31337, nonce, to, data, gas, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!

let srv: ReturnType<typeof Bun.serve> | undefined, base: string, admin: LocalAccount
if (urlArg) {
  base = urlArg
  admin = privateKeyToAccount(ensureKey(join(import.meta.dir, '../../../.env.local')).key)
} else {
  admin = privateKeyToAccount(generatePrivateKey())
  const hosts = new Map<string, ChainHost>()
  const chain = (id: string): ChainHandleLike => {
    let h = hosts.get(id)
    if (!h) hosts.set(id, (h = new ChainHost(bunSql(), wasm, { rootAdmin: admin.address, chain })))
    return h
  }
  srv = Bun.serve({ port: 0, fetch: (r) => handle(r, { chain }) })
  base = `http://localhost:${srv.port}`
}
const c = new NodeClient(base, admin)

try {
  let { root } = await c.health()
  if (!root) {
    await c.createChain({ dump: await freshDump(), setup: await setupTxs(admin, 0, 31337) })
    root = (await c.health()).root!
  }
  const code = `tp-${crypto.randomUUID()}`
  await c.submit('root', [await inviteTx(admin, await c.nonce('root'), root.access, code, 600, 1)])
  const { chainId: cid } = await c.createChain({
    dump: await freshDump(), setup: await setupTxs(admin, 0, 31337), claim: await claimTx(admin, await c.nonce('root'), code, root.access),
  })
  const access = (await c.info(cid)).access
  const senders = Array.from({ length: SENDERS }, () => privateKeyToAccount(generatePrivateKey()))
  let an = await c.nonce(cid)
  await c.submit(cid, await Promise.all(senders.map((s) => tx(admin, an++, access, encodeFunctionData({ abi: ChainAccess.abi, functionName: 'addWriter', args: [s.address] })))))
  // each sender deploys its own token and mints itself a pile (nonces 0, 1); transfers start at nonce 2
  const tokens: Hex[] = []
  const nonce = senders.map(() => 2)
  const head = await Promise.all(senders.map(async (s) => tx(s, 0, undefined, encodeDeployData({ abi: MintableToken.abi, bytecode: MintableToken.bytecode, args: ['T', 'T'] }), 3_000_000n)))
  for (const h of head) await c.submit(cid, [h]) // a deploy is ~10 KB hex; the submit cap is 64 KiB today
  const { getContractAddress } = await import('viem')
  for (const s of senders) tokens.push(getContractAddress({ from: s.address, nonce: 0n }))
  await c.submit(cid, await Promise.all(senders.map((s, i) => tx(s, 1, tokens[i], encodeFunctionData({ abi: MintableToken.abi, functionName: 'mint', args: [s.address, 10n ** 24n] })))))
  const sink = privateKeyToAccount(generatePrivateKey()).address

  const first = (await c.state(cid)).head.number
  const rows: string[] = []
  for (const size of SIZES) {
    const lat: number[] = []
    let t0 = 0, total = 0
    for (let r = 0; r < ROUNDS; r++) {
      const txs = await Promise.all(Array.from({ length: size }, (_, k) => {
        const i = (r * size + k) % SENDERS
        return tx(senders[i]!, nonce[i]!++, tokens[i], encodeFunctionData({ abi: MintableToken.abi, functionName: 'transfer', args: [sink, 1n] }))
      }))
      const t = performance.now()
      if (!t0) t0 = t
      await c.submit(cid, txs)
      lat.push(performance.now() - t)
      total += size
    }
    const wall = lat.reduce((a, b) => a + b, 0) / 1000
    rows.push(`| ${size} | ${total} | ${(total / wall).toFixed(1)} | ${pct(lat, 0.5).toFixed(0)} | ${pct(lat, 0.95).toFixed(0)} | ${(lat.reduce((a, b) => a + b, 0) / lat.length / size).toFixed(1)} |`)
  }
  // every receipt after setup must be status 1 (a revert is mined and cheaper, which would inflate txs/s)
  const rec = (await c.blocks(cid, first)).blocks.flatMap((b) => b.receipts)
  const bad = rec.filter((r) => Number(r.status) !== 1).length
  if (rec.length !== SIZES.reduce((a, n) => a + n * ROUNDS, 0) || bad) throw new Error(`${bad} of ${rec.length} measured receipts have status 0`)
  console.log(`receipts: ${rec.length} measured, all status 1`)
  console.log(`target: ${urlArg ?? 'in-process'}; ${SENDERS} senders, ${ROUNDS} rounds per size`)
  console.log('| batch | txs | txs/s | p50 ms | p95 ms | ms/tx |\n|---|---|---|---|---|---|\n' + rows.join('\n'))
} finally {
  srv?.stop(true)
}
process.exit(0)
