import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { encodeFunctionData, keccak256, toBytes, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Onboarding } from '@evmb/contracts'
import { ChainHost, handle, type ChainHandleLike } from '../src/router'
import { NodeClient, NodeError, claimTx, codeHash, inviteTx, mined, setupTxs, GRANT_CREATE_CHAIN } from '../src/client'
import { CHAIN_ID_RE, ensureOnboarding, issueTx, redeemTx, revokeTx } from '../src/onboarding'
import { bunSql } from './bunSql'
import { wasm } from './workload'
import { createNode, type SerializedState } from 'webevm'
import { createRevmEngine } from 'webevm/revm'

const acct = (n: string) => privateKeyToAccount(keccak256(toBytes(n)))
const admin = acct('o-admin'), sue = acct('o-sue'), bob = acct('o-bob')
const hosts = new Map<string, ChainHost>()
const chainHost = (id: string): ChainHandleLike => {
  let h = hosts.get(id)
  if (!h) hosts.set(id, (h = new ChainHost(bunSql(), wasm, { rootAdmin: admin.address, chain: chainHost })))
  return h
}
let srv: ReturnType<typeof Bun.serve>, url: string, dump: SerializedState, onb: Address
const as = (a: typeof admin) => new NodeClient(url, a)
const err = (p: Promise<unknown>) => p.then(() => ({ status: 200, error: '' }), (e) => ({ status: (e as NodeError).status, error: (e as NodeError).error }))
const head = async () => (await as(admin).health()).root!.head
const now = () => Math.floor(Date.now() / 1000)
let n = 0
const issue = async (uses = 1, ttl = 600) => {
  const code = `CODE${++n}`
  const a = as(admin)
  mined(await a.submit('root', [await issueTx(admin, await a.nonce('root'), onb, code, `label ${n}`, now() + ttl, uses)]))
  return code
}
/** The redeem form of POST /chains, sent by `who` for `chainId` (a fresh one if omitted). */
const create = async (who: typeof admin, o: { code?: string; chainId?: string; txChainId?: string; dump?: SerializedState } = {}) => {
  const chainId = o.chainId ?? crypto.randomUUID()
  const c = as(who)
  const redeem = o.code ? await redeemTx(who, await c.nonce('root'), onb, o.code, o.txChainId ?? chainId) : undefined
  return c.createChain({ dump: o.dump ?? dump, setup: await setupTxs(who, 0, 31337), chainId, redeem })
}
const usesLeft = async (code: string) => {
  const all = await (hosts.get('root')!.service as any).call(Onboarding.abi, 'codes', [], onb) as { hash: Hex; usesLeft: number }[]
  return all.find((c) => c.hash === codeHash(code))!.usesLeft
}

beforeAll(async () => {
  srv = Bun.serve({ port: 0, fetch: (r) => handle(r, { chain: chainHost }) })
  url = `http://localhost:${srv.port}`
  const node = await createNode({ chainId: 31337, computeStateRoot: true, miningConfig: { type: 'manual' }, engine: await createRevmEngine({ wasm }) })
  dump = await node.dumpState()
  await node.dispose()
  await as(admin).createChain({ dump, setup: await setupTxs(admin, 0, 31337) })
})
afterAll(() => { srv.stop(true); globalThis.fetch = realFetch })
// each test its own rate-limit bucket (cf-connecting-ip), so refusals in one test don't 429 the next
const realFetch = fetch
let ip = ''
globalThis.fetch = ((u: RequestInfo | URL, init: RequestInit = {}) =>
  realFetch(u, { ...init, headers: { ...(init.headers as Record<string, string>), 'cf-connecting-ip': ip } })) as typeof fetch
beforeEach(() => { ip = crypto.randomUUID() })

