import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ChainHost, handle, type ChainHandleLike } from '../src/router'
import { MAX_SUBMIT_BYTES, NodeClient, NodeError, accessTx, claimTx, codeHash, inviteTx, setupTxs, GRANT_READER, GRANT_WRITER, GRANT_CREATE_CHAIN } from '../src/client'
import { bunSql } from './bunSql'
import { wasm } from './workload'
import { createNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'

const acct = (n: string) => privateKeyToAccount(keccak256(toBytes(n)))
const admin = acct('r-admin'), phone = acct('r-phone'), stranger = acct('r-stranger'), other = acct('r-other')
const hosts = new Map<string, ChainHost>()
const chainHost = (id: string): ChainHandleLike => {
  let h = hosts.get(id)
  if (!h) hosts.set(id, (h = new ChainHost(bunSql(), wasm, { rootAdmin: admin.address, chain: chainHost })))
  return h
}
let srv: ReturnType<typeof Bun.serve>, url: string, access: `0x${string}`, cid: string, dump: Awaited<ReturnType<NodeClient['state']>>['dump']
const as = (a: typeof admin, name?: string) => new NodeClient(url, a, { name })
let code = 0
const issue = async (grants: number, uses = 1, ttl = 600) => {
  const c = `code-${++code}`
  const a = as(admin)
  await a.submit(cid, [await inviteTx(admin, await a.nonce(cid), access, c, ttl, uses, grants)])
  return c
}
const status = (p: Promise<unknown>) => p.then(() => 200, (e) => (e as NodeError).status)

beforeAll(async () => {
  srv = Bun.serve({ port: 0, fetch: (r) => handle(r, { chain: chainHost }) })
  url = `http://localhost:${srv.port}`
  const n = await createNode({ chainId: 31337, computeStateRoot: true, miningConfig: { type: 'manual' }, engine: await createRevmEngine({ wasm }) })
  dump = await n.dumpState()
  await n.dispose()
  const r = await as(admin).createChain({ dump, setup: await setupTxs(admin, 0, 31337) })
  cid = r.chainId
  access = (await as(admin).health()).root!.access
})
afterAll(() => srv.stop(true))

describe('device routes', () => {
  test('state, blocks, nodes for the admin; nonce on any chain', async () => {
    const a = as(admin, '  laptop  ')
    const st = await a.state(cid)
    expect(st.dump.blocks.at(-1)!.number).toBe(st.head.number)
    const b = await a.blocks(cid, 0)
    expect(b.blocks.length).toBe(b.head.number)
    expect(b.blocks.at(-1)!.header.number).toBe(b.head.number)
    const nv = await a.nodes(cid)
    expect(nv.members.find((m) => m.address.toLowerCase() === admin.address.toLowerCase())).toMatchObject({ role: 'admin', name: 'laptop', block: b.head.number })
    expect(typeof (await a.nonce(cid))).toBe('number')
  })

  test('blocks: bad after is 400; caught-up cursor is the head', async () => {
    const a = as(admin)
    for (const q of ['-1', 'x', '1.5']) expect(await status(a['req']('GET', `/chains/${cid}/blocks?after=${q}`))).toBe(400)
    expect((await a.blocks(cid, 9999)).blocks).toEqual([])
  })

  test('join: reader joins, can read; create-chain code refused; non-member 403 on state; replay is 401', async () => {
    const p = as(phone, 'phone')
    expect(await status(p.state(cid))).toBe(403)
    expect(await status(p.nodes(cid))).toBe(403)
    expect(await status(p.blocks(cid, 0))).toBe(403)
    const bad = await issue(GRANT_CREATE_CHAIN)
    expect(await status(p.join(cid, await claimTx(phone, 0, bad, access)))).toBe(403)
    const c = await issue(GRANT_READER)
    const j = await p.join(cid, await claimTx(phone, 0, c, access))
    expect(j.role).toBe('reader')
    expect((await p.state(cid)).head.number).toBe(j.head.number)
    await p.blocks(cid, 0)
    const m = (await as(admin).nodes(cid)).members.find((x) => x.address.toLowerCase() === phone.address.toLowerCase())!
    expect(m).toMatchObject({ role: 'reader', name: 'phone' })
    // removing it: 403 and gone from nodes
    const a = as(admin)
    await a.submit(cid, [await accessTx(admin, await a.nonce(cid), access, 'removeReader', phone.address)])
    expect(await status(p.blocks(cid, 0))).toBe(403)
    expect((await a.nodes(cid)).members.some((x) => x.address.toLowerCase() === phone.address.toLowerCase())).toBe(false)
  })

  test('router accepts a 400 KiB submit, 413 above 512 KiB, 413 above 64 KiB on other routes; 400 over 256 txs', async () => {
    const a = as(admin)
    // zero-byte calldata: hex is 2 chars a byte, so 200 KiB of data is a ~400 KiB body
    const big = async (bytes: number) => admin.signTransaction({ type: 'eip1559', chainId: 31337, nonce: await a.nonce(cid), to: stranger.address, data: `0x${'00'.repeat(bytes)}`, gas: 25_000_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
    expect(MAX_SUBMIT_BYTES).toBe(512 * 1024)
    const ok = await a.submit(cid, [await big(200 * 1024)])
    expect(ok.results[0]!.result).toBe('mined')
    expect(await status(a.submit(cid, [await big(MAX_SUBMIT_BYTES / 2 + 1024)]))).toBe(413)
    expect(await status(a.join(cid, `0x${'00'.repeat(33 * 1024)}`))).toBe(413)
    expect(await status(a.submit(cid, Array(257).fill('0x00')))).toBe(400)
  })

  test('404s: unknown chain, unknown route', async () => {
    expect(await status(as(admin).state('nope'))).toBe(404)
    expect(await status(as(admin)['req']('GET', `/chains/${cid}/zzz`))).toBe(404)
  })

  test('a non-root chain: a non-member joins from GET nonce alone; a revoked code cannot join; readOpen polls by non-members write no cursor', async () => {
    const owner = acct('r-owner'), newbie = acct('r-newbie'), lurker = acct('r-lurker')
    const deployCode = await issue(GRANT_CREATE_CHAIN)
    const o = as(owner)
    const id = (await o.createChain({ dump, setup: await setupTxs(owner, 0, 31337), claim: await claimTx(owner, await o.nonce('root'), deployCode, access) })).chainId
    const own = (await o.info(id)).access
    const invite = async (c: string, grants = GRANT_READER) => o.submit(id, [await inviteTx(owner, await o.nonce(id), own, c, 600, 1, grants)])
    await invite('chain2-reader')
    // the newcomer can't read the chain, but GET nonce gives it what a claim needs
    const n = as(newbie)
    expect(await status(n.info(id))).toBe(403)
    const ji = await n.joinInfo(id)
    expect(ji).toEqual({ nonce: 0, access: own })
    expect((await n.join(id, await claimTx(newbie, ji.nonce, 'chain2-reader', ji.access))).role).toBe('reader')
    // revokeInvite: an unused code can no longer join
    await invite('chain2-revoked')
    await o.submit(id, [await accessTx(owner, await o.nonce(id), own, 'revokeInvite', codeHash('chain2-revoked'))])
    const l = as(lurker)
    expect(await status(l.join(id, await claimTx(lurker, 0, 'chain2-revoked', own)))).toBe(403)
    // readOpen: a non-member can read blocks, but only members get a cursor
    await o.submit(id, [await accessTx(owner, await o.nonce(id), own, 'setReadOpen', true)])
    await as(lurker, 'lurker').blocks(id, 0)
    await as(newbie, 'newbie').blocks(id, 0)
    const rows = (hosts.get(id)!.service as any).sql.exec('SELECT address FROM cursors').map((r: any) => r.address)
    expect(rows).toContain(newbie.address.toLowerCase())
    expect(rows).not.toContain(lurker.address.toLowerCase())
  })

  test('bad joins count toward 429; join is writer role for a writer code', async () => {
    const w = await issue(GRANT_WRITER)
    expect((await as(other).join(cid, await claimTx(other, 0, w, access))).role).toBe('writer')
    const s = as(stranger)
    let last = 0
    for (let i = 0; i < 11; i++) last = await status(s.join(cid, await claimTx(stranger, 0, `wrong-${i}`, access)))
    expect(last).toBe(429)
  })

  test('blocks past the 100 cap: cursor is the last delivered block, not the head; name is sanitised', async () => {
    const a = as(admin)
    for (let i = 0; i < 105; i++) await a.submit(cid, [await accessTx(admin, await a.nonce(cid), access, 'setReadOpen', i % 2 === 0)])
    const long = 'a\tx' + 'y'.repeat(40)
    const d = as(admin, long)
    const out = await d.blocks(cid, 0)
    expect(out.blocks.length).toBe(100)
    expect(out.head.number).toBeGreaterThan(100)
    const m = (await a.nodes(cid)).members.find((x) => x.address.toLowerCase() === admin.address.toLowerCase())!
    expect(m.block).toBe(100)
    expect(m.name).toBe(('ax' + 'y'.repeat(40)).slice(0, 32))
  })

  test('bidi overrides, isolates and zero-width characters are stripped from names', async () => {
    const a = as(admin)
    await a.submit(cid, [await accessTx(admin, await a.nonce(cid), access, 'setReadOpen', false)])
    await as(admin, 'a\u202Eb\u200Bc\uFEFFd\u2066e\u2069\u200Df\u202A').blocks(cid, 100)
    const m = (await a.nodes(cid)).members.find((x) => x.address.toLowerCase() === admin.address.toLowerCase())!
    expect(m.name).toBe('abcdef')
  })

  test('a non-Latin1 device name round-trips; an undecodable one is no name', async () => {
    const a = as(admin)
    await a.submit(cid, [await accessTx(admin, await a.nonce(cid), access, 'setReadOpen', false)]) // moves the head past the stored cursor
    await as(admin, 'Café tablet ☕').blocks(cid, 100)
    const find = async () => (await a.nodes(cid)).members.find((x) => x.address.toLowerCase() === admin.address.toLowerCase())!
    expect((await find()).name).toBe('Café tablet ☕')
    const res = await fetch(new URL(`/chains/${cid}/nodes`, url), { headers: { 'x-node-name': '%E0%A4%A' } })
    expect(res.status).toBe(401) // unsigned, but the router must not 500 on a bad escape
  })
})
