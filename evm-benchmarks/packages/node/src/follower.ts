// A device's copy of a cloud chain: boots from GET /state, replays GET /blocks, checks each block's hash and state root.
import { createNode, type SlimNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { NodeError, type BlockRecord, type BlockSummary, type NodeClient } from './client'
import { nodeOptions, type NodeConfig } from './node'

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

  #replayed = 0 // blocks replayed on the current node

  private constructor(private client: NodeClient, readonly chainId: string, private wasm: NodeConfig['wasm'], private reopenEvery: number,
    private node: SlimNode, private env: { timestamp?: bigint }, public head: BlockSummary) { this.cloudHead = head }

  /** `reopenEvery`: after that many replayed blocks, start a fresh node from GET /state (bounds memory). */
  static async open(client: NodeClient, chainId: string, wasm: NodeConfig['wasm'], o: { reopenEvery?: number } = {}): Promise<Follower> {
    const { node, env, head } = await Follower.#boot(client, chainId, wasm)
    return new Follower(client, chainId, wasm, o.reopenEvery ?? 1000, node, env, head)
  }

  static async #boot(client: NodeClient, chainId: string, wasm: NodeConfig['wasm']) {
    const { head, dump } = await client.state(chainId).catch((e) => {
      throw e instanceof NodeError && e.status === 403 ? new FollowerRemoved(chainId) : e
    })
    const env = {}
    const node = await createNode({ chainId: dump.chainId, ...nodeOptions(env), engine: await createRevmEngine({ wasm }) })
    try {
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

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(() => {
      if (this.#failure) throw this.#failure
      return fn()
    })
    this.#queue = run.catch(() => {})
    return run
  }

  #stop(status: 'removed' | 'mismatch', e: Error): never {
    this.status = status
    throw (this.#failure = e)
  }

  /** Fetch and replay every block after our head, a page at a time, until caught up with the cloud. */
  sync(): Promise<BlockSummary> {
    return this.#serial(async () => {
      for (;;) {
        const page = await this.client.blocks(this.chainId, this.head.number).catch((e) => {
          if (e instanceof NodeError && e.status === 403) this.#stop('removed', new FollowerRemoved(this.chainId))
          throw e // transient: still following
        })
        this.cloudHead = page.head
        // never silently follow a different chain: an empty page must end at our head
        if (!page.blocks.length && (page.head.number < this.head.number || (page.head.number === this.head.number && page.head.hash !== this.head.hash)))
          this.#stop('mismatch', new FollowerMismatch(`cloud head ${page.head.number} (${page.head.hash}) does not match our head ${this.head.number} (${this.head.hash})`))
        for (const b of page.blocks) await this.#replay(b)
        if (this.#replayed >= this.reopenEvery) await this.#reopen()
        if (!page.blocks.length || this.head.number >= page.head.number) return this.head
      }
    })
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
