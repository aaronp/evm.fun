// The app layer, UI-free: this device's chains (local webevm chains kept as dumps), deploying one with an
// onboarding code (or vouched for), retrying an unfinished deploy, following a deployed one, and root's codes.
import { toAccount } from 'viem/accounts'
import { encodeFunctionData, type Address, type Hex, type LocalAccount } from 'viem'
import { createNode, type SerializedState } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import type { KeyStore } from '@evmb/keys'
import { Onboarding } from '@evmb/contracts'
import { Follower, FollowerRemoved, NodeClient, NodeError, codeHash, issueTx, liveSync, mined, redeemTx, revokeTx, setupTxs, type FollowerStore, type LiveState, type NodeConfig } from '@evmb/node'
import { VALID_FOR, VOUCH_SECONDS, generateCode, isValidCode, normalizeCode } from './codes'
import { isIssuerOn, readCodes, simulate, type CodeView } from './onboarding'
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
  private deploying = new Set<string>()

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

  /**
   * Redeem `src.code` for this chain on root and create it in the cloud, in one request. `{vouch: true}`: an issuer
   * issues a 1-use code for it first (`Vouch: <name>`, VOUCH_SECONDS) and deploys with that.
   */
  deploy(id: string, src: CodeSource): Promise<ChainRecord> {
    return this.once(id, async () => {
      const code = 'code' in src ? normalizeCode(src.code) : undefined
      if (code !== undefined && !isValidCode(code)) throw new Error('bad code')
      const c = this.get(id)
      if (c.status !== 'local') throw new Error(`chain ${id} is ${c.status}, not local`)
      if (code) return this.send(c, code)
      if (!(await this.isIssuer())) throw new Error('Only issuers can vouch')
      return this.send(c, await this.issue(generateCode(), `Vouch: ${c.name}`, VOUCH_SECONDS, 1))
    })
  }

  /** Resend an unfinished deploy without the redeem (the grant may exist from the first attempt). */
  retryDeploy(id: string): Promise<ChainRecord> {
    return this.once(id, async () => {
      const c = this.get(id)
      if (c.status !== 'unfinished') throw new Error(`chain ${id} is ${c.status}, not unfinished`)
      return this.send(c)
    })
  }

  /** A Follower of a deployed chain, signing as `me`; the caller syncs (e.g. liveSync) and disposes it. */
  async follower(id: string): Promise<Follower> {
    const c = this.get(id)
    if (c.status !== 'deployed') throw new Error(`chain ${id} is ${c.status}, not deployed`)
    return Follower.open(this.client(`Follow ${c.name}`), id, this.o.wasm, { store: this.o.followerStore })
  }

  /** Keep a deployed chain's follower live (liveSync) until the returned stop; an open that fails reports `down`. */
  follow(id: string, onState?: (s: LiveState) => void): () => void {
    let stopped = false, stopLive: (() => void) | undefined, f: Follower | undefined
    // ponytail: a failed open isn't retried; reopen by calling follow again
    this.follower(id).then((fl) => {
      if (stopped) return void fl.dispose()
      f = fl
      stopLive = liveSync(fl, () => this.client(`Follow ${this.get(id).name}`).subscribeUrl(id), { onState })
    }, () => { if (!stopped) onState?.('down') })
    return () => { stopped = true; stopLive?.(); void f?.dispose() }
  }

  /** Whether I may issue codes: false when root refuses my read, or root's issuers list doesn't have me. */
  async isIssuer(): Promise<boolean> {
    try { return await this.onRoot((f, onb) => isIssuerOn(f, onb, this.o.me)) } catch (e) {
      if (e instanceof FollowerRemoved) return false
      throw e
    }
  }

  /** Issue a code on root (`code` omitted: 6 random digits); returns it as stored. */
  async issueCode(o: { code?: string; label: string; validFor: (typeof VALID_FOR)[number]['key']; uses: number }): Promise<{ code: string }> {
    const code = normalizeCode(o.code ?? generateCode())
    if (!isValidCode(code)) throw new Error('bad code')
    const seconds = VALID_FOR.find((v) => v.key === o.validFor)?.seconds
    if (!seconds) throw new Error(`bad validFor ${o.validFor}`)
    return { code: await this.issue(code, o.label, seconds, o.uses) }
  }

  /** Every code on root with its grants, newest first. */
  codes(): Promise<CodeView[]> { return this.onRoot((f, onb) => readCodes(f, onb, this.o.me)) }

  /** Stop further redeems of a code (its grants stay valid). */
  async revokeCode(hash: Hex): Promise<void> {
    await this.rootTx('Revoke a code', encodeFunctionData({ abi: Onboarding.abi, functionName: 'revoke', args: [hash] }), (a, n, onb) => revokeTx(a, n, onb, hash))
  }

  private async issue(code: string, label: string, seconds: number, uses: number): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + seconds
    const data = encodeFunctionData({ abi: Onboarding.abi, functionName: 'issue', args: [codeHash(code), label, BigInt(expiresAt), uses] })
    await this.rootTx(`Issue ${label}`, data, (a, n, onb) => issueTx(a, n, onb, code, label, expiresAt, uses))
    return code
  }

  /** `fn` unless a deploy of `id` is already running (then `already deploying`, nothing sent). */
  private async once<A>(id: string, fn: () => Promise<A>): Promise<A> {
    if (this.deploying.has(id)) throw new Error('already deploying')
    this.deploying.add(id)
    try { return await fn() } finally { this.deploying.delete(id) }
  }

  /** A client signing as `me`: each signature asks the key store, so no decrypted key outlives its scope here. */
  private client(purpose: string): NodeClient {
    const { keys, me, workerUrl } = this.o
    const sign = async <A>(fn: (s: LocalAccount) => Promise<A>) => (await keys.resolve(me, purpose)).withSigner(fn)
    return new NodeClient(workerUrl, toAccount({
      address: me,
      signMessage: (a) => sign((s) => s.signMessage(a)),
      signTransaction: ((...a: Parameters<LocalAccount['signTransaction']>) => sign((s) => s.signTransaction(...a))) as LocalAccount['signTransaction'],
      signTypedData: ((a: Parameters<LocalAccount['signTypedData']>[0]) => sign((s) => s.signTypedData(a))) as LocalAccount['signTypedData'],
    }))
  }

  private async onboarding(client: NodeClient): Promise<Address> {
    const onb = (await client.health()).root?.onboarding
    if (!onb) throw new Error(`${this.o.workerUrl} has no onboarding on its root chain`)
    return onb
  }

  /** `fn` on root's local copy (a Follower, synced first; kept in the follower store under "root"). */
  private async onRoot<A>(fn: (f: Follower, onboarding: Address) => Promise<A>, client = this.client('Read root')): Promise<A> {
    const onb = await this.onboarding(client)
    const f = await Follower.open(client, 'root', this.o.wasm, { store: this.o.followerStore })
    try {
      await f.sync()
      return await fn(f, onb)
    } finally { await f.dispose() }
  }

  /** Send one Onboarding tx to root: simulated first where I can read root (its revert reason thrown), else the worker decides. */
  private async rootTx(purpose: string, data: Hex, tx: (a: LocalAccount, nonce: number, onb: Address) => Promise<Hex>): Promise<void> {
    const client = this.client(purpose)
    const onb = await this.onboarding(client)
    await this.onRoot((f) => simulate(f, this.o.me, onb, data), client).catch((e) => { if (!(e instanceof FollowerRemoved)) throw e })
    mined(await client.submit('root', [await tx(client.account!, await client.nonce('root'), onb)]))
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
        if (code) redeem = await redeemTx(account, await client.nonce('root'), await this.onboarding(client), code, c.id)
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
