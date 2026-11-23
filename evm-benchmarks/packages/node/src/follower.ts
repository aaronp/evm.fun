// A device's copy of a cloud chain: boots from GET /state, replays GET /blocks, checks each block's hash and state root.
import { createNode, type SlimNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { NodeError, type BlockRecord, type BlockSummary, type NodeClient } from './client'
import { nodeOptions, type NodeConfig } from './node'

/** This device is no longer a member of the chain (the cloud answered 403). */
export class FollowerRemoved extends Error {
  constructor(chainId: string) { super(`removed from chain ${chainId}`) }
}

/**
 * Keeps a local webevm node in step with a cloud chain. `sync` and `read` run one at a time.
 * After a removal or a mismatch the follower is stopped: `sync` and `read` throw that error again (after `dispose`, a "disposed" error).
 */
export class Follower {
  status: 'following' | 'removed' | 'mismatch' = 'following'
  #failure?: Error
  #queue: Promise<unknown> = Promise.resolve()

  private constructor(private client: NodeClient, readonly chainId: string, private node: SlimNode, private env: { timestamp?: bigint }, public head: BlockSummary) {}

  static async open(client: NodeClient, chainId: string, wasm: NodeConfig['wasm']): Promise<Follower> {
    const { head, dump } = await client.state(chainId).catch((e) => {
      throw e instanceof NodeError && e.status === 403 ? new FollowerRemoved(chainId) : e
    })
    const env = {}
    const node = await createNode({ chainId: dump.chainId, ...nodeOptions(env), engine: await createRevmEngine({ wasm }) })
    try {
      await node.loadState(dump)
      const root = await node.getStateRoot()
      if (root !== head.stateRoot) throw new Error(`state of chain ${chainId} at block ${head.number}: local root ${root}, cloud root ${head.stateRoot}`)
    } catch (e) {
      await node.dispose()
      throw e
    }
    return new Follower(client, chainId, node, env, head)
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
        for (const b of page.blocks) await this.#replay(b)
        if (!page.blocks.length || this.head.number >= page.head.number) return this.head
      }
    })
  }

  async #replay({ header, txs }: BlockRecord) {
    const at = `block ${header.number}`
    if (header.parentHash !== this.head.hash) this.#stop('mismatch', new Error(`${at} does not extend our head ${this.head.number} (${this.head.hash})`))
    let mined: { blockHash: string; stateRoot: string }
    try {
      this.env.timestamp = BigInt(header.timestamp)
      for (const raw of txs) await this.node.request({ method: 'eth_sendRawTransaction', params: [raw] })
      mined = { blockHash: (await this.node.mine()).blockHash, stateRoot: await this.node.getStateRoot() }
    } catch (e) {
      return this.#stop('mismatch', new Error(`${at}: replay failed (cloud root ${header.stateRoot}): ${e instanceof Error ? e.message : e}`))
    }
    if (mined.stateRoot !== header.stateRoot) this.#stop('mismatch', new Error(`${at}: local root ${mined.stateRoot}, cloud root ${header.stateRoot}`))
    if (mined.blockHash !== header.hash) this.#stop('mismatch', new Error(`${at}: local hash ${mined.blockHash}, cloud hash ${header.hash} (roots match: ${header.stateRoot})`))
    this.head = { number: header.number, hash: header.hash, stateRoot: header.stateRoot }
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
