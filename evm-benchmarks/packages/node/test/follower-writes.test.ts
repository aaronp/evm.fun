import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { decodeFunctionResult, encodeDeployData, encodeFunctionData, getContractAddress, keccak256, toBytes, type Address, type Hex, type LocalAccount } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { ChainAccess, MintableToken } from '@evmb/contracts'
import { ChainHost, handle, type ChainHandleLike } from '../src/router'
import { NodeClient, NodeError, claimTx, inviteTx, mined, setupTxs, GRANT_READER, GRANT_WRITER } from '../src/client'
import { Follower, FollowerRemoved } from '../src/follower'
import { MemoryFollowerStore } from '../src/followerStore'
import { bunSql } from './bunSql'
import { wasm } from './workload'

const acct = (n: string) => privateKeyToAccount(keccak256(toBytes(n)))
const admin = acct('fw-admin'), tablet = acct('fw-tablet'), phone = acct('fw-phone')
const fresh = () => privateKeyToAccount(generatePrivateKey())
const hosts = new Map<string, ChainHost>()
const chainHost = (id: string): ChainHandleLike => {
  let h = hosts.get(id)
  if (!h) hosts.set(id, (h = new ChainHost(bunSql(), wasm, { rootAdmin: admin.address, chain: chainHost })))
  return h
}
let srv: ReturnType<typeof Bun.serve>, url: string, cid: string, token: Address
const as = (a: LocalAccount) => new NodeClient(url, a)
const followers: Follower[] = []
const keep = (f: Follower) => (followers.push(f), f)
const sign = (a: LocalAccount, nonce: number, to: Address | undefined, data: Hex, gas = 300_000n) =>
  a.signTransaction({ type: 'eip1559', chainId: 31337, nonce, to, data, gas, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
const call = (fn: string, args: unknown[]) => encodeFunctionData({ abi: MintableToken.abi, functionName: fn, args } as never)
/** Admin submits straight to the cloud. */
const cloud = async (data: Hex) => {
  const c = as(admin)
  return mined(await c.submit(cid, [await sign(admin, await c.nonce(cid), token, data)]))
}
const mint = (to: Address, n: bigint) => cloud(call('mint', [to, n]))
const nonceOn = (f: Follower, a: Address) => f.read(async (n) => Number(await n.request({ method: 'eth_getTransactionCount', params: [a, 'latest'] })))
const balanceOn = (f: Follower, a: Address) => f.read(async (n) => decodeFunctionResult({
  abi: MintableToken.abi, functionName: 'balanceOf', data: (await n.request({ method: 'eth_call', params: [{ to: token, data: call('balanceOf', [a]) }, 'latest'] })) as Hex,
}) as bigint)
/** `from` sends `amount` of the token to `to` on device `f`, at its local next nonce. */
const transfer = async (f: Follower, from: LocalAccount, to: Address, amount: bigint) =>
  f.send(await sign(from, await nonceOn(f, from.address), token, call('transfer', [to, amount])))
const cloudHead = async () => (await as(admin).state(cid)).head
/** Every block's tx hashes on the cloud. */
const cloudTxs = async () => {
  const out: string[] = []
  for (let after = 0; ;) {
    const p = await as(admin).blocks(cid, after)
    for (const b of p.blocks) out.push(...b.header.transactions)
    if (!p.blocks.length) return out
    after = p.blocks.at(-1)!.header.number
  }
}
const signers = (...keys: LocalAccount[]) => (from: Address) => keys.find((k) => k.address.toLowerCase() === from.toLowerCase())

beforeAll(async () => {
  srv = Bun.serve({ port: 0, fetch: (r) => handle(r, { chain: chainHost }) })
  url = `http://localhost:${srv.port}`
  const n = await createNode({ chainId: 31337, computeStateRoot: true, miningConfig: { type: 'manual' }, engine: await createRevmEngine({ wasm }) })
  const dump = await n.dumpState()
  await n.dispose()
  const c = as(admin)
  cid = (await c.createChain({ dump, setup: await setupTxs(admin, 0, 31337) })).chainId
  const { access } = await c.info(cid)
  const nonce = await c.nonce(cid)
  token = getContractAddress({ from: admin.address, nonce: BigInt(nonce) })
  mined(await c.submit(cid, [
    await sign(admin, nonce, undefined, encodeDeployData({ abi: MintableToken.abi, bytecode: MintableToken.bytecode, args: ['T', 'T'] }), 3_000_000n),
    await inviteTx(admin, nonce + 1, access, 'tablet-code', 600, 1, GRANT_WRITER),
    await inviteTx(admin, nonce + 2, access, 'phone-code', 600, 1, GRANT_READER),
  ]))
  await as(tablet).join(cid, await claimTx(tablet, 0, 'tablet-code', access))
  await as(phone).join(cid, await claimTx(phone, 0, 'phone-code', access))
})
afterAll(async () => {
  for (const f of followers) await f.dispose()
  for (const h of hosts.values()) await (h.service as any)?.node.dispose()
  srv.stop(true)
})

describe('Follower writes', () => {
  test('send shows the local result at once and stores it pending', async () => {
    const k = fresh(), x = fresh().address
    await mint(k.address, 10n)
    const store = new MemoryFollowerStore()
    const seen: number[] = []
    const f = keep(await Follower.open(as(admin), cid, wasm, { store, onPending: (p) => seen.push(p.length) }))
    const before = await cloudHead()
    const r = await transfer(f, k, x, 3n)
    expect(r.status).toBe('0x1')
    expect(await balanceOn(f, x)).toBe(3n)
    const [p] = f.pending()
    expect(p).toMatchObject({ hash: r.transactionHash, from: k.address, nonce: 0, seq: 0, status: 'pending', first: { status: 'success' } })
    expect(p!.first.logs).toHaveLength(1) // Transfer
    expect(await store.listPending(cid)).toEqual(f.pending())
    expect(seen).toEqual([1])
    expect(await cloudHead()).toEqual(before) // nothing submitted yet
    expect(f.head).toEqual(before)
    // a tx the local node refuses throws and stores nothing
    await expect(f.send(await sign(k, 7, token, call('transfer', [x, 1n])))).rejects.toThrow(/nonce/)
    expect(f.pending()).toHaveLength(1)
  })

  test('independent writes from two devices both confirm and each device sees the other\'s', async () => {
    const p = fresh(), q = fresh(), x = fresh().address, y = fresh().address
    await mint(p.address, 5n)
    await mint(q.address, 5n)
    const a = keep(await Follower.open(as(admin), cid, wasm))
    const b = keep(await Follower.open(as(tablet), cid, wasm))
    await transfer(a, p, x, 1n)
    await transfer(b, q, y, 2n)
    await a.sync()
    await b.sync()
    await a.sync()
    expect(a.pending().map((t) => t.status)).toEqual(['confirmed'])
    expect(b.pending().map((t) => t.status)).toEqual(['confirmed'])
    for (const f of [a, b]) {
      expect(await balanceOn(f, x)).toBe(1n)
      expect(await balanceOn(f, y)).toBe(2n)
      expect(f.head).toEqual(await cloudHead())
    }
  })

  test('same key on both devices spending one balance → first confirmed, second re-signed then conflicted with cloud status reverted', async () => {
    const k = fresh(), x = fresh().address, y = fresh().address
    await mint(k.address, 10n)
    const a = keep(await Follower.open(as(admin), cid, wasm, { signer: signers(k) }))
    const b = keep(await Follower.open(as(tablet), cid, wasm, { signer: signers(k) }))
    await transfer(a, k, x, 10n)
    const local = await transfer(b, k, y, 10n)
    expect(local.status).toBe('0x1') // b's page saw success
    await a.sync()
    expect(a.pending()[0]).toMatchObject({ status: 'confirmed' })
    await b.sync()
    const [t] = b.pending()
    expect(t).toMatchObject({ status: 'conflicted', nonce: 1, seq: 0, first: { status: 'success' }, cloud: { status: 'reverted', logs: [] } })
    expect(t!.hash).not.toBe(local.transactionHash) // re-signed
    expect(t!.first.logs).toHaveLength(1) // first never overwritten
    expect(await balanceOn(b, y)).toBe(0n)
    expect(await balanceOn(b, x)).toBe(10n)
  })

  test('a nonce-refused tx and the sender\'s later ones are re-signed after an earlier tx of the batch is mined', async () => {
    const k = fresh(), p = fresh(), x = fresh().address
    await mint(k.address, 10n)
    await mint(p.address, 10n)
    const a = keep(await Follower.open(as(admin), cid, wasm, { signer: signers(k) }))
    const b = keep(await Follower.open(as(tablet), cid, wasm, { signer: signers(k) }))
    await transfer(a, k, x, 1n)
    await transfer(a, k, x, 1n)
    await a.sync() // k's cloud nonce is now 2
    const y = fresh().address // not a's txs again (same key, nonce and call = the same tx)
    await transfer(b, p, y, 1n) // mined
    await transfer(b, k, y, 1n) // nonce 0: too low
    await transfer(b, k, y, 1n) // nonce 1: too low
    await b.sync()
    expect(b.pending().map((t) => [t.status, t.nonce])).toEqual([['confirmed', 0], ['confirmed', 2], ['confirmed', 3]])
    expect(await balanceOn(b, x)).toBe(2n)
    expect(await balanceOn(b, y)).toBe(3n)
  })

  test('without a key for the sender, a nonce refusal is refused with the reason', async () => {
    const k = fresh(), x = fresh().address
    await mint(k.address, 10n)
    const a = keep(await Follower.open(as(admin), cid, wasm))
    const b = keep(await Follower.open(as(tablet), cid, wasm))
    await transfer(a, k, x, 1n)
    await a.sync()
    await transfer(b, k, x, 2n)
    await b.sync()
    expect(b.pending()[0]).toMatchObject({ status: 'refused', reason: expect.stringMatching(/nonce/) })
  })

  test('a broker device submits a tx signed by a key with no chain role → confirmed', async () => {
    const s = fresh()
    const a = keep(await Follower.open(as(admin), cid, wasm))
    await transfer(a, s, fresh().address, 0n)
    await a.sync()
    expect(a.pending()[0]).toMatchObject({ status: 'confirmed', from: s.address })
  })

  test('a pending tx survives reopen (reopenEvery 5) and settles', async () => {
    const k = fresh(), x = fresh().address
    await mint(k.address, 10n)
    const real = as(admin)
    let online = false, states = 0
    const stub = {
      account: admin,
      state: (id: string) => (states++, real.state(id)),
      blocks: (id: string, after: number) => real.blocks(id, after),
      submit: (id: string, txs: Hex[]) => (online ? real.submit(id, txs) : Promise.reject(new NodeError(503, 'down'))),
    } as unknown as NodeClient
    const store = new MemoryFollowerStore()
    const f = keep(await Follower.open(stub, cid, wasm, { reopenEvery: 5, store }))
    await transfer(f, k, x, 4n)
    for (let i = 0; i < 6; i++) await mint(fresh().address, 1n)
    await expect(f.sync()).rejects.toThrow('down') // submit failed; blocks were still pulled
    expect(states).toBe(2) // re-opened from /state
    expect(f.head).toEqual(await cloudHead())
    expect(f.pending()[0]!.status).toBe('pending')
    expect(await balanceOn(f, x)).toBe(4n) // re-run on the new node
    // the app reopened from the store shows it too, offline
    const offline = { state: async () => { throw new Error('network used') } } as unknown as NodeClient
    const g = await Follower.open(offline, cid, wasm, { store })
    expect(g.pending().map((t) => t.status)).toEqual(['pending'])
    expect(await balanceOn(g, x)).toBe(4n)
    await g.dispose()
    online = true
    await f.sync()
    expect(f.pending()[0]!.status).toBe('confirmed')
    expect(await balanceOn(f, x)).toBe(4n)
  })

  test('confirmed copy in the store never includes pending effects', async () => {
    const k = fresh(), x = fresh().address
    await mint(k.address, 10n)
    const real = as(admin)
    const stub = { account: admin, state: (id: string) => real.state(id), blocks: (id: string, a: number) => real.blocks(id, a), submit: () => Promise.reject(new Error('down')) } as unknown as NodeClient
    const store = new MemoryFollowerStore()
    const f = keep(await Follower.open(stub, cid, wasm, { store }))
    await transfer(f, k, x, 2n)
    await mint(fresh().address, 1n) // the cloud moves on
    await f.sync().catch(() => {})
    const head = await cloudHead()
    const saved = (await store.loadConfirmed(cid))!
    expect(saved.head).toEqual(head)
    const n = await createNode({ chainId: 31337, computeStateRoot: true, miningConfig: { type: 'manual' }, engine: await createRevmEngine({ wasm }) })
    await n.loadState(saved.dump)
    expect(await n.getStateRoot()).toBe(head.stateRoot)
    await n.dispose()
    // local view = cloud head + the pending re-run
    expect(f.head).toEqual(head)
    expect(await f.read(async (n) => Number(await n.request({ method: 'eth_blockNumber' })))).toBe(head.number + 1)
    expect(await balanceOn(f, x)).toBe(2n)
    // reopening with that pending tx leaves the stored copy alone
    await (await Follower.open(stub, cid, wasm, { store })).dispose()
    expect((await store.loadConfirmed(cid))!).toEqual(saved)
  })

  test('resend after a lost reply (stub drops the first reply) → confirmed once', async () => {
    const k = fresh(), x = fresh().address
    await mint(k.address, 10n)
    const real = as(admin)
    let drop = true, offline = false, submits = 0
    const stub = {
      account: admin,
      state: (id: string) => real.state(id),
      blocks: (id: string, a: number) => {
        if (offline) { offline = false; return Promise.reject(new Error('offline')) }
        return real.blocks(id, a)
      },
      submit: async (id: string, txs: Hex[]) => {
        submits++
        const r = await real.submit(id, txs)
        if (drop) { drop = false; offline = true; throw new Error('connection reset') }
        return r
      },
    } as unknown as NodeClient
    const f = keep(await Follower.open(stub, cid, wasm))
    const { transactionHash } = await transfer(f, k, x, 1n)
    await expect(f.sync()).rejects.toThrow()
    expect(f.pending()[0]!.status).toBe('pending')
    await f.sync()
    expect(submits).toBe(2)
    expect(f.pending()[0]).toMatchObject({ status: 'confirmed', hash: transactionHash })
    expect((await cloudTxs()).filter((h) => h === transactionHash)).toHaveLength(1)
    expect(await balanceOn(f, x)).toBe(1n)
  })

  test('reader device: send works locally, sync refuses it (not a writer), follower still following', async () => {
    const k = fresh(), x = fresh().address
    await mint(k.address, 10n)
    const seen: string[][] = []
    const f = keep(await Follower.open(as(phone), cid, wasm, { onPending: (p) => seen.push(p.map((t) => t.status)) }))
    await transfer(f, k, x, 1n)
    expect(await balanceOn(f, x)).toBe(1n)
    await f.sync()
    expect(f.status).toBe('following')
    expect(f.pending()[0]).toMatchObject({ status: 'refused', reason: `${phone.address} is not a writer on this chain` })
    expect(await balanceOn(f, x)).toBe(0n) // refused: gone from the local view
    expect(seen).toEqual([['pending'], ['refused']])
    expect(f.head).toEqual(await cloudHead())
    // dismiss clears a settled record
    await f.dismiss(f.pending()[0]!.hash)
    expect(f.pending()).toEqual([])
    expect(seen.at(-1)).toEqual([])
  })

  test('dismiss refuses a pending record', async () => {
    const f = keep(await Follower.open(as(admin), cid, wasm))
    const { transactionHash } = await transfer(f, fresh(), fresh().address, 0n)
    await expect(f.dismiss(transactionHash)).rejects.toThrow(/pending/)
  })

  test('a tx depending on a conflicted one is marked dependsOn', async () => {
    const k = fresh(), z = fresh(), x = fresh().address, w = fresh().address
    await mint(k.address, 10n)
    const a = keep(await Follower.open(as(admin), cid, wasm, { signer: signers(k) }))
    const b = keep(await Follower.open(as(tablet), cid, wasm, { signer: signers(k, z) }))
    await transfer(a, k, x, 10n)
    await transfer(b, k, z.address, 10n)
    await transfer(b, z, w, 10n) // spends what the first one gave
    await a.sync()
    await b.sync()
    const [t1, t2] = b.pending()
    expect(t1).toMatchObject({ status: 'conflicted', cloud: { status: 'reverted' } })
    expect(t2).toMatchObject({ status: 'conflicted', cloud: { status: 'reverted' }, dependsOn: t1!.hash })
    expect(t1!.dependsOn).toBeUndefined()
  })

  test('a 403 while booting via the cloud fallback (unusable stored copy) is FollowerRemoved', async () => {
    const store = new MemoryFollowerStore()
    await (await Follower.open(as(admin), cid, wasm, { store })).dispose()
    const c = (await store.loadConfirmed(cid))!
    await store.saveConfirmed(cid, { ...c, head: { ...c.head, stateRoot: `0x${'11'.repeat(32)}` } })
    await expect(Follower.open(as(fresh()), cid, wasm, { store })).rejects.toBeInstanceOf(FollowerRemoved)
  })

  test('removal → all pending refused (removed from chain), then FollowerRemoved', async () => {
    const r = fresh()
    const c = as(admin)
    const { access } = await c.info(cid)
    mined(await c.submit(cid, [await inviteTx(admin, await c.nonce(cid), access, 'r-code', 600, 1, GRANT_WRITER)]))
    await as(r).join(cid, await claimTx(r, 0, 'r-code', access))
    const f = keep(await Follower.open(as(r), cid, wasm))
    await transfer(f, fresh(), fresh().address, 0n)
    mined(await c.submit(cid, [await sign(admin, await c.nonce(cid), access, encodeFunctionData({ abi: ChainAccess.abi, functionName: 'removeWriter', args: [r.address] }))]))
    const e = await f.sync().catch((x) => x)
    expect(e).toBeInstanceOf(FollowerRemoved)
    expect(f.pending()[0]).toMatchObject({ status: 'refused', reason: 'removed from chain' })
  })
})
