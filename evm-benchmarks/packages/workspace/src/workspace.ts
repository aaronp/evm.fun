// The app layer, UI-free: this device's chains (local webevm chains kept as dumps), deploying one with an
// onboarding code, retrying an unfinished deploy, and following a deployed one.
import { toAccount } from 'viem/accounts'
import type { Address, LocalAccount } from 'viem'
import { createNode, type SerializedState } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import type { KeyStore } from '@evmb/keys'
import { Follower, NodeClient, NodeError, redeemTx, setupTxs, type FollowerStore, type NodeConfig } from '@evmb/node'
import { isValidCode, normalizeCode } from './codes'
import type { ChainRecord, WorkspaceStorage } from './storage'

export type CodeSource = { code: string } | { vouch: true }
type Options = {
  workerUrl: string; keys: KeyStore; me: Address; storage: WorkspaceStorage; wasm: NodeConfig['wasm']
  /** where followers keep their copies (keyed by chain id); none: each follower boots from the cloud */
  followerStore?: FollowerStore
}

const CHAIN_ID = 31337
const NOT_ALLOWED = 'not allowed to create this chain'
const message = (e: unknown) => (e instanceof NodeError ? e.error : e instanceof Error ? e.message : String(e))

/** A local chain's node (as packages/node/scripts/bootstrap.ts freshDump), from `dump` or a fresh genesis; disposed after `fn`. */
async function withNode<A>(wasm: NodeConfig['wasm'], dump: SerializedState | undefined, fn: (n: Awaited<ReturnType<typeof createNode>>) => Promise<A>) {
  const node = await createNode({
    chainId: CHAIN_ID, computeStateRoot: true, miningConfig: { type: 'manual' }, blockEnv: { baseFeePerGas: 0n },
    genesisTimestamp: BigInt(Math.floor(Date.now() / 1000)), engine: await createRevmEngine({ wasm }),
  })
  try {
    if (dump) await node.loadState(dump)
    return await fn(node)
  } finally { await node.dispose() }
}

export class Workspace {
  private records: Map<string, ChainRecord>
  private listeners = new Set<() => void>()

  private constructor(private o: Options, records: ChainRecord[]) {
    this.records = new Map(records.map((c) => [c.id, c]))
  }

  static async open(o: Options): Promise<Workspace> {
    return new Workspace(o, await o.storage.load())
  }

  chains(): ChainRecord[] { return [...this.records.values()] }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  async createChain(name: string, desc: string): Promise<ChainRecord> {
    const dump = await withNode(this.o.wasm, undefined, (n) => n.dumpState())
    return this.put({ id: crypto.randomUUID(), name, desc, createdAt: Date.now(), status: 'local', dump })
  }

  /** Redeem `src.code` for this chain on root and create it in the cloud, in one request. */
  async deploy(id: string, src: CodeSource): Promise<ChainRecord> {
    if (!('code' in src)) throw new Error('vouch is not supported yet') // Task 5
    const code = normalizeCode(src.code)
    if (!isValidCode(code)) throw new Error('bad code')
    const c = this.get(id)
    if (c.status !== 'local') throw new Error(`chain ${id} is ${c.status}, not local`)
    return this.send(c, code)
  }

  /** Resend an unfinished deploy without the redeem (the grant may exist from the first attempt). */
  async retryDeploy(id: string): Promise<ChainRecord> {
    const c = this.get(id)
    if (c.status !== 'unfinished') throw new Error(`chain ${id} is ${c.status}, not unfinished`)
    return this.send(c)
  }

  /** A Follower of a deployed chain, signing as `me`; the caller syncs (e.g. liveSync) and disposes it. */
  async follower(id: string): Promise<Follower> {
    const c = this.get(id)
    if (c.status !== 'deployed') throw new Error(`chain ${id} is ${c.status}, not deployed`)
    const { keys, me, workerUrl, wasm, followerStore } = this.o
    // each signature asks the key store, so no decrypted key outlives its scope here
    const sign = async <A>(fn: (s: LocalAccount) => Promise<A>) => (await keys.resolve(me, `Follow ${c.name}`)).withSigner(fn)
    const account = toAccount({
      address: me,
      signMessage: (a) => sign((s) => s.signMessage(a)),
      signTransaction: ((...a: Parameters<LocalAccount['signTransaction']>) => sign((s) => s.signTransaction(...a))) as LocalAccount['signTransaction'],
      signTypedData: ((a: Parameters<LocalAccount['signTypedData']>[0]) => sign((s) => s.signTypedData(a))) as LocalAccount['signTypedData'],
    })
    return Follower.open(new NodeClient(workerUrl, account), id, wasm, { store: followerStore })
  }

  private get(id: string): ChainRecord {
    const c = this.records.get(id)
    if (!c) throw new Error(`no chain ${id}`)
    return c
  }

  private async put(c: ChainRecord): Promise<ChainRecord> {
    await this.o.storage.save(c)
    this.records.set(c.id, c)
    for (const fn of this.listeners) fn()
    return c
  }

  /** POST /chains with the chain's dump and set-up txs, plus a redeem of `code` if given; all signed in one key scope. */
  private async send(c: ChainRecord, code?: string): Promise<ChainRecord> {
    const { keys, me, workerUrl, wasm } = this.o
    const dump = c.dump!
    const nonce = await withNode(wasm, dump, async (n) => Number(BigInt(await n.request({ method: 'eth_getTransactionCount', params: [me, 'latest'] }) as string)))
    let sent = false
    const { error: _, ...rest } = c
    try {
      const r = await (await keys.resolve(me, `Deploy ${c.name}`)).withSigner(async (account) => {
        const client = new NodeClient(workerUrl, account)
        const setup = await setupTxs(account, nonce, CHAIN_ID)
        let redeem
        if (code) {
          const onboarding = (await client.health()).root?.onboarding
          if (!onboarding) throw new Error(`${workerUrl} has no onboarding on its root chain`)
          redeem = await redeemTx(account, await client.nonce('root'), onboarding, code, c.id)
        }
        sent = true
        try {
          return await client.createChain({ chainId: c.id, dump, setup, redeem })
        } catch (e) {
          // a retry finding the chain: an earlier attempt landed
          if (!code && e instanceof NodeError && e.status === 409) return client.state(c.id)
          throw e
        }
      })
      return await this.put({ ...rest, status: 'deployed', dump: r.dump, deployedAt: Date.now() })
    } catch (e) {
      const reason = message(e)
      // a 502 (created after the grant was recorded) or no reply at all: the grant may exist
      if (sent && (e instanceof NodeError ? e.status === 502 : true)) await this.put({ ...rest, status: 'unfinished', error: reason })
      else if (!code && e instanceof NodeError && e.status === 403 && e.error === NOT_ALLOWED) await this.put({ ...rest, status: 'local' })
      throw new Error(reason, { cause: e })
    }
  }
}
