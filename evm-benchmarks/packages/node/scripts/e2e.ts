// End-to-end against the running local worker (make e2e-node): codes issued on root, chains deployed with them, refusals.
//   bun packages/node/scripts/e2e.ts [url]
import { join } from 'node:path'
import { encodeDeployData, type Hex, type LocalAccount } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { MintableToken } from '@evmb/contracts'
import { GRANT_CREATE_CHAIN, GRANT_READER, GRANT_WRITER, MAX_CREATE_BYTES, NodeClient, NodeError, accessTx, claimTx, codeHash, generateCode, inviteTx, setupTxs, type CreateChainResult } from '../src/client'
import { signRequest } from '../src/auth'
import { Follower, FollowerRemoved } from '../src/follower'
import { ensureKey, freshDump, wasm } from './bootstrap'

const URL_ = process.argv[2] ?? 'http://127.0.0.1:8799'
const ENV = join(import.meta.dir, '../../../.env.local')
const IP = `e2e-${crypto.randomUUID()}` // own rate-limit bucket per run (cf-connecting-ip is set by Cloudflare in production)

let failures = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`)
  if (!ok) failures++
}
/** The status a request was refused with (0 if it succeeded). */
const status = (p: Promise<unknown>) => p.then(() => 0, (e) => (e instanceof NodeError ? e.status : -1))

const admin = privateKeyToAccount(ensureKey(ENV).key)
const B = privateKeyToAccount(generatePrivateKey())
const C = privateKeyToAccount(generatePrivateKey())
const D = privateKeyToAccount(generatePrivateKey())
// every request carries the run's IP header, so the rate-limit counter starts at zero
const realFetch = fetch
globalThis.fetch = ((u: RequestInfo | URL, init: RequestInit = {}) =>
  realFetch(u, { ...init, headers: { ...(init.headers as Record<string, string>), 'cf-connecting-ip': IP } })) as typeof fetch
const as = (a: LocalAccount, name?: string) => new NodeClient(URL_, a, { name })
const anon = new NodeClient(URL_)

try {
  // ---- health and root ----
  const h = await anon.health().catch((e) => { throw new Error(`worker not reachable at ${URL_}: ${e.message}`) })
  check(h.ok && !!h.root, `health: root chain exists, head #${h.root?.head}`)
  const root = h.root!
  check(root.admin.toLowerCase() === admin.address.toLowerCase(), 'root admin is ROOT_ADMIN_KEY from .env.local')

  // ---- admin issues codes ----
  const issue = async (code: string, ttl: number, uses: number) =>
    as(admin).submit('root', [await inviteTx(admin, await as(admin).nonce('root'), root.access, code, ttl, uses)])
  const one = generateCode(), two = generateCode(), short = generateCode(), race = generateCode(), retry = generateCode(), spent = generateCode()
  await issue(one, 600, 1)
  await issue(two, 600, 2)
  await issue(short, 2, 1)
  await issue(race, 600, 1)
  await issue(retry, 600, 1)
  await issue(spent, 600, 1)
  check(true, 'admin issues 1-use, 2-use and 2 s codes')

  // ---- B's browser chain: a fresh chain with one ERC-20 deploy ----
  const erc20 = await B.signTransaction({
    type: 'eip1559', chainId: 31337, nonce: 0, gas: 3_000_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n,
    data: encodeDeployData({ abi: MintableToken.abi, bytecode: MintableToken.bytecode, args: ['Token', 'TKN'] }),
  })
  const dump = await freshDump([erc20])
  // B's nonce on that chain is 1 (the ERC-20 deploy), C's is 0
  const deploy = async (who: LocalAccount, code: string) =>
    as(who).createChain({ dump, setup: await setupTxs(who, who === B ? 1 : 0, 31337), claim: await claimTx(who, await as(who).nonce('root'), code, root.access) })

  // ---- deploy with the 1-use code ----
  const r: CreateChainResult = await deploy(B, one)
  check(r.head.number === 2, `B deploys chain ${r.chainId} with the 1-use code, head #${r.head.number}`)
  check(r.url.endsWith(`/chains/${r.chainId}`), `url ${r.url}`)
  check(r.dump.blocks.at(-1)!.hash === r.head.hash, "returned dump's head hash equals head.hash")
  const info = await as(B).info(r.chainId)
  check(info.admin.toLowerCase() === B.address.toLowerCase(), 'admin of the new chain is B')
  check(info.chainId === r.chainId && info.head.hash === r.head.hash && info.head.stateRoot === r.head.stateRoot, 'info matches the create result')
  check(await status(as(C).info(r.chainId)) === 403, 'C cannot read B’s chain (403)')

  // ---- refusals ----
  check(await status(deploy(C, one)) === 403, 'same 1-use code again → 403')
  check(await status(deploy(C, 'not-a-real-code')) === 403, 'wrong code → 403')
  await Bun.sleep(3000)
  check(await status(deploy(C, short)) === 403, 'expired code (TTL 2 s, after 3 s) → 403')
  check(await status(as(C).createChain({ dump: await freshDump(), setup: await setupTxs(C, 0, 31337) })) === 403, 'root create by a non-admin → 403')
  check(await status(as(admin).createChain({ dump: await freshDump(), setup: await setupTxs(admin, 0, 31337) })) === 409, 'second root create by the admin → 409')
  const url = new URL('/chains/root/nonce', URL_)
  const s = await signRequest(C, 'GET', url, '')
  const headers = { 'x-ts': s.ts, 'x-nonce': s.nonce, 'x-sig': s.sig }
  const first = await fetch(url, { headers })
  const again = await fetch(url, { headers })
  check(first.status === 200 && again.status === 401, `replayed signed request → ${first.status} then ${again.status}`)
  const nonPost = await fetch(new URL('/chains', URL_))
  check(nonPost.status === 404, `GET /chains → ${nonPost.status}`)
  const badTs = await fetch(url, { headers: { ...headers, 'x-ts': 'NaN', 'x-nonce': crypto.randomUUID() } })
  check(badTs.status === 401, `non-numeric x-ts → ${badTs.status}`)
  const unsigned = await fetch(new URL('/chains', URL_), { method: 'POST', body: '{}' })
  check(unsigned.status === 401, `unsigned POST /chains → ${unsigned.status}`)
  check(unsigned.headers.get('access-control-allow-origin') === null, 'no CORS origin for a request without Origin')
  const big = await fetch(new URL('/chains', URL_), { method: 'POST', body: 'x'.repeat(MAX_CREATE_BYTES + 1) })
  check(big.status === 413, `POST /chains over ${MAX_CREATE_BYTES} bytes → ${big.status} (before auth)`)
  const bigSubmit = await fetch(new URL('/chains/root/submit', URL_), { method: 'POST', body: 'x'.repeat(64 * 1024 + 1) })
  check(bigSubmit.status === 413, `POST /chains/root/submit over 64 KiB → ${bigSubmit.status}`)
  const pre = await fetch(new URL('/chains', URL_), { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } })
  check(pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'http://localhost:5173', `CORS preflight from localhost → ${pre.status}`)

  // ---- the 2-use code ----
  const r1 = await deploy(B, two)
  const r2 = await deploy(C, two)
  check(r1.chainId !== r2.chainId, `the 2-use code deploys two chains (${r1.chainId}, ${r2.chainId})`)
  check(await status(deploy(C, two)) === 403, 'and refuses a third → 403')

  // ---- a 1-use code redeemed by two deploys at once ----
  const both = await Promise.all([deploy(B, race), deploy(C, race)].map((p) => p.then((x) => ({ s: 201, id: x.chainId }), (e) => ({ s: e.status, id: '' }))))
  check(both.map((x) => x.s).sort().join() === '201,403', `two concurrent deploys with one 1-use code → ${both.map((x) => x.s).join(', ')}`)

  // ---- a malformed set-up does not spend the code ----
  const extra = await C.signTransaction({ type: 'eip1559', chainId: 31337, nonce: 2, gas: 100_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, data: '0x00' })
  const bad = as(C).createChain({ dump, setup: [...(await setupTxs(C, 0, 31337)), extra] as never, claim: await claimTx(C, await as(C).nonce('root'), retry, root.access) })
  check(await status(bad) === 400, 'deploy with a third set-up tx → 400')
  const rr = await deploy(C, retry)
  check(!!rr.chainId, `the same code still works on retry → ${rr.chainId}`)

  // ---- a create that fails after the redeem: the code is spent, and the codes list says why ----
  const broken = as(C).createChain({ dump: { bogus: true } as never, setup: await setupTxs(C, 0, 31337), claim: await claimTx(C, await as(C).nonce('root'), spent, root.access) })
  check(await status(broken) === 400, 'deploy with a bad dump → 400 (after the redeem)')

  // ---- codes ----
  const codes = await as(admin).codes()
  const rec = (c: string) => codes.find((x) => x.hash === codeHash(c))
  check(rec(one)?.usesLeft === 0 && rec(one)?.redeemed.map((x) => x.chainId).join() === r.chainId, 'codes: the 1-use code redeemed by B for its chain')
  check(rec(two)?.redeemed.map((x) => x.chainId).sort().join() === [r1.chainId, r2.chainId].sort().join(), 'codes: the 2-use code redeemed twice')
  check(rec(short)?.redeemed.length === 0, 'codes: the expired code never redeemed')
  check(rec(race)?.redeemed.length === 1 && rec(race)?.redeemed[0]!.chainId === both.find((x) => x.s === 201)?.id, 'codes: the raced code redeemed once, for the winner')
  check(rec(retry)?.redeemed.map((x) => x.chainId).join() === rr.chainId, 'codes: the retried code redeemed once')
  check(rec(spent)?.usesLeft === 0 && /^failed: bad dump/.test(rec(spent)?.redeemed[0]?.chainId ?? ''), `codes: the spent code records the failed create (${rec(spent)?.redeemed[0]?.chainId})`)
  check(await status(as(B).codes()) === 403, 'codes by a non-admin → 403')

  // ---- devices: B's chain with C (reader) and D (writer) following it ----
  const cid = r.chainId, bAccess = info.access
  const bc = as(B, 'B laptop')
  const invite = async (grants: number, code = generateCode()) => {
    await bc.submit(cid, [await inviteTx(B, await bc.nonce(cid), bAccess, code, 300, 1, grants)])
    return code
  }
  const blocks = async (n: number) => {
    for (let i = 0; i < n; i++) await bc.submit(cid, [await accessTx(B, await bc.nonce(cid), bAccess, 'setReadOpen', false)])
  }
  const member = async (a: LocalAccount) => (await bc.nodes(cid)).members.find((m) => m.address.toLowerCase() === a.address.toLowerCase())
  const codeC = await invite(GRANT_READER), codeD = await invite(GRANT_WRITER)
  const cc = as(C, 'C phone'), dc = as(D, 'Café tablet ☕')
  check((await cc.join(cid, await claimTx(C, 0, codeC, bAccess))).role === 'reader', 'C joins B’s chain as a reader with a 1-use code')
  check((await dc.join(cid, await claimTx(D, 0, codeD, bAccess))).role === 'writer', 'D joins as a writer')
  const fc = await Follower.open(cc, cid, wasm), fd = await Follower.open(dc, cid, wasm)
  try {
    const head0 = (await bc.state(cid)).head
    check(fc.head.hash === head0.hash && fd.head.hash === head0.hash, `C and D boot at B's head #${head0.number}`)
    await blocks(3)
    const bh = (await bc.state(cid)).head
    const [hc, hd] = [await fc.sync(), await fd.sync()]
    check(hc.hash === bh.hash && hd.hash === bh.hash && bh.number === head0.number + 3, `after 3 blocks both followers reach #${bh.number} with B's hash`)
    const ms = await Promise.all([member(B), member(C), member(D)])
    check(ms[0]?.role === 'admin' && ms[1]?.role === 'reader' && ms[2]?.role === 'writer', 'nodes: B admin, C reader, D writer')
    check(ms[1]?.name === 'C phone' && ms[2]?.name === 'Café tablet ☕' && ms[1]?.block === bh.number && ms[2]?.block === bh.number, `nodes: names (incl. non-ASCII) and blocks ${ms[1]?.block}, ${ms[2]?.block}`)
    await blocks(2)
    await fd.sync() // C stops polling
    const bh2 = (await bc.state(cid)).head
    const [mc, md] = [await member(C), await member(D)]
    check(mc?.behind === 2 && mc.block === bh.number && md?.behind === 0 && md.block === bh2.number, `nodes: C ${mc?.behind} behind, D ${md?.behind} behind`)
    await bc.submit(cid, [await accessTx(B, await bc.nonce(cid), bAccess, 'removeReader', C.address)])
    check(await fc.sync().then(() => false, (e) => e instanceof FollowerRemoved) && fc.status === 'removed', 'removed C: its next sync is FollowerRemoved (403)')
    check(await status(cc.blocks(cid, 0)) === 403, 'removed C: GET blocks → 403')
    check(!(await member(C)), 'nodes omits C after removal')
    const root1 = await invite(GRANT_CREATE_CHAIN)
    check(await status(as(D).join(cid, await claimTx(D, 0, root1, bAccess))) === 403, 'a create-chain code used to join → 403')
    check(await status(as(C).join(cid, await claimTx(C, 0, codeC, bAccess))) === 403, 'C’s reused 1-use code → 403')
  } finally {
    await fc.dispose(); await fd.dispose()
  }

  // ---- rate limit: 10 failed redeems per IP per 10 min ----
  for (let i = 0; i < 10; i++) await status(deploy(C, `wrong-${i}`))
  check(await status(deploy(C, one)) === 429, 'after 10 failed redeems from one IP → 429')
} catch (e) {
  check(false, `unexpected: ${(e as Error).message}`)
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS')
process.exit(failures ? 1 : 0)
