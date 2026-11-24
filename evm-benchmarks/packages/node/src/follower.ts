// A device's copy of a cloud chain: boots from GET /state, replays GET /blocks, checks each block's hash and state root.
// Writes run locally at once as "pending", go to the cloud by POST /submit, and settle from the cloud's receipts.
import { getAddress, keccak256, parseTransaction, type Address, type Hex, type LocalAccount, type RpcTransactionReceipt } from 'viem'
import { createNode, type SerializedReceipt, type SerializedState, type SlimNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { MAX_SUBMIT_BYTES, NodeError, type BlockRecord, type BlockSummary, type NodeClient } from './client'
import { nodeOptions, type NodeConfig } from './node'
import type { FollowerStore, Outcome, PendingTx } from './followerStore'

const HEADERS_KEPT = 256 // as the cloud's /state dump
/** Txs per submit (docs/spikes/cf-throughput.md). */
export const DEFAULT_BATCH = 25
const RESIGN_ROUNDS = 3 // nonce re-sign → resubmit rounds per sync; what is left waits for the next sync

export type Receipt = RpcTransactionReceipt
export interface FollowerOptions {
  /** After that many replayed blocks, start a fresh node from GET /state (bounds memory). Default 1000. */
  reopenEvery?: number
  store?: FollowerStore
  /** Store key (default: the chain id). */
  key?: string
  /** The key a pending tx's sender signs with, to re-sign it with a fresh nonce after a `nonce` refusal. */
  signer?: (from: Address) => LocalAccount | undefined
  /** Txs per submit (default `DEFAULT_BATCH`). */
  batch?: number
  /** Called with the whole list after any change to it (send, settle, refuse, dismiss). */
  onPending?: (txs: PendingTx[]) => void
}

type Log = { address: string; topics: readonly string[]; data: string }
const outcome = (r: { status: string | number; logs: readonly Log[] }): Outcome => ({
  status: r.status === 1 || r.status === '0x1' || r.status === 'success' ? 'success' : 'reverted',
  logs: r.logs.map((l) => ({ address: l.address.toLowerCase() as Address, topics: l.topics.map((t) => t.toLowerCase()) as Hex[], data: l.data.toLowerCase() as Hex })),
})
const same = (a: Outcome, b: Outcome) => JSON.stringify(a) === JSON.stringify(b)

/** This device is no longer a member of the chain (the cloud answered 403). */
export class FollowerRemoved extends Error {
  constructor(chainId: string) { super(`removed from chain ${chainId}`) }
}

/** The local copy differs from the cloud's (root, hash or head). */
export class FollowerMismatch extends Error {}

/**
 * Keeps a local webevm node in step with a cloud chain. `sync` and `read` run one at a time.
 * After a removal or a mismatch the follower is stopped: `sync` and `read` throw that error again (after `dispose`, a "disposed" error).
 */
export class Follower {
  status: 'following' | 'removed' | 'mismatch' = 'following'
  #failure?: Error
  #queue: Promise<unknown> = Promise.resolve()
  /** The cloud's head as last seen (by `open` or `sync`). */
  cloudHead: BlockSummary

  #saved?: string // hash of the head last written to the store
  #replayed = 0 // blocks replayed on the current node
  #txs: PendingTx[] = [] // pending and settled-but-not-dismissed records, in seq order
  #seq = 0
  #base?: SerializedState // the node's confirmed state, while local (pending) blocks sit on top of it
  #minedAt = new Map<Hex, number>() // submit said mined in this block
  #dirty = false // the list changed since onPending last ran
  private reopenEvery: number
  private store?: FollowerStore
  private key: string

  private constructor(private client: NodeClient, readonly chainId: string, private wasm: NodeConfig['wasm'], private o: FollowerOptions,
    private node: SlimNode, private env: { timestamp?: bigint }, public head: BlockSummary) {
    this.cloudHead = head
    this.reopenEvery = o.reopenEvery ?? 1000
    this.store = o.store
    this.key = o.key ?? chainId
  }

  /** Boots from the stored confirmed copy (no network) or the cloud, then re-runs the stored pending txs on top. */
  static async open(client: NodeClient, chainId: string, wasm: NodeConfig['wasm'], o: FollowerOptions = {}): Promise<Follower> {
    const key = o.key ?? chainId
    const stored = await o.store?.loadConfirmed(key)
    let booted
    let fromStore = false
    if (stored) {
      try {
        booted = await Follower.#boot(client, chainId, wasm, stored)
        fromStore = true
      } catch (e) { // unusable stored copy: boot from the cloud and overwrite it; if that fails too, report both
        try { booted = await Follower.#boot(client, chainId, wasm) } catch (c) {
          if (c instanceof FollowerRemoved) throw c
          if (e instanceof Error) e.message += `; booting from the cloud failed too: ${c instanceof Error ? c.message : c}`
          throw e
        }
      }
    } else booted = await Follower.#boot(client, chainId, wasm)
    const { node, env, head, dump } = booted
    const f = new Follower(client, chainId, wasm, o, node, env, head)
    try {
      if (fromStore) f.#saved = head.hash
      else await f.#save(dump)
      f.#txs = (await o.store?.listPending(key)) ?? []
      f.#seq = Math.max(-1, ...f.#txs.map((t) => t.seq)) + 1
      await f.#rerun()
    } catch (e) { await f.node.dispose(); throw e }
    return f
  }

  static async #boot(client: NodeClient, chainId: string, wasm: NodeConfig['wasm'], stored?: { head: BlockSummary; dump: SerializedState }) {
    const { head, dump } = stored ?? await client.state(chainId).catch((e) => {
      throw e instanceof NodeError && e.status === 403 ? new FollowerRemoved(chainId) : e
    })
    const env = {}
    const node = await createNode({ chainId: dump.chainId, ...nodeOptions(env), engine: await createRevmEngine({ wasm }) })
    try {
      const last = dump.blocks.at(-1)
      if (stored && last && (last.number !== head.number || last.hash !== head.hash)) throw new FollowerMismatch(`stored head ${head.number} (${head.hash}) is not the last block of its dump (${last.number})`)
      await node.loadState(dump)
      const root = await node.getStateRoot()
      if (root !== head.stateRoot) throw new FollowerMismatch(`state of chain ${chainId} at block ${head.number}: local root ${root}, cloud root ${head.stateRoot}`)
    } catch (e) {
      await node.dispose()
      throw e
    }
    return { node, env, head, dump }
  }

  /** Swap in a node booted from the cloud's current state; it must extend our head. */
  async #reopen() {
    const next = await Follower.#boot(this.client, this.chainId, this.wasm).catch((e) => {
      if (e instanceof FollowerRemoved) this.#stop('removed', e)
      if (e instanceof FollowerMismatch) this.#stop('mismatch', e)
      throw e
    })
    const ours = next.dump.blocks.find((b) => b.number === this.head.number)
    if (next.head.number < this.head.number || (ours && ours.hash !== this.head.hash)) {
      await next.node.dispose()
      this.#stop('mismatch', new FollowerMismatch(`cloud state at block ${next.head.number} does not extend our head ${this.head.number} (${this.head.hash})`))
    }
    const old = this.node
    Object.assign(this, { node: next.node, env: next.env, head: next.head, cloudHead: next.head })
    this.#replayed = 0
    await old.dispose()
  }

  #serial<T>(fn: () => Promise<T>, evenStopped = false): Promise<T> {
    const run = this.#queue.then(() => {
      if (this.#failure && !evenStopped) throw this.#failure
      return fn()
    })
    this.#queue = run.catch(() => {})
    return run
  }

  #stop(status: 'removed' | 'mismatch', e: Error): never {
    this.status = status
    throw (this.#failure = e)
  }

  /**
   * Submit the pending txs, replay the cloud's new blocks onto the confirmed state (and store it), settle each pending tx
   * mined in them, re-sign and resubmit nonce refusals, then re-run what is still pending on top.
   * A failed submit still pulls and re-runs, then rejects with that error; the txs stay pending.
   */
  sync(): Promise<BlockSummary> {
    return this.#serial(async () => {
      let failed: unknown
      const denied: PendingTx[] = []
      try {
        let r = await this.#submit()
        await this.#pull()
        for (let i = 0; r.nonce.size && !r.error && i < RESIGN_ROUNDS; i++) {
          denied.push(...r.denied)
          await this.#resign(r.nonce)
          r = await this.#submit()
          await this.#pull()
        }
        denied.push(...r.denied)
        failed = r.error
        // still a member (the pull would have thrown FollowerRemoved): this device may read but not write
        const who = this.client.account?.address ?? 'this device'
        for (const t of denied) await this.#settle(t, { status: 'refused', reason: `${who} is not a writer on this chain` })
      } catch (e) {
        if (e instanceof FollowerRemoved) for (const t of this.#txs) if (t.status === 'pending') await this.#settle(t, { status: 'refused', reason: 'removed from chain' })
        throw e
      } finally {
        if (this.status === 'following') await this.#rerun()
        this.#notify()
      }
      if (failed) throw failed
      return this.head
    })
  }

  /** Back to the confirmed state, then fetch and replay every block after our head, a page at a time, until caught up. */
  async #pull() {
    await this.#toConfirmed()
    for (;;) {
      const page = await this.client.blocks(this.chainId, this.head.number).catch((e) => {
        if (e instanceof NodeError && e.status === 403) this.#stop('removed', new FollowerRemoved(this.chainId))
        throw e // transient: still following
      })
      this.cloudHead = page.head
      // never silently follow a different chain: an empty page must end at our head
      if (!page.blocks.length && (page.head.number < this.head.number || (page.head.number === this.head.number && page.head.hash !== this.head.hash)))
        this.#stop('mismatch', new FollowerMismatch(`cloud head ${page.head.number} (${page.head.hash}) does not match our head ${this.head.number} (${this.head.hash})`))
      for (const b of page.blocks) {
        await this.#replay(b)
        await this.#settleFrom(b)
      }
      if (this.#replayed >= this.reopenEvery) await this.#reopen()
      await this.#save() // not by page: retries a failed save; #reopen relies on this too
      if (!page.blocks.length || this.head.number >= page.head.number) break
    }
    // mined in a block we never replayed (booted past it from /state): settle from that block
    for (const [hash, block] of this.#minedAt) {
      if (block > this.head.number || !this.#txs.some((t) => t.hash === hash && t.status === 'pending')) continue
      const b = (await this.client.blocks(this.chainId, block - 1)).blocks[0]
      if (b) await this.#settleFrom(b)
    }
    this.#minedAt.clear()
  }

  /** Settle each pending tx this block mined: same outcome as its first local run → confirmed, else conflicted. */
  async #settleFrom(b: BlockRecord) {
    for (const r of b.receipts as SerializedReceipt[]) {
      const t = this.#txs.find((t) => t.status === 'pending' && t.hash.toLowerCase() === r.transactionHash.toLowerCase())
      if (!t) continue
      const cloud = outcome(r)
      await this.#settle(t, same(cloud, t.first) ? { status: 'confirmed', block: b.header.number } : { status: 'conflicted', block: b.header.number, cloud })
    }
  }

  /** POST the pending txs in seq order, in batches. Stops at the first failed batch; a 403 marks it and the rest `denied`. */
  async #submit(): Promise<{ nonce: Map<PendingTx, string>; denied: PendingTx[]; error?: unknown }> {
    const todo = this.#txs.filter((t) => t.status === 'pending')
    const nonce = new Map<PendingTx, string>()
    const size = (t: PendingTx) => t.raw.length + 3 // quotes and comma in {"txs":[...]}
    for (let i = 0; i < todo.length;) {
      if (size(todo[i]!) + 9 > MAX_SUBMIT_BYTES) {
        await this.#settle(todo[i++]!, { status: 'refused', reason: `larger than the ${MAX_SUBMIT_BYTES}-byte submit limit` })
        continue
      }
      const batch: PendingTx[] = []
      for (let bytes = 9; i < todo.length && batch.length < (this.o.batch ?? DEFAULT_BATCH) && bytes + size(todo[i]!) <= MAX_SUBMIT_BYTES; bytes += size(todo[i++]!)) batch.push(todo[i]!)
      let r
      try {
        r = await this.client.submit(this.chainId, batch.map((t) => t.raw))
      } catch (e) {
        if (e instanceof NodeError && e.status === 403) return { nonce, denied: todo.slice(i - batch.length) }
        return { nonce, denied: [], error: e }
      }
      for (const [j, x] of r.results.entries()) {
        const t = batch[j]!
        if (x.result === 'mined') this.#minedAt.set(t.hash, x.block)
        else if (x.code === 'nonce') nonce.set(t, x.reason)
        else await this.#settle(t, { status: 'refused', reason: x.reason })
      }
    }
    return { nonce, denied: [] }
  }

  /**
   * Re-sign each nonce-refused tx and its sender's later pending ones with the sender's next nonces on the confirmed
   * state (the node is there between #pull and #rerun). Keeps `first` and `seq`. No key for the sender → refused.
   */
  async #resign(refused: Map<PendingTx, string>) {
    for (const from of new Set([...refused.keys()].map((t) => t.from))) {
      const key = this.o.signer?.(from)
      const mine = [...refused.keys()].filter((t) => t.from === from)
      if (!key) {
        for (const t of mine) await this.#settle(t, { status: 'refused', reason: refused.get(t)! })
        continue
      }
      const firstSeq = Math.min(...mine.map((t) => t.seq))
      let n = Number(await this.node.request({ method: 'eth_getTransactionCount', params: [from, 'latest'] }))
      for (const t of this.#txs.filter((t) => t.status === 'pending' && t.from === from && t.seq >= firstSeq)) {
        const { r: _r, s: _s, v: _v, yParity: _y, ...tx } = parseTransaction(t.raw)
        const raw = await key.signTransaction({ ...tx, nonce: n } as never)
        const old = t.hash
        Object.assign(t, { raw, nonce: n++, hash: keccak256(raw) })
        await this.#put(t) // new record first, so a crash between the two keeps it
        if (t.hash !== old) await this.store?.deletePending(this.key, old)
      }
    }
  }

  /**
   * Re-run the still-pending txs on top of the confirmed state, each in its own local block. Then mark a tx that
   * conflicted, or whose re-run differs from its first run, as depending on the latest earlier conflicted one.
   */
  async #rerun() {
    const runs = new Map<PendingTx, Outcome | undefined>()
    for (const t of this.#txs) if (t.status === 'pending') runs.set(t, await this.#local(t.raw).then(outcome, () => undefined))
    // ponytail: "depends on" = an earlier conflicted tx of this device, not a traced read/write overlap
    let conflict: Hex | undefined
    for (const t of this.#txs) {
      const run = runs.get(t)
      const differs = t.status === 'conflicted' || (runs.has(t) && !(run && same(run, t.first)))
      if (differs && conflict && !t.dependsOn) await this.#settle(t, { dependsOn: conflict })
      if (t.status === 'conflicted') conflict = t.hash
    }
  }

  /** Run one tx in a local block on top of the node's head (a preview: never sent anywhere). */
  async #local(raw: Hex): Promise<Receipt> {
    this.#base ??= await this.node.dumpState()
    const last = (await this.node.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })) as { timestamp: Hex }
    this.env.timestamp = BigInt(Math.max(Math.floor(Date.now() / 1000), Number(last.timestamp) + 1))
    const hash = await this.node.request({ method: 'eth_sendRawTransaction', params: [raw] })
    await this.node.mine() // a refused tx leaves no block and an empty pool
    return (await this.node.request({ method: 'eth_getTransactionReceipt', params: [hash] })) as Receipt
  }

  /** Drop the local blocks: back to the confirmed state, on a fresh node. */
  async #toConfirmed() {
    if (!this.#base) return
    // not loadState on this node: webevm 0.9.1 keeps accounts the dump does not have (a sender first seen in a local block)
    const env = {}
    const node = await createNode({ chainId: this.#base.chainId, ...nodeOptions(env), engine: await createRevmEngine({ wasm: this.wasm }) })
    try { await node.loadState(this.#base) } catch (e) { await node.dispose(); throw e }
    const old = this.node
    Object.assign(this, { node, env })
    this.#base = undefined
    await old.dispose()
  }

  async #settle(t: PendingTx, patch: Partial<PendingTx>) {
    Object.assign(t, patch)
    await this.#put(t)
  }

  async #put(t: PendingTx) {
    this.#dirty = true
    await this.store?.putPending(this.key, t)
  }

  #notify() {
    if (!this.#dirty) return
    this.#dirty = false
    this.o.onPending?.(this.pending())
  }

  /**
   * Run `raw` on the local copy now and keep it as pending (stored before this returns); `sync` submits it.
   * A tx the local node refuses throws and is not kept.
   */
  send(raw: Hex): Promise<Receipt> {
    return this.#serial(async () => {
      const r = await this.#local(raw)
      const t: PendingTx = { hash: r.transactionHash, raw, from: getAddress(r.from), nonce: parseTransaction(raw).nonce ?? 0, seq: this.#seq++, first: outcome(r), status: 'pending' }
      this.#txs.push(t)
      try {
        await this.#put(t)
      } catch (e) { // not stored: undo it locally too
        this.#txs.pop()
        await this.#toConfirmed()
        await this.#rerun()
        throw e
      }
      this.#notify()
      return r
    })
  }

  /** The pending records and the settled ones not yet dismissed, in seq order (copies). */
  pending(): PendingTx[] {
    return structuredClone(this.#txs)
  }

  /** Forget a settled record (works after a removal too). */
  dismiss(hash: Hex): Promise<void> {
    return this.#serial(async () => {
      const t = this.#txs.find((t) => t.hash === hash)
      if (!t) return
      if (t.status === 'pending') throw new Error(`tx ${hash} is still pending`)
      await this.store?.deletePending(this.key, hash)
      this.#txs.splice(this.#txs.indexOf(t), 1)
      this.#dirty = true
      this.#notify()
    }, true)
  }

  /** Store the confirmed copy, trimmed to what loadState needs (state + recent headers), so it stays bounded. */
  async #save(dump?: SerializedState) {
    if (!this.store || this.#saved === this.head.hash) return
    dump ??= await this.node.dumpState()
    await this.store.saveConfirmed(this.key, { head: this.head, dump: { ...dump, blocks: dump.blocks.slice(-HEADERS_KEPT), receipts: {}, transactions: {} } })
    this.#saved = this.head.hash
  }

  async #replay({ header, txs }: BlockRecord) {
    const at = `block ${header.number}`
    if (header.parentHash !== this.head.hash) this.#stop('mismatch', new FollowerMismatch(`${at} does not extend our head ${this.head.number} (${this.head.hash})`))
    let mined: { blockHash: string; stateRoot: string }
    try {
      this.env.timestamp = BigInt(header.timestamp)
      for (const raw of txs) await this.node.request({ method: 'eth_sendRawTransaction', params: [raw] })
      mined = { blockHash: (await this.node.mine()).blockHash, stateRoot: await this.node.getStateRoot() }
    } catch (e) {
      return this.#stop('mismatch', new FollowerMismatch(`${at}: replay failed (cloud root ${header.stateRoot}): ${e instanceof Error ? e.message : e}`))
    }
    if (mined.stateRoot !== header.stateRoot) this.#stop('mismatch', new FollowerMismatch(`${at}: local root ${mined.stateRoot}, cloud root ${header.stateRoot}`))
    if (mined.blockHash !== header.hash) this.#stop('mismatch', new FollowerMismatch(`${at}: local hash ${mined.blockHash}, cloud hash ${header.hash} (roots match: ${header.stateRoot})`))
    this.head = { number: header.number, hash: header.hash, stateRoot: header.stateRoot }
    this.#replayed++
  }

  /** Run `fn` on the local node, between syncs. Throws once the follower is removed or mismatched. */
  read<T>(fn: (node: SlimNode) => Promise<T>): Promise<T> {
    return this.#serial(() => fn(this.node))
  }

  dispose(): Promise<void> {
    const run = this.#queue.then(() => {
      this.#failure ??= new Error('follower disposed')
      return this.node.dispose()
    })
    this.#queue = run.catch(() => {})
    return run
  }
}
