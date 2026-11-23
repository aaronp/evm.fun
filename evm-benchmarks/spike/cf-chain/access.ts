// On-chain read/write access demo: ChainAccess in genesis, DO enforcing it per request,
// open + bearer-token HTTP reads shown with real curl, join-code claim.
//   bun spike/cf-chain/access.ts
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { encodeDeployData, keccak256, toHex, type Hex, type LocalAccount } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ACCESS, accessCall } from './src/chain'
import { Device, Replica } from './src/replica'
import { startWrangler, stopWrangler } from './dev'

const DIR = import.meta.dir
const PORT = 8798
const BASE = `http://127.0.0.1:${PORT}`
const PERSIST = join(DIR, '.wrangler/access-state')
const TOKEN = JSON.parse(readFileSync(join(DIR, '../../packages/contracts/artifacts/MintableToken.json'), 'utf8'))

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures++ }

const dev = (k: Hex) => new Device(BASE, privateKeyToAccount(k))
const A = dev('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') // creator/admin
const W = dev('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') // writer
const X = dev('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a') // outsider
const R = dev('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6') // reader
const J = dev(generatePrivateKey()) // joiner: fresh key, no balance

const nonces = new Map<string, number>()
const sign = (d: Device, to: Hex | null, data: Hex = '0x') => {
  const nonce = nonces.get(d.address) ?? 0
  nonces.set(d.address, nonce + 1)
  return d.account.signTransaction!({ type: 'eip1559', chainId: 778, nonce, to, data, gas: 3_000_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }) as Promise<Hex>
}
const unsign = (d: Device) => nonces.set(d.address, (nonces.get(d.address) ?? 1) - 1) // refused tx: reuse its nonce
let id = ''
const head = async () => (await A.call('GET', `/chains/${id}/head`)).data.hash as string
const submit = async (signer: Device, txs: Hex[]) => signer.call('POST', `/chains/${id}/submit`, { expectedHead: await head(), txs })
const admin = (fn: string, args: unknown[]) => sign(A, ACCESS, accessCall(fn, args)).then((t) => submit(A, [t]))

/** Run real curl, print the command (token abbreviated) and the response. */
async function curl(path: string, token?: string) {
  const args = ['curl', '-s', '-i', ...(token ? ['-H', `Authorization: Bearer ${token}`] : []), `${BASE}${path}`]
  const out = await new Response(Bun.spawn(args, { stdout: 'pipe' }).stdout).text()
  const [hdr, ...rest] = out.split('\r\n\r\n')
  const status = Number(hdr!.split(' ')[1])
  const timing = hdr!.match(/server-timing: (.*)/i)?.[1]
  const body = rest.join('')
  console.log(`  $ ${args.slice(0, -1).map((a) => (a.startsWith('Authorization') ? `'Authorization: Bearer ${a.slice(22, 30)}…'` : a)).join(' ')} ${args.at(-1)}`)
  console.log(`    -> ${status} ${body.length > 150 ? body.slice(0, 150) + '…' : body}${timing ? `   [server-timing: ${timing}]` : ''}`)
  return { status, body, timing }
}

/** Open a WebSocket subscription; resolves 'open' or 'refused', and exposes the close code. */
async function subscribe(d: Device | null, auth: 'sig' | 'token' = 'token') {
  const ws = d ? await d.socket(id, auth) : new WebSocket(`${BASE.replace('http', 'ws')}/chains/${id}/subscribe`)
  const state = await new Promise<string>((ok) => { ws.onopen = () => ok('open'); ws.onerror = () => ok('refused'); ws.onclose = () => ok('refused') })
  const closed = new Promise<number>((ok) => ws.addEventListener('close', (e) => ok(e.code)))
  return { ws, state, closed }
}
const within = <T>(p: Promise<T>, ms = 2000) => Promise.race([p, Bun.sleep(ms).then(() => 'timeout' as const)])

