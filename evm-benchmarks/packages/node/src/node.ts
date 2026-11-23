import { createNode, type SerializedState, type SlimNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import type { Hex } from 'viem'
import { nonZero, type ChainStore, type SerializedBlock, type StateDiff, type StoredBlock } from './store'

export interface NodeConfig {
  wasm: WebAssembly.Module | ArrayBufferView
  /** Rebuild the in-memory node from the store every N blocks, to bound its history (default 1000). */
  rebuildEvery?: number
}

function need<T>(v: T | undefined, hash: string): T {
  if (v === undefined) throw new Error(`no tx or receipt for ${hash} in the dump`)
  return v
}

// ponytail: whole-state compare per block; touched-keys diff if state grows past a few MB
export function diffState(before: SerializedState, after: SerializedState): StateDiff {
  const flat = (b: Record<string, string>, a: Record<string, string>) => {
    const out: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(a)) if (b[k] !== v) out[k] = v
    for (const k of Object.keys(b)) if (!(k in a)) out[k] = null
    return out
  }
  const storage: StateDiff['storage'] = {}
  for (const addr of new Set([...Object.keys(before.storage), ...Object.keys(after.storage)])) {
    const d = flat(nonZero(before.storage[addr]), nonZero(after.storage[addr]))
    if (Object.keys(d).length) storage[addr] = d
  }
  return { accounts: flat(before.accounts, after.accounts), code: flat(before.code, after.code), storage }
}

/**
 * A chain's live node over its store. All node access goes through `apply` and `read`: they run one at a time,
 * because a Durable Object interleaves requests at every await and a block must hold only its own txs.
 * The inner webevm node is replaced on every rebuild, so never keep a reference to it outside a `read`.
 */
export class ChainNode {
  blocksSinceRebuild = 0
  #node!: SlimNode
  #env: { timestamp?: bigint; baseFeePerGas?: bigint } = {}
  #dump!: SerializedState
  #queue: Promise<unknown> = Promise.resolve()

  private constructor(private store: ChainStore, private cfg: NodeConfig) {}

  static async boot(store: ChainStore, cfg: NodeConfig): Promise<ChainNode> {
    const n = new ChainNode(store, cfg)
    await n.rebuild()
    return n
  }

  static async create(store: ChainStore, dump: SerializedState, cfg: NodeConfig): Promise<ChainNode> {
    store.create(dump)
    return ChainNode.boot(store, cfg)
  }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(fn)
    this.#queue = run.catch(() => {})
    return run
  }

  /** Run `fn` on the current node, after any `apply` already queued and before any queued after it. */
  read<T>(fn: (node: SlimNode) => Promise<T>): Promise<T> {
    return this.#serial(() => fn(this.#node))
  }

  /** Fresh node from the store's current state (boot, before the next block once `rebuildEvery` blocks are done, and after a failed block). */
  private async rebuild() {
    const dump = this.store.stateDump()
    await this.#node?.dispose()
    // ponytail: webevm has no per-block timestamp knob (no evm_setNextBlockTimestamp), but it keeps
    // options.blockEnv by reference and reads .timestamp at each mine, so we mutate it per block.
    // Relies on webevm 0.9.1 internals; a real build wants a mine({timestamp}) option upstream (t-130).
    // baseFee 0: gas is free on a personal chain, so a fresh joiner key with no balance can send.
    this.#env = { baseFeePerGas: 0n }
    this.#node = await createNode({
      chainId: dump.chainId,
      computeStateRoot: true,
      miningConfig: { type: 'manual' },
      blockEnv: this.#env,
      engine: await createRevmEngine({ wasm: this.cfg.wasm }),
    })
    await this.#node.loadState(dump)
    this.#dump = await this.#node.dumpState()
    this.blocksSinceRebuild = 0
  }

  /**
   * Execute `txs` as one block at `timestamp` and commit it; queued behind any other `apply`/`read`.
   * The block must hold exactly `txs`, in order. On any failure the node is rebuilt from the store and the error rethrown.
   */
  apply(timestamp: number, txs: Hex[]): Promise<StoredBlock> {
    return this.#serial(() => this.#apply(timestamp, txs))
  }

  async #apply(timestamp: number, txs: Hex[]): Promise<StoredBlock> {
    // a due rebuild runs here, before any tx is sent, so a committed block is never reported as failed
    if (this.blocksSinceRebuild >= (this.cfg.rebuildEvery ?? 1000)) await this.rebuild()
    try {
      this.#env.timestamp = BigInt(timestamp)
      const hashes: string[] = []
      for (const raw of txs) hashes.push((await this.#node.request({ method: 'eth_sendRawTransaction', params: [raw] })) as string)
      const mined = await this.#node.mine()
      if (mined.txHashes.join() !== hashes.join()) throw new Error(`mined txs [${mined.txHashes.join(', ')}] are not the sent txs [${hashes.join(', ')}]`)
      const after = await this.#node.dumpState()
      const header = after.blocks.at(-1)!
      // txs and receipts both from the mined header, so they always match it
      const block: StoredBlock = {
        header,
        txs: header.transactions.map((h) => need(after.transactions[h], h).raw as Hex),
        receipts: header.transactions.map((h) => need(after.receipts[h], h)),
      }
      this.store.commit(block, diffState(this.#dump, after))
      this.#dump = after
      this.blocksSinceRebuild++
      return block
    } catch (e) {
      try {
        await this.rebuild()
      } catch (r) {
        throw new AggregateError([e, r], 'apply failed, and the rebuild from the store failed too')
      }
      throw e
    }
  }

  head(): SerializedBlock {
    return this.store.head()
  }

  stateRoot(): Promise<string> {
    return this.read((n) => n.getStateRoot())
  }

  dispose(): Promise<void> {
    return this.read((n) => n.dispose())
  }
}
