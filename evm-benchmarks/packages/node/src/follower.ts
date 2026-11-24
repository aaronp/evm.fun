// A device's copy of a cloud chain: boots from GET /state, replays GET /blocks, checks each block's hash and state root.
// Writes run locally at once as "pending", go to the cloud by POST /submit, and settle from the cloud's receipts.
import { getAddress, keccak256, parseTransaction, type Address, type Hex, type LocalAccount, type RpcTransactionReceipt } from 'viem'
import { createNode, type SerializedReceipt, type SerializedState, type SlimNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { MAX_SUBMIT_BYTES, NodeError, type BlockRecord, type BlockSummary, type NodeClient } from './client'
import { nodeOptions, type NodeConfig } from './node'
import type { Confirmed, FollowerStore, Outcome, PendingTx } from './followerStore'

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
const outcome = (r: { status: string | number; logs: readonly Log[]; contractAddress?: string | null }): Outcome => ({
  status: r.status === 1 || r.status === '0x1' || r.status === 'success' ? 'success' : 'reverted',
  logs: r.logs.map((l) => ({ address: l.address.toLowerCase() as Address, topics: l.topics.map((t) => t.toLowerCase()) as Hex[], data: l.data.toLowerCase() as Hex })),
  ...(r.contractAddress && { contractAddress: r.contractAddress.toLowerCase() as Address }),
})
/** Same status and logs, and the same new contract (a re-signed deploy lands elsewhere). An outcome stored without the field matches any. */
const same = (a: Outcome, b: Outcome) => a.status === b.status && JSON.stringify(a.logs) === JSON.stringify(b.logs)
  && (!('contractAddress' in a) || !('contractAddress' in b) || a.contractAddress === b.contractAddress)
const removedReason = (t: PendingTx) => (t.mayBeMined ? 'removed from chain — it may have been mined before removal' : 'removed from chain')
const goneReason = (t: PendingTx) => (t.mayBeMined ? 'chain deleted in the cloud — it may have been mined before it was deleted' : 'chain deleted in the cloud')

type Pass = { done: Promise<BlockSummary>; late: boolean; next?: Promise<BlockSummary> }

/** This device is no longer a member of the chain (the cloud answered 403). */
export class FollowerRemoved extends Error {
  constructor(chainId: string) { super(`removed from chain ${chainId}`) }
}

/** The worker's answer for a chain it doesn't have (router.ts); any other 404 (unknown route, a proxy) is transient. */
export const noSuchChain = (e: unknown) => e instanceof NodeError && e.status === 404 && e.error === 'no such chain'

/** The cloud chain was deleted (the worker answered 404 "no such chain"). */
export class FollowerGone extends Error {
  constructor() { super('This chain no longer exists') }
}

/** The local copy differs from the cloud's (root, hash or head). */
export class FollowerMismatch extends Error {}

/**
 * Keeps a local webevm node in step with a cloud chain. Node and store work runs one step at a time; `sync` does its
 * requests between its steps, so `send` and `read` never wait on the network. One `sync` runs at a time (a second call joins it).
 * After a removal, a mismatch or the cloud chain's deletion the follower is stopped: `sync` and `read` throw that error again (after `dispose`, a "disposed" error).
 */
export class Follower {
  status: 'following' | 'removed' | 'mismatch' | 'gone' = 'following'
  #failure?: Error
  #queue: Promise<unknown> = Promise.resolve()
  /** The cloud's head as last seen (by `open` or `sync`). */
  cloudHead: BlockSummary
  /**
   * When this device last caught up with the cloud (ms): a sync's pull, a cloud boot, or the stored copy's `savedAt`.
   * The copy is stored only when the head moves, so after a reopen this is the last head change (it errs on the old side).
   */
  lastSynced?: number
  /** Booted from the stored copy (no network) rather than the cloud. */
  fromStore = false

  #saved?: string // hash of the head last written to the store
  #replayed = 0 // blocks replayed on the current node
  #txs: PendingTx[] = [] // pending and settled-but-not-dismissed records, in seq order
  #seq = 0
  #base?: SerializedState // the node's confirmed state, while local (pending) blocks sit on top of it
  #minedAt = new Map<Hex, number>() // submit said mined in this block
  #dirty = false // the list changed since onPending last ran
  #stale = false // a record settled since the local view was last rebuilt
  /** The running sync pass. `late`: a tx was sent after it last planned a submit; `next`: the one follow-up its callers share. */
  #pass?: Pass
  #disposed = false
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
        booted = await Follower.#boot(chainId, wasm, stored, true)
        fromStore = true
      } catch (e) { // unusable stored copy: boot from the cloud and overwrite it; if that fails too, report both
        try { booted = await Follower.#boot(chainId, wasm, await Follower.#state(client, chainId)) } catch (c) {
          if (c instanceof FollowerRemoved || c instanceof FollowerGone) { // no Follower will exist to show it: refuse the stored pending now
            const why = c instanceof FollowerGone ? goneReason : removedReason
            for (const t of await o.store!.listPending(key)) if (t.status === 'pending') await o.store!.putPending(key, { ...t, status: 'refused', reason: why(t) })
            throw c
          }
          if (e instanceof Error) e.message += `; booting from the cloud failed too: ${c instanceof Error ? c.message : c}`
          throw e
        }
      }
    } else booted = await Follower.#boot(chainId, wasm, await Follower.#state(client, chainId))
    const { node, env, head, dump } = booted
    const f = new Follower(client, chainId, wasm, o, node, env, head)
    f.lastSynced = fromStore ? stored!.savedAt : Date.now()
    f.fromStore = fromStore
    try {
      if (fromStore) f.#saved = head.hash
      else await f.#save(dump)
      f.#txs = (await o.store?.listPending(key)) ?? []
      // never backwards, even after the newest records were dismissed: settledAt holds the counter's old values
      f.#seq = Math.max(0, ...f.#txs.map((t) => Math.max(t.seq + 1, t.settledAt ?? 0)))
      await f.#rerun()
    } catch (e) { await f.node.dispose(); throw e }
    return f
  }

  static #state(client: NodeClient, chainId: string): Promise<Confirmed> {
    return client.state(chainId).catch((e) => {
      throw e instanceof NodeError && e.status === 403 ? new FollowerRemoved(chainId) : noSuchChain(e) ? new FollowerGone() : e
    })
  }

  static async #boot(chainId: string, wasm: NodeConfig['wasm'], { head, dump }: Confirmed, stored = false) {
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

  /** Swap in a node booted from the cloud's current state (fetched outside the queue); it must extend our head. Stores it. */
  async #reopen() {
    const s = await Follower.#state(this.client, this.chainId).catch((e) => {
      if (e instanceof FollowerRemoved) this.#stop('removed', e)
      if (e instanceof FollowerGone) this.#stop('gone', e)
      throw e
    })
    await this.#serial(async () => {
      await this.#toConfirmed()
      const next = await Follower.#boot(this.chainId, this.wasm, s).catch((e) => {
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
      await this.#save(s.dump)
    })
  }

  #serial<T>(fn: () => Promise<T>, evenStopped = false): Promise<T> {
    const run = this.#queue.then(() => {
      if (this.#failure && !evenStopped) throw this.#failure
      return fn()
    })
    this.#queue = run.catch(() => {})
    return run
  }

  #stop(status: 'removed' | 'mismatch' | 'gone', e: Error): never {
    if (this.#disposed) throw this.#failure ?? new Error('follower disposed') // an answer after dispose changes nothing
    this.status = status
    throw (this.#failure = e)
  }

  /**
   * Submit the pending txs, replay the cloud's new blocks onto the confirmed state (and store it), settle each pending tx
   * mined in them, re-sign and resubmit nonce refusals, then re-run what is still pending on top.
   * A failed submit still pulls and re-runs, then rejects with that error; the txs stay pending.
   * Requests run outside the queue. A call joins the running pass; if a tx was sent after that pass planned its submit,
   * it also waits for one follow-up pass (shared by all its callers), so it never waits for more than two passes.
   * Txs sent later are left to the next sync.
   */
  sync(): Promise<BlockSummary> {
    const p = this.#pass ??= this.#start()
    return p.done.then((head) => (p.late ? (p.next ??= (this.#pass ??= this.#start()).done) : head))
  }

  #start() {
    const p: Pass = { late: false, done: undefined! }
    p.done = this.#sync().finally(() => { if (this.#pass === p) this.#pass = undefined })
    return p
  }

  async #sync(): Promise<BlockSummary> {
    if (this.#failure) throw this.#failure
    let err: unknown, failed: unknown
    try {
      let r = await this.#submit()
      await this.#pull()
      for (let i = 0; r.nonce.size && !r.error && !r.denied.length && i < RESIGN_ROUNDS; i++) {
        await this.#serial(() => this.#resign(r.nonce))
        r = await this.#submit()
        await this.#pull()
      }
      failed = r.error
      // still a member (the pull would have thrown FollowerRemoved): this device may read but not write
      const who = this.client.account?.address ?? 'this device'
      await this.#serial(async () => { for (const t of r.denied) await this.#settle(t, { status: 'refused', reason: `${who} is not a writer on this chain` }) })
    } catch (e) {
      err = e
      const reason = e instanceof FollowerRemoved ? removedReason : e instanceof FollowerGone ? goneReason : e instanceof FollowerMismatch ? () => `chain no longer matches: ${e.message}` : undefined
      if (reason) await this.#serial(async () => {
        if (this.#disposed) return
        for (const t of this.#txs) if (t.status === 'pending') await this.#settle(t, { status: 'refused', reason: reason(t) })
      }, true).catch(() => {})
    }
    await this.#serial(async () => {
      if (this.#disposed) return
      if (!this.#failure) try { await this.#fresh() } catch (e) { err ??= e }
      this.#notify()
    }, true)
    if (err !== undefined) throw err
    if (failed !== undefined) throw failed
    return this.head
  }

  /** Rebuild the local view (confirmed + still pending) if a sync step left it behind: an offline sync costs nothing. */
  async #fresh() {
    if (this.#base && !this.#stale) return
    this.#stale = true // until the re-run completes: a throw part-way must not leave a partial view looking fresh
    await this.#toConfirmed()
    await this.#rerun()
    this.#stale = false
  }

  #blocks(after: number) {
    return this.client.blocks(this.chainId, after).catch((e) => {
      if (e instanceof NodeError && e.status === 403) this.#stop('removed', new FollowerRemoved(this.chainId))
      if (noSuchChain(e)) this.#stop('gone', new FollowerGone())
      throw e // transient: still following
    })
  }

  /** Fetch and replay every block after our head onto the confirmed state, a page at a time, until caught up. */
  async #pull() {
    for (;;) {
      const page = await this.#blocks(this.head.number)
      await this.#serial(async () => {
        this.cloudHead = page.head
        // never silently follow a different chain: an empty page must end at our head
        if (!page.blocks.length && (page.head.number < this.head.number || (page.head.number === this.head.number && page.head.hash !== this.head.hash)))
          this.#stop('mismatch', new FollowerMismatch(`cloud head ${page.head.number} (${page.head.hash}) does not match our head ${this.head.number} (${this.head.hash})`))
        // replay, reopen and save only on the confirmed state
        if (page.blocks.length || this.#replayed >= this.reopenEvery || (this.store && this.#saved !== this.head.hash)) await this.#toConfirmed()
        for (const b of page.blocks) {
          await this.#replay(b)
          await this.#settleFrom(b)
        }
        // not by page: retries a failed save; a reopen stores its own
        if (this.#replayed < this.reopenEvery && !this.#base) await this.#save()
      })
      if (this.#replayed >= this.reopenEvery) await this.#reopen()
      if (!page.blocks.length || this.head.number >= page.head.number) break
    }
    this.lastSynced = Date.now()
    // mined in a block we never replayed (booted past it from /state): settle from that block
    for (const [hash, block] of this.#minedAt) {
      if (block > this.head.number || !this.#txs.some((t) => t.hash === hash && t.status === 'pending')) continue
      const b = (await this.#blocks(block - 1)).blocks[0]
      if (b?.header.number === block) await this.#serial(() => this.#settleFrom(b))
    }
    // keep the ones still unsettled: #resign must never re-sign a tx the cloud has mined
    for (const hash of this.#minedAt.keys()) if (!this.#txs.some((t) => t.hash === hash && t.status === 'pending')) this.#minedAt.delete(hash)
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

  /**
   * POST the pending txs in seq order, in batches. A 400 or 413 on a batch splits it in halves (the request fails as a
   * whole, so it says nothing about each tx); only a single tx is refused for it. Stops at the first other failure;
   * a 403 marks that batch and the rest `denied`; a 404 "no such chain" (chain deleted) stops the follower. Only the requests run outside the queue. Each batch is marked
   * `mayBeMined` (stored) before it is sent; an answer that it is off chain (nonce, 403) clears it.
   */
  async #submit(): Promise<{ nonce: Map<PendingTx, string>; denied: PendingTx[]; error?: unknown }> {
    const nonce = new Map<PendingTx, string>()
    const tooBig = `too large to submit (over the ${MAX_SUBMIT_BYTES}-byte submit limit)`
    const size = (t: PendingTx) => t.raw.length + 3 // quotes and comma in {"txs":[...]}
    const batches: PendingTx[][] = []
    await this.#serial(async () => {
      if (this.#pass) this.#pass.late = false // every pending tx sent before now is in this plan
      let bytes = Infinity
      for (const t of this.#txs.filter((t) => t.status === 'pending')) {
        if (size(t) + 9 > MAX_SUBMIT_BYTES) { await this.#settle(t, { status: 'refused', reason: tooBig }); continue }
        const last = batches.at(-1)
        if (!last || last.length >= (this.o.batch ?? DEFAULT_BATCH) || bytes + size(t) > MAX_SUBMIT_BYTES) batches.push([t]), bytes = 9 + size(t)
        else last.push(t), bytes += size(t)
      }
    })
    while (batches.length) {
      const batch = batches.shift()!
      const unmarked = batch.filter((t) => !t.mayBeMined) // a 404 clears only these: the others may have been mined before the delete
      await this.#serial(() => this.#mark(batch, true))
      let r
      try {
        r = await this.client.submit(this.chainId, batch.map((t) => t.raw))
      } catch (e) {
        if (e instanceof NodeError && e.status === 403) {
          await this.#serial(() => this.#mark(batch, false))
          return { nonce, denied: [batch, ...batches].flat() }
        }
        if (noSuchChain(e)) {
          await this.#serial(() => this.#mark(unmarked, false))
          this.#stop('gone', new FollowerGone())
        }
        if (e instanceof NodeError && (e.status === 400 || e.status === 413)) {
          if (batch.length > 1) batches.unshift(batch.slice(0, batch.length >> 1), batch.slice(batch.length >> 1))
          else await this.#serial(() => this.#settle(batch[0]!, { status: 'refused', reason: e.status === 413 ? tooBig : e.error }))
          continue
        }
        return { nonce, denied: [], error: e } // no answer (or a 5xx): it stays mayBeMined
      }
      await this.#serial(async () => {
        // the answers in memory first, then the writes: a failed write leaves no answer unapplied
        for (const [j, x] of r.results.entries()) {
          const t = batch[j]!
          if (x.result === 'mined') this.#minedAt.set(t.hash, x.block)
          else if (x.code === 'nonce') nonce.set(t, x.reason)
        }
        await this.#mark([...nonce.keys()], false)
        for (const [j, x] of r.results.entries()) if (x.result === 'refused' && x.code !== 'nonce') await this.#settle(batch[j]!, { status: 'refused', reason: x.reason })
      })
    }
    return { nonce, denied: [] }
  }

  async #mark(txs: PendingTx[], mayBeMined: boolean) {
    for (const t of txs) if (!!t.mayBeMined !== mayBeMined) {
      t.mayBeMined = mayBeMined
      await this.#put(t)
    }
  }

  /**
   * Re-sign each nonce-refused tx and its sender's later pending ones with the sender's next nonces on the confirmed
   * state. Keeps `first` and `seq` (the store's key, so the record is replaced in one write). Never touches a tx the
   * cloud answered `mined`. No key for the sender → refused.
   */
  async #resign(refused: Map<PendingTx, string>) {
    await this.#toConfirmed()
    for (const from of new Set([...refused.keys()].map((t) => t.from))) {
      const key = this.o.signer?.(from)
      const mine = [...refused.keys()].filter((t) => t.from === from)
      if (!key) {
        for (const t of mine) await this.#settle(t, { status: 'refused', reason: refused.get(t)! })
        continue
      }
      const firstSeq = Math.min(...mine.map((t) => t.seq))
      let n = Number(await this.node.request({ method: 'eth_getTransactionCount', params: [from, 'latest'] }))
      for (const t of this.#txs.filter((t) => t.status === 'pending' && t.from === from && t.seq >= firstSeq && !this.#minedAt.has(t.hash))) {
        const { r: _r, s: _s, v: _v, yParity: _y, ...tx } = parseTransaction(t.raw)
        const raw = await key.signTransaction({ ...tx, nonce: n } as never)
        const old = { raw: t.raw, nonce: t.nonce, hash: t.hash }
        Object.assign(t, { raw, nonce: n++, hash: keccak256(raw) })
        // not stored: keep the old tx in memory too, or a reopen could resend the old raw beside the new one
        try { await this.#put(t) } catch (e) { Object.assign(t, old); throw e }
      }
    }
  }

  /**
   * Re-run the still-pending txs on top of the confirmed state, each in its own local block. Then mark a tx that
   * conflicted, or whose re-run differs from its first run, as depending on the latest earlier tx that conflicted
   * while it was pending (settled after it was sent).
   */
  async #rerun() {
    const runs = new Map<PendingTx, Outcome | undefined>()
    for (const t of this.#txs) if (t.status === 'pending') runs.set(t, await this.#local(t.raw).then(outcome, () => undefined))
    // ponytail: "depends on" = an earlier conflicted tx of this device, not a traced read/write overlap
    const conflicts: PendingTx[] = []
    for (const t of this.#txs) {
      const run = runs.get(t)
      const differs = t.status === 'conflicted' || (runs.has(t) && !(run && same(run, t.first)))
      const cause = differs && !t.dependsOn && conflicts.findLast((c) => (c.settledAt ?? 0) > t.seq)
      if (cause) await this.#settle(t, { dependsOn: cause.hash })
      if (t.status === 'conflicted') conflicts.push(t)
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
    Object.assign(t, patch, patch.status && { settledAt: this.#seq })
    if (patch.status) this.#stale = true
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
      await this.#fresh()
      const r = await this.#local(raw)
      const t: PendingTx = { hash: r.transactionHash, raw, from: getAddress(r.from), nonce: parseTransaction(raw).nonce ?? 0, seq: this.#seq++, first: outcome(r), status: 'pending' }
      this.#txs.push(t)
      if (this.#pass) this.#pass.late = true
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
      await this.store?.deletePending(this.key, t.seq)
      this.#txs.splice(this.#txs.indexOf(t), 1)
      this.#dirty = true
      this.#notify()
    }, true)
  }

  /** Store the confirmed copy, trimmed to what loadState needs (state + recent headers), so it stays bounded. */
  async #save(dump?: SerializedState) {
    if (!this.store || this.#saved === this.head.hash) return
    dump ??= await this.node.dumpState()
    await this.store.saveConfirmed(this.key, { head: this.head, dump: { ...dump, blocks: dump.blocks.slice(-HEADERS_KEPT), receipts: {}, transactions: {} }, savedAt: Date.now() })
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

  /**
   * Run `fn` on the local node, between sync steps. Throws once the follower is removed or mismatched; it can also
   * throw a store error, when it first re-runs the pending txs after a sync step and records a `dependsOn`.
   */
  read<T>(fn: (node: SlimNode) => Promise<T>): Promise<T> {
    return this.#serial(async () => {
      await this.#fresh()
      return fn(this.node)
    })
  }

  dispose(): Promise<void> {
    this.#disposed = true
    const run = this.#queue.then(() => {
      this.#failure ??= new Error('follower disposed')
      return this.node.dispose()
    })
    this.#queue = run.catch(() => {})
    return run
  }
}