rmSync(PERSIST, { recursive: true, force: true })
const wr = await startWrangler(DIR, PORT, PERSIST)
try {
  console.log('\n== 1. ChainAccess in genesis ==')
  const genesis = { chainId: 778, timestamp: Math.floor(Date.now() / 1000), alloc: { [A.address]: String(10n ** 21n) } }
  const created = await A.createChain(genesis, { writers: [W.address], readers: [R.address] })
  id = created.data.chainId
  check(created.status === 201 && created.data.head.number === 0, `A creates chain ${id} (head = block 0, contract written into genesis state)`)
  const info = (await A.call('GET', `/chains/${id}`)).data
  check(info.access.address === ACCESS && info.access.admin.toLowerCase() === A.address && info.access.readOpen === false, `ChainAccess at ${ACCESS} in block 0: admin = creator ${A.address.slice(0, 10)}…, readOpen = false`)
  const acl = async (d: Device) => (await A.call('GET', `/chains/${id}/access/${d.address}`)).data
  const [aA, aW, aR, aX] = await Promise.all([A, W, R, X].map(acl))
  check(aA.canRead && aA.canWrite && aW.canRead && aW.canWrite && aR.canRead && !aR.canWrite && !aX.canRead && !aX.canWrite,
    `canRead/canWrite: admin ${+aA.canRead}/${+aA.canWrite}, writer ${+aW.canRead}/${+aW.canWrite}, reader ${+aR.canRead}/${+aR.canWrite}, outsider ${+aX.canRead}/${+aX.canWrite}`)

  console.log('\n== 2. writes: request signer AND each tx sender must be a writer (checked against head state) ==')
  const deploy = await submit(W, [await sign(W, null, encodeDeployData({ abi: TOKEN.abi, bytecode: TOKEN.bytecode, args: ['Spike', 'SPK'] }))])
  const token = (deploy!.data.block.receipts[0] as any).contractAddress as Hex
  check(deploy!.status === 200 && !!token, `writer W deploys an ERC20 -> ${deploy!.status} at ${token}  (admit ${deploy!.data.timings.admitMs} ms)`)
  const { encodeFunctionData } = await import('viem')
  const mint = await submit(W, [await sign(W, token, encodeFunctionData({ abi: TOKEN.abi, functionName: 'mint', args: [W.account.address, 1234n] }))])
  check(mint!.status === 200, `writer W mints 1234 SPK to itself -> ${mint!.status}`)
  let r = await submit(R, [await sign(R, R.account.address)]); unsign(R)
  check(r!.status === 403, `reader R submits its own tx -> ${r!.status} ${r!.data.error}`)
  r = await submit(W, [await sign(X, X.account.address)]); unsign(X)
  check(r!.status === 403 && r!.data.error === 'tx sender not a writer', `writer W relays a tx signed by outsider X -> ${r!.status} ${r!.data.error}`)
  r = await submit(X, [await sign(W, W.account.address)]); unsign(W)
  check(r!.status === 403 && r!.data.error === 'signer not a writer', `outsider X relays a tx signed by writer W -> ${r!.status} ${r!.data.error}`)
  const bearerSubmit = await fetch(`${BASE}/chains/${id}/submit`, { method: 'POST', headers: { authorization: `Bearer ${await W.readToken(id)}` }, body: '{}' })
  check(bearerSubmit.status === 401, `submit with a bearer read token -> ${bearerSubmit.status} (writes need a signed request)`)
  // same block: admin removes W, then W's tx -> admitted (head state); next block W -> refused
  const head1 = await head()
  r = await A.call('POST', `/chains/${id}/submit`, { expectedHead: head1, txs: [await sign(A, ACCESS, accessCall('removeWriter', [W.address])), await sign(W, W.account.address)] })
  check(r.status === 200 && r.data.block.receipts.every((x: any) => x.status === '0x1'), `block with [removeWriter(W), tx from W] -> ${r.status}: W's tx admitted (lists apply from the next block)`)
  r = await submit(W, [await sign(W, W.account.address)]); unsign(W)
  check(r!.status === 403, `next block: W submits -> ${r!.status} ${r!.data.error}`)
  check((await admin('addWriter', [W.address]))!.status === 200, 'admin re-adds W (addWriter tx)')

  console.log('\n== 3. reads over HTTP: restricted (readOpen = false) ==')
  const tR = await R.readToken(id, 60), tX = await X.readToken(id, 60)
  check((await curl(`/chains/${id}/head`)).status === 401, 'no token -> 401')
  const ok = await curl(`/chains/${id}/head`, tR)
  check(ok.status === 200 && JSON.parse(ok.body).number === 4, 'reader R token -> 200 head')
  check((await curl(`/chains/${id}/head`, tX)).status === 403, 'outsider X token (valid signature, not on list) -> 403')
  check((await curl(`/chains/${id}/blocks?after=4`, tR)).status === 200, 'R: GET blocks?after=4 -> 200')
  const bal = await curl(`/chains/${id}/balance/${A.address}`, tR)
  check(bal.status === 200 && JSON.parse(bal.body).wei === String(10n ** 21n), 'R: GET balance/:address -> 200')
  const calld = accessCall('canRead', [R.address])
  const call = await curl(`/chains/${id}/call/${ACCESS}?data=${calld}`, tR)
  check(call.status === 200 && BigInt(JSON.parse(call.body).result) === 1n, 'R: GET call/:contract?data=canRead(R) -> 200, result = true')
  const e20 = await curl(`/chains/${id}/erc20/${token}/balanceOf/${W.address}`, tR)
  check(e20.status === 200 && JSON.parse(e20.body).balance === '1234', 'R: GET erc20/:token/balanceOf/:address -> 200, 1234')
  const short = await R.readToken(id, 1)
  check((await curl(`/chains/${id}/head`, short)).status === 200, 'R token with 1 s TTL, used at once -> 200')
  await Bun.sleep(2100)
  check((await curl(`/chains/${id}/head`, short)).status === 401, 'same token after 2.1 s -> 401 (expired)')
  check((await curl(`/chains/${id}/head`, await R.readToken(id, 3600))).status === 401, 'token with 1 h TTL -> 401 (cap is 300 s)')
  check((await curl(`/chains/${id}/head`, await R.readToken('other-chain'))).status === 401, 'token minted for another chain -> 401')
  const [p, s] = tR.split('.')
  const forged = btoa(JSON.stringify({ ...JSON.parse(atob(p!.replace(/-/g, '+').replace(/_/g, '/'))), address: X.address })).replace(/=+$/, '') + '.' + s
  check((await curl(`/chains/${id}/head`, forged)).status === 401, 'R token with address swapped to X -> 401 (signature mismatch)')

  console.log('\n== 4. subscribe is a read; revoke is a tx and kicks the socket ==')
  const anonWs = await subscribe(null)
  check(anonWs.state === 'refused', `anonymous subscribe while closed -> ${anonWs.state}`)
  const xWs = await subscribe(X)
  check(xWs.state === 'refused', `outsider X subscribe (token) -> ${xWs.state}`)
  const rWs = await subscribe(R)
  check(rWs.state === 'open', `reader R subscribe (?token=) -> ${rWs.state}`)
  const t0 = performance.now()
  check((await admin('removeReader', [R.address]))!.status === 200, 'admin removeReader(R) tx -> 200')
  const code = await within(rWs.closed)
  check(code === 4003, `R's live socket closed with ${code} after the revoking block (${(performance.now() - t0).toFixed(0)} ms after submit)`)
  check((await curl(`/chains/${id}/head`, tR)).status === 403, 'R\'s still-unexpired token after removeReader -> 403')

  console.log('\n== 5. setReadOpen(true): plain unauthenticated GET ==')
  check((await admin('setReadOpen', [true]))!.status === 200, 'admin setReadOpen(true) tx -> 200')
  check((await curl(`/chains/${id}/head`)).status === 200, 'plain GET head -> 200')
  check((await curl(`/chains/${id}/erc20/${token}/balanceOf/${W.address}`)).status === 200, 'plain GET erc20 balanceOf -> 200')
  check((await curl(`/chains/${id}/head`, tX)).status === 200, 'outsider X token while open -> 200 (canRead = readOpen || …)')
  const anon2 = await subscribe(null)
  check(anon2.state === 'open', `anonymous subscribe while open -> ${anon2.state}`)
  r = await submit(X, [await sign(X, X.account.address)]); unsign(X)
  check(r!.status === 403, `open reads do not open writes: X submit -> ${r!.status}`)
  check((await admin('setReadOpen', [false]))!.status === 200, 'admin setReadOpen(false) tx -> 200')
  check((await within(anon2.closed)) === 4003, 'anonymous socket closed 4003 when reads close again')
  check((await curl(`/chains/${id}/head`)).status === 401, 'plain GET head -> 401 again')

  console.log('\n== 6. join code: invite(keccak256(code), ttl) by admin, claim(code) by a fresh key ==')
  const CODE = 'blue-otter-42'
  check((await admin('invite', [keccak256(toHex(CODE)), 120n, 1, 2]))!.status === 200, 'admin invite(hash, 120 s) tx -> 200')
  r = await submit(J, [await sign(J, ACCESS, accessCall('claim', ['wrong-code']))]); unsign(J)
  check(r!.status === 403, `J claim("wrong-code") -> ${r!.status} ${r!.data.error}`)
  r = await submit(J, [await sign(J, ACCESS, accessCall('addWriter', [J.address]))]); unsign(J)
  check(r!.status === 403, `J sends some other tx -> ${r!.status} ${r!.data.error}`)
  r = await submit(J, [await sign(J, ACCESS, accessCall('claim', [CODE]))])
  check(r!.status === 200, `J (no balance, not on any list) claim("${CODE}") -> ${r!.status} ${r!.data.error ?? ''}`)
  check((await acl(J)).canWrite === true, 'J is now a writer')
  r = await submit(J, [await sign(J, J.account.address)])
  check(r!.status === 200, `J submits an ordinary tx -> ${r!.status}`)
  r = await submit(X, [await sign(X, ACCESS, accessCall('claim', [CODE]))]); unsign(X)
  check(r!.status === 403, `X reuses the revealed code -> ${r!.status} (single use)`)
  check((await admin('invite', [keccak256(toHex('short')), 1n, 1, 2]))!.status === 200, 'admin invite("short", 1 s)')
  await Bun.sleep(2100)
  r = await submit(X, [await sign(X, ACCESS, accessCall('claim', ['short']))]); unsign(X)
  check(r!.status === 403, `X claims "short" after 2.1 s -> ${r!.status} (expired)`)
  const rep = await Replica.open(A, id, readFileSync(Bun.resolveSync('revm-wasm/revm.wasm', DIR)))
  await rep.sync()
  check(rep.head.hash === (await head()) && rep.checks.every((c) => c.rootOk && c.hashOk),
    `fresh replica (genesis incl. ChainAccess) replays ${rep.checks.length} blocks, root+hash all match the DO (refused blocks left no trace)`)

  console.log('\n== 7. cost ==')
  const tA = await A.readToken(id, 60)
  const bench = JSON.parse((await curl(`/chains/${id}/bench?n=2000&token=${tA}`, tA)).body)
  console.log(`in-DO averages over n=${bench.n}: canRead eth_call ${(bench.canReadMs * 1000).toFixed(1)} µs, canWrite eth_call ${(bench.canWriteMs * 1000).toFixed(1)} µs, token verify (ecrecover) ${(bench.tokenVerifyMs * 1000).toFixed(0)} µs`)
  const rt = async (f: () => Promise<unknown>, n = 50) => { const t0 = performance.now(); for (let i = 0; i < n; i++) await f(); return ((performance.now() - t0) / n).toFixed(2) }
  console.log(`client round trip GET head, mean of 50: plain(open=false -> 401) ${await rt(() => fetch(`${BASE}/chains/${id}/head`).then((r) => r.text()))} ms, bearer ${await rt(() => fetch(`${BASE}/chains/${id}/head`, { headers: { authorization: `Bearer ${tA}` } }).then((r) => r.text()))} ms, signed ${await rt(() => A.call('GET', `/chains/${id}/head`))} ms`)
  await admin('setReadOpen', [true])
  console.log(`client round trip GET head (open), mean of 50: plain ${await rt(() => fetch(`${BASE}/chains/${id}/head`).then((r) => r.text()))} ms`)
  for (const w of [rWs, xWs, anonWs, anon2]) w.ws.close()
} finally {
  await stopWrangler(wr, PORT)
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
process.exit(failures ? 1 : 0)
