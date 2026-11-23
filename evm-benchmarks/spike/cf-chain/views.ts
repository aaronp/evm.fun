// Views demo: on-chain alias registry, recipes (self-describing, erc20), per-alias read rules,
// generalised invites (single-use / multi-use, reader/writer grants). Real curl lines.
//   bun spike/cf-chain/views.ts
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { encodeDeployData, encodeFunctionData, keccak256, toHex, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ACCESS, ACCESS_ABI, ACCESS_BYTECODE, ALIASES, ALIASES_ABI, accessCall } from './src/chain'
import NOTICE from './src/Notice.json'
import { Device } from './src/replica'
import { startWrangler, stopWrangler } from './dev'

const DIR = import.meta.dir
const PORT = 8797
const BASE = `http://127.0.0.1:${PORT}`
const PERSIST = join(DIR, '.wrangler/views-state')
const TOKEN = JSON.parse(readFileSync(join(DIR, '../../packages/contracts/artifacts/AssetToken.json'), 'utf8'))
const GRANT_READER = 1, GRANT_WRITER = 2

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures++ }

const dev = (k: Hex) => new Device(BASE, privateKeyToAccount(k))
const A = dev('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') // creator/admin
const V = dev(generatePrivateKey()) // view-only: on the GBP view's read list, not on the chain's
const fresh = () => dev(generatePrivateKey())

const nonces = new Map<string, number>()
const sign = (d: Device, to: Hex | null, data: Hex = '0x') => {
  const nonce = nonces.get(d.address) ?? 0
  nonces.set(d.address, nonce + 1)
  return d.account.signTransaction!({ type: 'eip1559', chainId: 779, nonce, to, data, gas: 5_000_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }) as Promise<Hex>
}
const unsign = (d: Device) => nonces.set(d.address, (nonces.get(d.address) ?? 1) - 1) // refused tx: reuse its nonce
let id = ''
const head = async () => (await A.call('GET', `/chains/${id}/head`)).data as { number: number; hash: string; timestamp: number }
const submit = async (signer: Device, txs: Hex[], timestamp?: number) => signer.call('POST', `/chains/${id}/submit`, { expectedHead: (await head()).hash, txs, timestamp })
const tx = (d: Device, to: Hex, abi: any, fn: string, args: unknown[]) => sign(d, to, encodeFunctionData({ abi, functionName: fn, args }))
const ok200 = (r: { status: number; data: any }) => r.status === 200 && r.data.block.receipts.every((x: any) => x.status === '0x1')

/** Run real curl, print the full command and the (trimmed) response. */
async function curl(path: string, token?: string, quiet = false) {
  const args = ['curl', '-s', '-i', ...(token ? ['-H', `Authorization: Bearer ${token}`] : []), `${BASE}${path}`]
  const out = await new Response(Bun.spawn(args, { stdout: 'pipe' }).stdout).text()
  const [hdr, ...rest] = out.split('\r\n\r\n')
  const status = Number(hdr!.split(' ')[1])
  const timing = hdr!.match(/server-timing: (.*)/i)?.[1]
  const body = rest.join('')
  if (!quiet) {
    console.log(`  $ ${args.slice(0, -1).map((a) => (a.includes(' ') ? `'${a}'` : a)).join(' ')} ${args.at(-1)}`)
    console.log(`    -> ${status} ${body.length > 600 ? body.slice(0, 600) + '…' : body}${timing ? `   [server-timing: ${timing}]` : ''}`)
  }
  return { status, body, data: (() => { try { return JSON.parse(body) } catch { return null } })(), timing }
}