describe('onboarding on root', () => {
  test('health shows root.onboarding after ensureOnboarding; ensureOnboarding twice deploys once', async () => {
    expect((await as(admin).health()).root!.onboarding).toBeNull()
    expect(await err(create(sue))).toEqual({ status: 503, error: 'onboarding not set up on root' })
    const first = await ensureOnboarding(as(admin), admin)
    onb = first.onboarding
    expect((await as(admin).health()).root!.onboarding).toBe(onb)
    const nonce = await as(admin).nonce('root')
    expect(await ensureOnboarding(as(admin), admin)).toEqual(first)
    expect(await as(admin).nonce('root')).toBe(nonce)
    expect(CHAIN_ID_RE.test(crypto.randomUUID())).toBe(true)
    expect(CHAIN_ID_RE.test(crypto.randomUUID().toUpperCase())).toBe(false)
  })

  test('redeem form: Sue creates her chain and is its admin', async () => {
    const code = await issue()
    const chainId = crypto.randomUUID()
    const r = await create(sue, { code, chainId })
    expect(r.chainId).toBe(chainId)
    expect(r.url).toBe(`${url}/chains/${chainId}`)
    expect((await as(sue).info(chainId)).admin.toLowerCase()).toBe(sue.address.toLowerCase())
    expect(await hosts.get('root')!.service!.isDeployAllowed(sue.address, chainId)).toBe(true)
    // no SQL redeems row for this form
    expect((hosts.get('root')!.service as any).sql.exec('SELECT * FROM redeems')).toEqual([])
  })

  test('failed create after the redeem → 502 "chain not created: …"; retry without redeem creates it; code spent once', async () => {
    const code = await issue(2)
    const chainId = crypto.randomUUID()
    const bad = await err(create(sue, { code, chainId, dump: { bogus: true } as never }))
    expect(bad.status).toBe(502)
    expect(bad.error).toStartWith('chain not created: ')
    expect(await usesLeft(code)).toBe(1)
    const r = await create(sue, { chainId })
    expect(r.chainId).toBe(chainId)
    expect(await usesLeft(code)).toBe(1)
  })

  test('Bob with Sue\'s chainId and no redeem → 403 "not allowed to create this chain"', async () => {
    const code = await issue()
    const chainId = crypto.randomUUID()
    expect((await err(create(sue, { code, chainId, dump: { bogus: true } as never }))).status).toBe(502)
    expect(await err(create(bob, { chainId }))).toEqual({ status: 403, error: 'not allowed to create this chain' })
    expect(await err(create(bob, {}))).toEqual({ status: 403, error: 'not allowed to create this chain' })
    expect((await create(sue, { chainId })).chainId).toBe(chainId)
  })

  test('refusals: expired / used up / revoked / unknown / bad code → 403 with the exact reason, nothing mined', async () => {
    const used = await issue()
    await create(sue, { code: used })
    const revoked = await issue()
    const a = as(admin)
    mined(await a.submit('root', [await revokeTx(admin, await a.nonce('root'), onb, codeHash(revoked))]))
    const expired = await issue(1, 1)
    await Bun.sleep(2100)
    await issue() // a block past the expiry, so root's latest timestamp is past it
    for (const [code, reason] of [[used, 'code used up'], [revoked, 'code revoked'], ['NOSUCH99', 'no such code'], ['ab', 'bad code'], [expired, 'code expired']] as const) {
      const h = await head()
      expect(await err(create(bob, { code }))).toEqual({ status: 403, error: reason })
      expect(await head()).toBe(h)
    }
  })

  test('redeem tx chainId ≠ body chainId → 400', async () => {
    const code = await issue()
    const h = await head()
    const r = await err(create(sue, { code, txChainId: crypto.randomUUID() }))
    expect(r.status).toBe(400)
    expect(r.error).toStartWith('bad redeem tx: ')
    expect(await err(create(sue, { chainId: 'Not-A-UUID' }))).toEqual({ status: 400, error: 'bad chain id' })
    expect(await head()).toBe(h)
  })

  test('prechecks: redeem to ChainAccess → 400; Bob\'s tx in Sue\'s request → 403; value → 400; nothing mined', async () => {
    const code = await issue()
    const chainId = crypto.randomUUID()
    const { access } = (await as(admin).health()).root!
    const s = as(sue)
    const nonce = await s.nonce('root')
    const data = encodeFunctionData({ abi: Onboarding.abi, functionName: 'redeem', args: [code, chainId] })
    const signed = (to: Address, value = 0n) => sue.signTransaction({ type: 'eip1559', chainId: 31337, nonce, to, data, value, gas: 500_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
    const send = async (redeem: Hex) => err(s.createChain({ dump, setup: await setupTxs(sue, 0, 31337), chainId, redeem }))
    const h = await head()
    expect(await send(await signed(access))).toEqual({ status: 400, error: "bad redeem tx: not sent to root's Onboarding" })
    expect(await send(await redeemTx(bob, 0, onb, code, chainId))).toEqual({ status: 403, error: 'redeem tx must be sent by the request signer' })
    expect(await send(await signed(onb, 1n))).toEqual({ status: 400, error: 'bad redeem tx: redeem tx must send no value' })
    expect(await head()).toBe(h)
    expect(await usesLeft(code)).toBe(1)
  })

  test('repeated whyNot refusals from one IP → 429', async () => {
    const out: number[] = []
    for (let i = 0; i < 11; i++) out.push((await err(create(bob, { code: `NOSUCH${i}` }))).status)
    expect(out.slice(0, 10)).toEqual(Array(10).fill(403))
    expect(out[10]).toBe(429)
  })

  test('claim and chainId together → 400', async () => {
    const { access } = (await as(admin).health()).root!
    const r = await err(as(bob).createChain({ dump, setup: await setupTxs(bob, 0, 31337), chainId: crypto.randomUUID(), claim: await claimTx(bob, 0, 'whatever', access) }))
    expect(r).toEqual({ status: 400, error: 'send claim or chainId, not both' })
  })

  test('existing chainId → 409 before mining', async () => {
    const chainId = (await create(sue, { code: await issue() })).chainId
    const code = await issue()
    const h = await head()
    expect(await err(create(sue, { code, chainId }))).toEqual({ status: 409, error: 'chain already exists' })
    expect(await head()).toBe(h)
    expect(await usesLeft(code)).toBe(1)
  })

  test('old claim form still works', async () => {
    const { access } = (await as(admin).health()).root!
    const a = as(admin)
    await a.submit('root', [await inviteTx(admin, await a.nonce('root'), access, 'old-claim', 600, 1, GRANT_CREATE_CHAIN)])
    const r = await as(bob).createChain({ dump, setup: await setupTxs(bob, 0, 31337), claim: await claimTx(bob, await as(bob).nonce('root'), 'old-claim', access) })
    expect(CHAIN_ID_RE.test(r.chainId)).toBe(true)
    expect((hosts.get('root')!.service as any).sql.exec('SELECT chainId FROM redeems')).toEqual([{ chainId: r.chainId }])
  })
})
