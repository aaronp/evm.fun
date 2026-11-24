import { beforeAll, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { keccak256, type Hex } from 'viem'
import type { SerializedState } from 'webevm'
import { ChainNode, ChainStore, diffState, HEADERS_KEPT, type SerializedBlock } from '../src'
import { bunSql } from './bunSql'
import { balanceSlot, HOLDERS, SENDERS, TOKEN, wasm, workload } from './workload'

const cfg = { wasm, rebuildEvery: 100 }
const BOOT_AT = [99, 100, 101, 250, 350]
const token = TOKEN.toLowerCase()

describe('ChainNode over 350 workload blocks', () => {
  const db = new Database(':memory:')
  const store = new ChainStore(bunSql(db))
  let live: ChainNode
  const boots: { h: number; liveRoot: string; bootRoot: string; liveNext: SerializedBlock; bootNext: SerializedBlock }[] = []
  const zeroed: { h: number; holder: Hex; before: string | undefined; after: string | undefined }[] = []

  beforeAll(async () => {
    const w = workload()
    live = await ChainNode.create(store, await w.genesis(), cfg)
    // txs for blocks 1..351 up front (the workload is sequential), noting which holder each block empties
    const blocks: Hex[][] = [[]]
    const empties: (Hex | undefined)[] = [undefined]
    for (let i = 1; i <= 351; i++) {
      const before = new Map(w.balances)
      blocks.push(await w.nextBlock(i))
      empties.push([...before].find(([h, bal]) => bal > 0n && w.balances.get(h) === 0n)?.[0] as Hex | undefined)
    }
    let pending: Omit<(typeof boots)[number], 'liveNext'> | undefined
    for (let i = 1; i <= 351; i++) {
      const holder = empties[i]
      const slotBefore = holder && store.stateDump().storage[token]?.[balanceSlot(holder)]
      const blk = (await live.apply(w.timestamp(i), blocks[i]!)).block!
      if (pending) boots.push({ ...pending, liveNext: blk.header }), (pending = undefined)
      if (holder) zeroed.push({ h: i, holder, before: slotBefore, after: store.stateDump().storage[token]?.[balanceSlot(holder)] })
      if (BOOT_AT.includes(i)) {
        // boot from a copy of the store, so the booted node can commit the next block too
        const booted = await ChainNode.boot(new ChainStore(bunSql(Database.deserialize(db.serialize()))), cfg)
        const [liveRoot, bootRoot] = [await live.stateRoot(), await booted.stateRoot()]
        const bootNext = (await booted.apply(w.timestamp(i + 1), blocks[i + 1]!)).block!.header
        pending = { h: i, liveRoot, bootRoot, bootNext }
      }
    }
  }, 120_000)

  test('a fresh boot matches the live node', () => {
    expect(boots.map((b) => b.h)).toEqual(BOOT_AT)
    for (const b of boots) {
      expect(b.bootRoot).toBe(b.liveRoot)
      expect(b.bootNext.hash).toBe(b.liveNext.hash)
      expect(b.bootNext.stateRoot).toBe(b.liveNext.stateRoot)
    }
  })

  test('a zeroed balance leaves the store', () => {
    expect(zeroed.length).toBeGreaterThan(10)
    for (const z of zeroed) {
      expect(z.before).toBeDefined()
      expect(z.after).toBeUndefined()
    }
  })

  test('rebuild resets history', async () => {
    expect(live.blocksSinceRebuild).toBeLessThan(100)
    // last rebuild at 300: the node holds HEADERS_KEPT headers + the 51 blocks since (a never-rebuilt node holds 352)
    expect((await live.read((n) => n.dumpState())).blocks.length).toBeLessThanOrEqual(HEADERS_KEPT + (351 % 100) + 1)
    expect(live.head().number).toBe(351)
  })
})

const signed = (from: (typeof SENDERS)[number], nonce: number, extra: object = {}) =>
  from.signTransaction({ type: 'eip1559', chainId: 777, nonce, to: SENDERS[2]!.address, value: 1n, gas: 21_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, ...extra })

/** Two nodes on one genesis, five workload blocks in: `a` under test, `ref` the reference. */
async function pair() {
  const w = workload()
  const genesis = await w.genesis()
  const store = new ChainStore(bunSql())
  const a = await ChainNode.create(store, genesis, cfg)
  const ref = await ChainNode.create(new ChainStore(bunSql()), genesis, cfg)
  for (let i = 1; i <= 5; i++) {
    const txs = await w.nextBlock(i)
    await a.apply(w.timestamp(i), txs)
    await ref.apply(w.timestamp(i), txs)
  }
  return { w, store, a, ref, nonce: async (i: number) => Number(await a.read((n) => n.request({ method: 'eth_getTransactionCount', params: [SENDERS[i]!.address, 'latest'] }))) }
}

test('apply mines valid txs and reports a bad-nonce tx without failing the block', async () => {
  const { w, a, ref, nonce } = await pair()
  const good = await w.nextBlock(6)
  const n3 = await nonce(3)
  // webevm (manual mining) accepts these at send and refuses them only at mine, taking the whole batch down
  const low = await signed(SENDERS[3]!, n3 - 1)
  const gap = await signed(SENDERS[3]!, n3 + 1)
  const broke = await signed(SENDERS[3]!, n3, { value: 10n ** 30n })
  // refused for funds, so its nonce is never queued: the sender's next nonce is a gap
  const after = await signed(SENDERS[3]!, n3 + 1)
  const { block, results } = await a.apply(w.timestamp(6), [low, ...good, gap, broke, after])
  const theirs = (await ref.apply(w.timestamp(6), good)).block!
  expect(block!.header.hash).toBe(theirs.header.hash)
  expect(block!.txs).toEqual(good)
  expect(results.map((r) => r.ok)).toEqual([false, ...good.map(() => true), false, false, false])
  expect(results.map((r) => r.hash)).toEqual([low, ...good, gap, broke, after].map((t) => keccak256(t)))
  const errors = results.flatMap((r) => (r.ok ? [] : [r.error]))
  expect(errors[0]).toMatch(/^nonce too low/)
  expect(errors[1]).toMatch(/^nonce too high/)
  expect(errors[2]).toMatch(/^insufficient funds/)
  expect(errors[3]).toMatch(/^nonce too high/)
}, 30_000)

test('apply with only bad txs mines nothing', async () => {
  const { w, store, a, ref, nonce } = await pair()
  const n1 = await nonce(1)
  const [head, root, dump] = [a.head(), await a.stateRoot(), store.stateDump()]
  // too low and too high (refused at mine by webevm), intrinsic gas too low (refused at send), not a tx
  const bad = [await signed(SENDERS[1]!, n1 - 1), await signed(SENDERS[1]!, n1 + 1), await signed(SENDERS[1]!, n1, { gas: 100n }), '0x1234' as Hex]
  const { block, results } = await a.apply(w.timestamp(6), bad)
  expect(block).toBeUndefined()
  expect(results.map((r) => r.ok)).toEqual([false, false, false, false])
  expect(a.head()).toEqual(head)
  expect(await a.stateRoot()).toBe(root)
  expect(store.stateDump()).toEqual(dump)
  // nothing left behind in the node: the next block is exactly the reference's
  const good = await w.nextBlock(6)
  const [mine, theirs] = [(await a.apply(w.timestamp(6), good)).block!, (await ref.apply(w.timestamp(6), good)).block!]
  expect(mine.header.hash).toBe(theirs.header.hash)
}, 30_000)

test('concurrent applies run one at a time; each block holds exactly its own txs; a fresh boot matches', async () => {
  const w = workload()
  const db = new Database(':memory:')
  const store = new ChainStore(bunSql(db))
  const n = await ChainNode.create(store, await w.genesis(), cfg)
  const t = [[], await w.nextBlock(1), await w.nextBlock(2), await w.nextBlock(3)] as Hex[][]
  await n.apply(w.timestamp(1), t[1]!)
  const [b2, b3] = (await Promise.all([n.apply(w.timestamp(2), t[2]!), n.apply(w.timestamp(3), t[3]!)])).map((r) => r.block!)
  for (const [b, i] of [[b2, 2], [b3, 3]] as const) {
    expect(b.header.number).toBe(i)
    expect(b.txs).toEqual(t[i]!)
    expect(b.header.transactions.length).toBe(t[i]!.length)
    expect(b.receipts.length).toBe(t[i]!.length)
  }
  expect(store.blocks(2, 3).map((b) => b.txs)).toEqual([t[2]!, t[3]!])
  const booted = await ChainNode.boot(new ChainStore(bunSql(Database.deserialize(db.serialize()))), cfg)
  expect(await booted.stateRoot()).toBe(await n.stateRoot())
}, 30_000)

test('read during an apply (and its due rebuild) waits and sees a live node with the new block', async () => {
  const w = workload()
  const n = await ChainNode.create(new ChainStore(bunSql()), await w.genesis(), { wasm, rebuildEvery: 1 })
  await n.apply(w.timestamp(1), await w.nextBlock(1))
  const txs = await w.nextBlock(2)
  const applying = n.apply(w.timestamp(2), txs)
  const height = await n.read((node) => node.request({ method: 'eth_blockNumber' }))
  expect(BigInt(height as string)).toBe(2n)
  await applying
}, 30_000)

test('a block that would mine a tx not sent by this apply is rejected and rolled back', async () => {
  const w = workload()
  const store = new ChainStore(bunSql())
  const n = await ChainNode.create(store, await w.genesis(), cfg)
  await n.apply(w.timestamp(1), await w.nextBlock(1))
  const [head, dump] = [n.head(), store.stateDump()]
  const stray = await HOLDERS[7]!.signTransaction({ type: 'eip1559', chainId: 777, nonce: 0, to: SENDERS[2]!.address, value: 0n, gas: 21_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })
  await n.read((node) => node.request({ method: 'eth_sendRawTransaction', params: [stray] }))
  await expect(n.apply(w.timestamp(2), await w.nextBlock(2))).rejects.toThrow('are not the sent txs')
  expect(n.head()).toEqual(head)
  expect(store.stateDump()).toEqual(dump)
}, 30_000)

test('boot on a store with no chain says so', async () => {
  await expect(ChainNode.boot(new ChainStore(bunSql()), cfg)).rejects.toThrow('no chain: call create first')
})

describe('diffState', () => {
  const A = '0xaa', B = '0xbb', C = '0xcc', S1 = '0x01', S2 = '0x02'
  const st = (p: Partial<SerializedState>): SerializedState => ({
    version: 1, chainId: 1, accounts: {}, code: {}, storage: {}, blocks: [], receipts: {}, transactions: {}, ...p,
  })

  test('added, changed and removed accounts and code', () => {
    const d = diffState(
      st({ accounts: { [A]: '1', [B]: '2' }, code: { [A]: 'c' } }),
      st({ accounts: { [A]: '1', [B]: '3', [C]: '4' }, code: {} }),
    )
    expect(d.accounts).toEqual({ [B]: '3', [C]: '4' })
    expect(d.code).toEqual({ [A]: null })
    expect(d.storage).toEqual({})
  })

  test('a removed account', () => {
    expect(diffState(st({ accounts: { [A]: '1' } }), st({})).accounts).toEqual({ [A]: null })
  })

  test('a removed slot and a changed slot', () => {
    const d = diffState(st({ storage: { [A]: { [S1]: '1', [S2]: '2' } } }), st({ storage: { [A]: { [S2]: '5' } } }))
    expect(d.storage).toEqual({ [A]: { [S1]: null, [S2]: '5' } })
  })

  test('a slot written to zero is removed; a zero slot is never stored', () => {
    const d = diffState(st({ storage: { [A]: { [S1]: '0x01' } } }), st({ storage: { [A]: { [S1]: '0x' }, [B]: { [S2]: '0x00' } } }))
    expect(d.storage).toEqual({ [A]: { [S1]: null } })
  })

  test('a removed storage map clears each old slot', () => {
    const d = diffState(st({ storage: { [A]: { [S1]: '1', [S2]: '2' }, [B]: { [S1]: '1' } } }), st({ storage: { [B]: { [S1]: '1' } } }))
    expect(d.storage).toEqual({ [A]: { [S1]: null, [S2]: null } })
  })
})