rmSync(PERSIST, { recursive: true, force: true })
const wr = await startWrangler(DIR, PORT, PERSIST)
try {
  console.log('\n== setup: chain (reads restricted), GBP token, GBP access contract, Notice, aliases ==')
  const genesis = { chainId: 779, timestamp: Math.floor(Date.now() / 1000), alloc: {} }
  const created = await A.createChain(genesis, {})
  id = created.data.chainId
  check(created.status === 201, `A creates chain ${id} (ChainAccess at ${ACCESS}, Aliases at ${ALIASES}, both in genesis)`)
  const tA = () => A.readToken(id, 120), tV = () => V.readToken(id, 120)

  const SUPPLY = 1_000_000_00n // £1,000,000.00 at 2 decimals
  let r = await submit(A, [
    await sign(A, null, encodeDeployData({ abi: TOKEN.abi, bytecode: TOKEN.bytecode, args: ['Pound Sterling', 'GBP', 2, SUPPLY, A.account.address] })),
    await sign(A, null, ACCESS_BYTECODE),
    await sign(A, null, encodeDeployData({ abi: NOTICE.abi, bytecode: NOTICE.bytecode as Hex, args: ['Opening hours'] })),
  ])
  const [gbp, gbpAccess, notice] = r.data.block.receipts.map((x: any) => x.contractAddress as Hex)
  const gbpBlock = r.data.block.number
  check(ok200(r) && !!gbp && !!gbpAccess && !!notice, `A deploys GBP (AssetToken) ${gbp}, a second ChainAccess for the GBP view ${gbpAccess}, Notice ${notice} in block ${gbpBlock}`)
  const NOTICE_VIEWS = ['function author() view returns (address)', 'function title() view returns (string)', 'function revision() view returns (uint64)', 'function lines() view returns (string[])'].join(';')
  r = await submit(A, [
    await tx(A, gbpAccess, ACCESS_ABI, 'addReader', [V.address]),
    await tx(A, notice, NOTICE.abi, 'post', ['Opening hours', ['Mon-Fri 9-17', 'Sat 10-14', 'Sun closed']]),
    await tx(A, ALIASES, ALIASES_ABI, 'register', ['gbp', gbp, 'erc20', String(gbpBlock), gbpAccess]),
    await tx(A, ALIASES, ALIASES_ABI, 'register', ['notice', notice, 'self-describing', NOTICE_VIEWS, '0x0000000000000000000000000000000000000000']),
  ])
  check(ok200(r), 'one block: gbpAccess.addReader(V); notice.post(…); Aliases.register("gbp" -> erc20, access = gbpAccess); register("notice" -> self-describing, access = chain)')
  r = await submit(A, [await tx(A, ALIASES, ALIASES_ABI, 'register', ['GBP', gbp, 'erc20', '', gbpAccess])])
  check(r.status === 200 && r.data.block.receipts[0].status === '0x0', 'register("GBP") reverts (names are lowercase [a-z0-9-])')
  const X = fresh()
  r = await submit(A, [await tx(X, ALIASES, ALIASES_ABI, 'register', ['evil', gbp, 'erc20', '', gbpAccess])]); unsign(X)
  check(r.status === 403, `non-admin register -> ${r.status} (X is not a writer; a writer who is not admin would revert "admin only")`)

  // a few transfers: 10 holders, one of them sends everything on (zero balance -> omitted)
  const H = Array.from({ length: 10 }, fresh)
  r = await submit(A, await Promise.all(H.map((h, i) => tx(A, gbp, TOKEN.abi, 'transfer', [h.account.address, BigInt((i + 1) * 100_00)]))))
  check(ok200(r), 'A transfers £100·i GBP to 10 holders H1..H10')
  r = await submit(H[0]!, [await tx(H[0]!, gbp, TOKEN.abi, 'transfer', [H[1]!.account.address, 100_00n])])
  check(r.status === 403, `H1 (not a chain writer) transfer -> ${r.status}: holders are not chain writers, so A adds H1 as writer first`)
  unsign(H[0]!)
  check(ok200(await submit(A, [await tx(A, ACCESS, ACCESS_ABI, 'addWriter', [H[0]!.address])])), 'A addWriter(H1)')
  check(ok200(await submit(H[0]!, [await tx(H[0]!, gbp, TOKEN.abi, 'transfer', [H[1]!.account.address, 100_00n])])), 'H1 sends its £100 to H2 (H1 now holds 0)')

  console.log('\n== aliases list (chain read) ==')
  let c = await curl(`/chains/${id}/aliases`, await tA())
  check(c.status === 200 && c.data.map((a: any) => a.alias).join() === 'gbp,notice', 'A: GET aliases -> 200 [gbp, notice]')
  c = await curl(`/chains/${id}/aliases`, await tV())
  check(c.status === 403, 'V (view-only key): GET aliases -> 403 (the list is guarded by chain read)')

  console.log('\n== access-controls/latest (ChainAccess as a self-describing view) ==')
  c = await curl(`/chains/${id}/access-controls/latest`, await tA())
  const s = c.data?.state
  check(c.status === 200 && s.admin.toLowerCase() === A.address && s.readOpen === false && s.read.length === 0 && s.write.map((x: string) => x.toLowerCase()).join() === H[0]!.address,
    'A: access-controls/latest -> {admin: A, readOpen: false, read: [], write: [H1]}')

  console.log('\n== GBP erc20 view ==')
  c = await curl(`/chains/${id}/gbp/latest`, await tV())
  const g = c.data?.state
  const want = Object.fromEntries([[A.address, String(SUPPLY - 5500_00n)], [H[1]!.address, '30000'], ...H.slice(2).map((h, i) => [h.address, String((i + 3) * 100_00)])])
  check(c.status === 200 && g.name === 'Pound Sterling' && g.symbol === 'GBP' && g.decimals === 2 && g.totalSupply === String(SUPPLY)
    && JSON.stringify(Object.entries(g.balances).sort()) === JSON.stringify(Object.entries(want).sort()),
    `V: gbp/latest -> 200 {name, symbol, decimals: 2, totalSupply, balances: ${Object.keys(g?.balances ?? {}).length} non-zero holders (H1 omitted)}, cost ${JSON.stringify(c.data?.cost)}`)

  console.log('\n== self-describing Notice view ==')
  c = await curl(`/chains/${id}/notice/latest`, await tA())
  check(c.status === 200 && c.data.state.title === 'Opening hours' && c.data.state.revision === '1' && c.data.state.lines.length === 3 && c.data.state.author.toLowerCase() === A.address,
    'A: notice/latest -> {author, title, revision: "1", lines: [3]}')

  console.log('\n== view-only key V: its alias yes, raw routes and other aliases no ==')
  check((await curl(`/chains/${id}/gbp/latest`, await tV(), true)).status === 200, 'V: gbp/latest -> 200 (shown above)')
  for (const p of ['head', `blocks?after=0`, `balance/${A.address}`, `call/${gbp}?data=0x18160ddd`, `erc20/${gbp}/balanceOf/${A.address}`])
    check((await curl(`/chains/${id}/${p}`, await tV())).status === 403, `V: GET ${p.split('?')[0]} -> 403`)
  check((await curl(`/chains/${id}/notice/latest`, await tV())).status === 403, 'V: notice/latest -> 403 (that alias uses the chain list)')
  check((await curl(`/chains/${id}/access-controls/latest`, await tV())).status === 403, 'V: access-controls/latest -> 403')
  check((await curl(`/chains/${id}/nope/latest`, await tA())).status === 404, 'A: nope/latest -> 404 no such alias')

  console.log('\n== readOpen on the GBP access contract: the GBP view becomes a plain GET ==')
  check((await curl(`/chains/${id}/gbp/latest`)).status === 401, 'anonymous gbp/latest -> 401')
  check(ok200(await submit(A, [await tx(A, gbpAccess, ACCESS_ABI, 'setReadOpen', [true])])), 'A gbpAccess.setReadOpen(true)')
  c = await curl(`/chains/${id}/gbp/latest`)
  check(c.status === 200 && c.data.state.symbol === 'GBP', 'plain curl gbp/latest -> 200')
  check((await curl(`/chains/${id}/head`)).status === 401, 'plain curl head -> still 401 (chain reads stay closed)')
  check((await curl(`/chains/${id}/notice/latest`)).status === 401, 'plain curl notice/latest -> still 401')

  console.log('\n== remove an alias ==')
  check(ok200(await submit(A, [await tx(A, ALIASES, ALIASES_ABI, 'register', ['tmp', notice, 'self-describing', NOTICE_VIEWS, gbpAccess])])), 'register("tmp")')
  check((await curl(`/chains/${id}/tmp/latest`, undefined, true)).status === 200, 'plain tmp/latest -> 200 (gbpAccess is open)')
  check(ok200(await submit(A, [await tx(A, ALIASES, ALIASES_ABI, 'remove', ['tmp'])])), 'remove("tmp")')
  check((await curl(`/chains/${id}/tmp/latest`)).status === 404, 'tmp/latest -> 404 after remove')

  console.log('\n== invites {hash, expiry, usesLeft, grants} ==')
  const claim = (d: Device, code: string, ts?: number) => sign(d, ACCESS, accessCall('claim', [code])).then((t) => submit(d, [t], ts))
  const inviteTx = (code: string, ttl: bigint, uses: number, grants: number) => tx(A, ACCESS, ACCESS_ABI, 'invite', [keccak256(toHex(code)), ttl, uses, grants])
  const invites = async (code: string) => {
    const res = (await curl(`/chains/${id}/call/${ACCESS}?data=${accessCall('invites', [keccak256(toHex(code))])}`, await tA(), true)).data.result as Hex
    return { expiry: BigInt(res.slice(0, 66)), usesLeft: Number(BigInt('0x' + res.slice(66, 130))) }
  }
  check(ok200(await submit(A, [await inviteTx('one-time-otter', 120n, 1, GRANT_READER)])), 'A invite("one-time-otter", 120 s, uses 1, grants reader)')
  const J1 = fresh(), J2 = fresh()
  r = await claim(J1, 'one-time-otter')
  check(r.status === 200, `J1 claims -> ${r.status}`)
  check((await curl(`/chains/${id}/head`, await J1.readToken(id))).status === 200, 'J1 can now read the chain (GET head -> 200)')
  check((await invites('one-time-otter')).usesLeft === 0, 'invites(hash) is deleted (usesLeft 0, expiry 0)')
  r = await claim(J2, 'one-time-otter'); unsign(J2)
  check(r.status === 403, `J2 claims the captured code -> ${r.status} ${r.data.error}`)

  check(ok200(await submit(A, [await inviteTx('team-badger', 10n, 50, GRANT_READER | GRANT_WRITER)])), 'A invite("team-badger", 10 s, uses 50, grants reader|writer)')
  const K = [fresh(), fresh(), fresh(), fresh()]
  for (const k of K.slice(0, 3)) { r = await claim(k, 'team-badger'); check(r.status === 200, `K${K.indexOf(k) + 1} claims team-badger -> ${r.status}`) }
  const inv = await invites('team-badger')
  check(inv.usesLeft === 47, `invites(team-badger): usesLeft ${inv.usesLeft}, expiry ${inv.expiry}`)
  c = await curl(`/chains/${id}/access-controls/latest`, await K[0]!.readToken(id))
  const ks = K.slice(0, 3).map((k) => k.address)
  check(c.status === 200 && ks.every((a) => c.data.state.read.map((x: string) => x.toLowerCase()).includes(a) && c.data.state.write.map((x: string) => x.toLowerCase()).includes(a)),
    'K1 reads access-controls/latest: K1..K3 in both read and write')
  // advance time: a proposer may stamp its block up to now+30 s, past the 10 s expiry
  const late = Math.floor(Date.now() / 1000) + 25
  r = await claim(K[3]!, 'team-badger', late); unsign(K[3]!)
  check(r.status === 403 && (await invites('team-badger')).usesLeft === 47, `K4 claims in a block stamped +25 s (past expiry, 47 uses left) -> ${r.status} ${r.data.error}`)
  check(ok200(await submit(A, [await inviteTx('pair', 120n, 2, GRANT_READER)])), 'A invite("pair", uses 2)')
  const P = [fresh(), fresh(), fresh()]
  const pr = [await claim(P[0]!, 'pair'), await claim(P[1]!, 'pair'), await claim(P[2]!, 'pair')]
  check(pr.map((x) => x.status).join() === '200,200,403', `three keys claim a 2-use code -> ${pr.map((x) => x.status).join(', ')} (used up)`)

  console.log('\n== cost ==')
  const rt = async (path: string, n = 20) => { const t0 = performance.now(); for (let i = 0; i < n; i++) await fetch(`${BASE}${path}`).then((x) => x.text()); return ((performance.now() - t0) / n).toFixed(2) }
  const costLine = async (label: string, path: string) => {
    const v = (await curl(path, undefined, true)).data
    console.log(`  ${label}: ${v.state.holders ?? '-'} holders, eth_calls ${v.cost.ethCalls}, log scans ${v.cost.logScans} (${v.cost.logs} logs), recipe ${v.cost.ms.toFixed(1)} ms in DO (1 ms clock), client round trip ${await rt(path)} ms (mean of 20)`)
    return v
  }
  check(ok200(await submit(A, [await tx(A, ACCESS, ACCESS_ABI, 'setReadOpen', [true])])), 'A setReadOpen(true) on the chain so cost runs are plain GETs')
  await costLine('access-controls', `/chains/${id}/access-controls/latest`)
  await costLine('notice         ', `/chains/${id}/notice/latest`)
  await costLine('gbp @ 10       ', `/chains/${id}/gbp/latest`)
  const more = Array.from({ length: 190 }, fresh)
  r = await submit(A, await Promise.all(more.map((h) => tx(A, gbp, TOKEN.abi, 'transfer', [h.account.address, 1_00n]))))
  check(ok200(r), `A transfers £1 to 190 more keys in one block (${r.data.timings?.executeMs?.toFixed?.(0)} ms execute)`)
  const v200 = await costLine('gbp @ 200      ', `/chains/${id}/gbp/latest`)
  check(v200.state.holders === 200, `gbp view now lists ${v200.state.holders} holders`)
} finally {
  await stopWrangler(wr, PORT)
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
process.exit(failures ? 1 : 0)
