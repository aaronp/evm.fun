import { createNode, type SerializedState, type SlimNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import type { Hex } from 'viem'
import type { ChainStore, SerializedBlock, StateDiff, StoredBlock } from './store'

export interface NodeConfig {
  wasm: WebAssembly.Module | ArrayBufferView
  /** Rebuild the in-memory node from the store every N blocks, to bound its history (default 1000). */
  rebuildEvery?: number
}

/** webevm keeps a slot written to zero in its dump (as `0x`); the store drops it, as the trie does. */
const nonZero = (slots: Record<string, string> = {}) => Object.fromEntries(Object.entries(slots).filter(([, v]) => !/^0x0*$/.test(v)))

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

export class ChainNode {
  blocksSinceRebuild = 0
  #node!: SlimNode
  #env: { timestamp?: bigint; baseFeePerGas?: bigint } = {}
  #dump!: SerializedState

  private constructor(private store: ChainStore, private cfg: NodeConfig) {}

  get node(): SlimNode {
    return this.#node
  }

  static async boot(store: ChainStore, cfg: NodeConfig): Promise<ChainNode> {
    const n = new ChainNode(store, cfg)
    await n.rebuild()
    return n
  }

  static async create(store: ChainStore, dump: SerializedState, cfg: NodeConfig): Promise<ChainNode> {
    store.create(dump)
    return ChainNode.boot(store, cfg)
  }

  /** Fresh node from the store's current state (boot, every `rebuildEvery` blocks, and after a failed block). */
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

  /** Execute `txs` as one block at `timestamp` and commit it. On any failure the node is rebuilt from the store and the error rethrown. */
  async apply(timestamp: number, txs: Hex[]): Promise<StoredBlock> {
    let block: StoredBlock
    try {
      this.#env.timestamp = BigInt(timestamp)
      const hashes: string[] = []
      for (const raw of txs) hashes.push((await this.#node.request({ method: 'eth_sendRawTransaction', params: [raw] })) as string)
      const mined = await this.#node.mine()
      const left = hashes.filter((h) => !mined.txHashes.includes(h))
      if (left.length) throw new Error(`txs not mined: ${left.join(', ')}`)
      const after = await this.#node.dumpState()
      const header = after.blocks.at(-1)!
      const receipts = header.transactions.map((h) => {
        if (!after.receipts[h]) throw new Error(`no receipt for ${h}`)
        return after.receipts[h]
      })
      block = { header, txs, receipts }
      this.store.commit(block, diffState(this.#dump, after))
      this.#dump = after
    } catch (e) {
      try {
        await this.rebuild()
      } catch (r) {
        throw new AggregateError([e, r], 'apply failed, and the rebuild from the store failed too')
      }
      throw e
    }
    if (++this.blocksSinceRebuild >= (this.cfg.rebuildEvery ?? 1000)) await this.rebuild()
    return block
  }

  head(): SerializedBlock {
    return this.store.head()
  }

  stateRoot(): Promise<string> {
    return this.#node.getStateRoot()
  }
}
