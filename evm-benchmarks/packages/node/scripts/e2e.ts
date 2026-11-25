// End-to-end against the running local worker (make e2e-node): codes issued on root, chains deployed with them, refusals.
//   bun packages/node/scripts/e2e.ts [url]
import { join } from 'node:path'
import { decodeFunctionResult, encodeDeployData, encodeFunctionData, getContractAddress, type Address, type Hex, type LocalAccount } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { MintableToken } from '@evmb/contracts'
import { GRANT_CREATE_CHAIN, GRANT_READER, GRANT_WRITER, MAX_CREATE_BYTES, MAX_SUBMIT_BYTES, NodeClient, NodeError, accessTx, claimTx, codeHash, generateCode, inviteTx, mined, setupTxs, type CreateChainResult } from '../src/client'
import { signRequest } from '../src/auth'
import { parseHead } from '../src/live'
import { Follower, FollowerRemoved } from '../src/follower'
import { MemoryFollowerStore } from '../src/followerStore'
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
    mined(await as(admin).submit('root', [await inviteTx(admin, await as(admin).nonce('root'), root.access, code, ttl, uses)]))
  const writes = generateCode(), one = generateCode(), two = generateCode(), short = generateCode(), race = generateCode(), live = generateCode(), retry = generateCode(), spent = generateCode()
  await issue(one, 600, 1)
  await issue(two, 600, 2)
  await issue(short, 2, 1)
  await issue(race, 600, 1)
  await issue(retry, 600, 1)
  await issue(spent, 600, 1)
  await issue(writes, 600, 1)
  await issue(live, 600, 1)
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
  const bigSubmit = await fetch(new URL('/chains/root/submit', URL_), { method: 'POST', body: 'x'.repeat(MAX_SUBMIT_BYTES + 1) })
  check(bigSubmit.status === 413, `POST /chains/root/submit over ${MAX_SUBMIT_BYTES} bytes → ${bigSubmit.status}`)
  const okSubmit = await fetch(new URL('/chains/root/submit', URL_), { method: 'POST', body: 'x'.repeat(64 * 1024 + 1) })
  check(okSubmit.status === 401, `unsigned POST /chains/root/submit over 64 KiB (under the cap) → ${okSubmit.status}`)
  const bigJoin = await fetch(new URL('/chains/root/join', URL_), { method: 'POST', body: 'x'.repeat(64 * 1024 + 1) })
  check(bigJoin.status === 413, `POST /chains/root/join over 64 KiB → ${bigJoin.status}`)
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
    mined(await bc.submit(cid, [await inviteTx(B, await bc.nonce(cid), bAccess, code, 300, 1, grants)]))
    return code
  }
  const blocks = async (n: number) => {
    for (let i = 0; i < n; i++) mined(await bc.submit(cid, [await accessTx(B, await bc.nonce(cid), bAccess, 'setReadOpen', false)]))
  }
  const member = async (a: LocalAccount) => (await bc.nodes(cid)).members.find((m) => m.address.toLowerCase() === a.address.toLowerCase())
  const codeC = await invite(GRANT_READER), codeD = await invite(GRANT_WRITER)
  const cc = as(C, 'C phone'), dc = as(D, 'Café tablet ☕')
  // a device builds its claim only from what a non-member can get: GET nonce gives its nonce and the chain's ChainAccess
  const joinAs = async (who: LocalAccount, code: string) => {
    const ji = await as(who).joinInfo(cid)
    return as(who).join(cid, await claimTx(who, ji.nonce, code, ji.access))
  }
  const jiC = await cc.joinInfo(cid)
  check(jiC.access.toLowerCase() === bAccess.toLowerCase() && await status(cc.info(cid)) === 403, 'a non-member gets the chain’s ChainAccess from GET nonce (and still cannot read it)')
  check((await joinAs(C, codeC)).role === 'reader', 'C joins B’s chain as a reader with a 1-use code')
  check((await joinAs(D, codeD)).role === 'writer', 'D joins as a writer')
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
    mined(await bc.submit(cid, [await accessTx(B, await bc.nonce(cid), bAccess, 'removeReader', C.address)]))
    check(await fc.sync().then(() => false, (e) => e instanceof FollowerRemoved) && fc.status === 'removed', 'removed C: its next sync is FollowerRemoved (403)')
    check(await status(cc.blocks(cid, 0)) === 403, 'removed C: GET blocks → 403')
    check(!(await member(C)), 'nodes omits C after removal')
    const root1 = await invite(GRANT_CREATE_CHAIN)
    const E = privateKeyToAccount(generatePrivateKey())
    check(await status(joinAs(E, root1)) === 403, 'a create-chain code used to join → 403')
    check(await status(joinAs(E, codeC)) === 403, 'C’s used 1-use code, by another key → 403')
    const revoked = await invite(GRANT_READER)
    mined(await bc.submit(cid, [await accessTx(B, await bc.nonce(cid), bAccess, 'revokeInvite', codeHash(revoked))]))
    check(await status(joinAs(E, revoked)) === 403, 'a revoked unused code → 403')
  } finally {
    await fc.dispose(); await fd.dispose()
  }

  // ---- live: a hibernating socket per reader gets the head on open and after each block; removal closes it with 4003 ----
  {
    const rl = await deploy(B, live), lid = rl.chainId
    const lb = as(B, 'B laptop'), lAccess = (await lb.info(lid)).access
    const R = privateKeyToAccount(generatePrivateKey())
    const code = generateCode()
    mined(await lb.submit(lid, [await inviteTx(B, await lb.nonce(lid), lAccess, code, 300, 1, GRANT_READER)]))
    const ji = await as(R).joinInfo(lid)
    await as(R).join(lid, await claimTx(R, ji.nonce, code, ji.access))
    const open = async (c: NodeClient) => {
      const ws = new WebSocket(await c.subscribeUrl(lid))
      const msgs: string[] = [], closed = new Promise<number>((res) => ws.addEventListener('close', (e) => res(e.code)))
      ws.addEventListener('message', (e) => msgs.push(String(e.data)))
      await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('socket error'))) })
      return { ws, msgs, closed }
    }
    const until = async (f: () => boolean, ms = 5000) => { for (const t = Date.now(); !f() && Date.now() - t < ms;) await Bun.sleep(50); return f() }
    const head = (m?: string) => (m ? parseHead(m) : null)
    const h0 = (await lb.state(lid)).head.number
    const sk = await open(as(R))
    try {
      check(await until(() => sk.msgs.length === 1) && head(sk.msgs[0])?.number === h0, `live: the reader's socket opens with the current head #${h0}`)
      mined(await lb.submit(lid, [await accessTx(B, await lb.nonce(lid), lAccess, 'setReadOpen', false)]))
      check(await until(() => sk.msgs.length === 2) && head(sk.msgs[1])?.number === h0 + 1, 'live: a writer submits and the reader gets the new head within 5 s')
      const bare = await fetch(new URL(`/chains/${lid}/subscribe`, URL_))
      check(bare.status === 426, `live: subscribe without upgrade → ${bare.status}`)
      mined(await lb.submit(lid, [await accessTx(B, await lb.nonce(lid), lAccess, 'removeReader', R.address)]))
      const code4 = await Promise.race([sk.closed, Bun.sleep(5000).then(() => -1)])
      check(code4 === 4003 && sk.msgs.length === 2, `live: after the admin removes the reader its socket closes with ${code4} and gets no further head`)
    } finally { sk.ws.close() }
  }

  // ---- writes: phone and tablet follow a chain with an ERC-20 B owns; each sends offline, then syncs ----
  {
    const rw = await deploy(B, writes), wid = rw.chainId
    const token = getContractAddress({ from: B.address, nonce: 0n })
    const wb = as(B, 'B laptop'), wAccess = (await wb.info(wid)).access
    const [P, T, M] = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()].map((k) => privateKeyToAccount(k))
    const [K1, K2, K3, S] = [0, 1, 2, 3].map(() => privateKeyToAccount(generatePrivateKey()))
    const x = privateKeyToAccount(generatePrivateKey()).address, y = privateKeyToAccount(generatePrivateKey()).address
    for (const w of [P!, T!, M!]) {
      const code = generateCode()
      mined(await wb.submit(wid, [await inviteTx(B, await wb.nonce(wid), wAccess, code, 300, 1, GRANT_WRITER)]))
      const ji = await as(w).joinInfo(wid)
      await as(w).join(wid, await claimTx(w, ji.nonce, code, ji.access))
    }
    const sign = (a: LocalAccount, nonce: number, data: Hex) => a.signTransaction({ type: 'eip1559', chainId: 31337, nonce, to: token, data, gas: 300_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
    const call = (fn: string, args: unknown[]) => encodeFunctionData({ abi: MintableToken.abi, functionName: fn, args } as never)
    const bn = await wb.nonce(wid)
    mined(await wb.submit(wid, await Promise.all([[K1, 10n], [K2, 10n], [K3, 10n], [S, 5n]].map(([k, n], i) => sign(B, bn + i, call('mint', [(k as LocalAccount).address, n]))))))
    const keys = (...ks: LocalAccount[]) => (from: Address) => ks.find((k) => k.address.toLowerCase() === from.toLowerCase())
    const phoneStore = new MemoryFollowerStore()
    const phone = await Follower.open(as(P!, 'phone'), wid, wasm, { store: phoneStore, signer: keys(S) })
    const tablet = await Follower.open(as(T!, 'tablet'), wid, wasm, { store: new MemoryFollowerStore(), signer: keys(S) })
    const nonceOn = (f: Follower, a: Address) => f.read(async (n) => Number(await n.request({ method: 'eth_getTransactionCount', params: [a, 'latest'] })))
    const balOn = (f: Follower, a: Address) => f.read(async (n) => decodeFunctionResult({ abi: MintableToken.abi, functionName: 'balanceOf', data: (await n.request({ method: 'eth_call', params: [{ to: token, data: call('balanceOf', [a]) }, 'latest'] })) as Hex }) as bigint)
    const transfer = async (f: Follower, from: LocalAccount, to: Address, n: bigint) => f.send(await sign(from, await nonceOn(f, from.address), call('transfer', [to, n])))
    const states = (f: Follower) => f.pending().map((t) => t.status).join()
    try {
      await transfer(phone, K1, x, 1n)
      await transfer(tablet, K2, y, 2n)
      check(states(phone) === 'pending' && states(tablet) === 'pending', 'phone and tablet each send offline: both pending, nothing synced')
      await phone.sync(); await tablet.sync(); await phone.sync()
      check(states(phone) === 'confirmed' && states(tablet) === 'confirmed', `both devices' writes confirmed (${states(phone)}, ${states(tablet)})`)
      check((await balOn(phone, y)) === 2n && (await balOn(tablet, x)) === 1n, 'each device sees the other’s transfer')
      check(phone.head.hash === tablet.head.hash && phone.head.hash === (await wb.state(wid)).head.hash, 'both devices at the cloud head')
      for (const t of phone.pending()) await phone.dismiss(t.hash)
      for (const t of tablet.pending()) await tablet.dismiss(t.hash)

      // one key imported on both devices spends one balance twice: the first synced wins, the other is re-signed and conflicts
      await transfer(phone, S, x, 5n)
      await transfer(tablet, S, y, 5n)
      await phone.sync(); await tablet.sync(); await phone.sync()
      check(states(phone) === 'confirmed' && states(tablet) === 'conflicted', `same key on two devices: phone ${states(phone)}, tablet ${states(tablet)}`)
      check((await balOn(tablet, S.address)) === 0n && (await balOn(tablet, y)) === 2n && (await balOn(tablet, x)) === 6n, 'the cloud’s order won: tablet shows S’s 5 tokens went to x')
      for (const t of phone.pending()) await phone.dismiss(t.hash)
      for (const t of tablet.pending()) await tablet.dismiss(t.hash)

      // a broker device submits a tx signed by a key with no chain role
      const brokered = await sign(K3, 0, call('transfer', [y, 4n]))
      const br = await as(M!, 'broker').submit(wid, [brokered])
      check(br.results[0]?.result === 'mined', `broker submits K3's tx (K3 has no role) → ${br.results[0]?.result}`)

      // phone sends offline, then reopens from its store with the worker unreachable (an unreachable URL, not a stopped worker)
      await transfer(phone, K1, x, 1n)
      const storedHead = phone.head
      await phone.dispose()
      const offline = await Follower.open(new NodeClient('http://127.0.0.1:9', P!), wid, wasm, { store: phoneStore, signer: keys(S) })
      check(offline.head.hash === storedHead.hash && states(offline) === 'pending', `reopened with the worker unreachable: at stored head #${offline.head.number}, 1 pending`)
      check((await balOn(offline, x)) === 7n, 'and the pending tx shows in its local state')
      check(await offline.sync().then(() => false, () => true) && states(offline) === 'pending', 'an offline sync fails and keeps the tx pending')
      await offline.dispose()
      const back = await Follower.open(as(P!, 'phone'), wid, wasm, { store: phoneStore, signer: keys(S) })
      try {
        await back.sync()
        check(states(back) === 'confirmed' && back.head.hash === (await wb.state(wid)).head.hash, `reachable again: the pending tx settles (${states(back)})`)
        check((await balOn(back, y)) === 6n, 'and shows the broker’s tx too')
      } finally { await back.dispose() }
    } finally {
      await phone.dispose(); await tablet.dispose()
    }
  }

  // ---- rate limit: 10 failed redeems per IP per 10 min ----
  for (let i = 0; i < 10; i++) await status(deploy(C, `wrong-${i}`))
  check(await status(deploy(C, one)) === 429, 'after 10 failed redeems from one IP → 429')
} catch (e) {
  check(false, `unexpected: ${(e as Error).message}`)
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS')
process.exit(failures ? 1 : 0)
