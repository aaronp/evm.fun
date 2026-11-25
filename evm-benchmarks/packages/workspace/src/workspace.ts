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
type RootInfo = { onboarding: Address; access: Address }
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
  /** root's local copy, opened on first use and synced before each read */
  private rootF?: Promise<Follower>
  /** root txs (issue, revoke, a create's redeem) one at a time: each reads my root nonce then sends */
  private rootQueue: Promise<unknown> = Promise.resolve()

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
      const root = await this.rootInfo()
      if (code) return this.send(c, { code, onboarding: root.onboarding })
      if (!(await this.issuerOn(root))) throw new Error('Only issuers can vouch')
      return this.send(c, { code: await this.issue(root.onboarding, generateCode(), `Vouch: ${c.name}`, VOUCH_SECONDS, 1), onboarding: root.onboarding })
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

  /** Whether I may issue codes: root's issuers list has me and I can write root (issuing is a root tx); false when root refuses my read. */
  async isIssuer(): Promise<boolean> { return this.issuerOn(await this.rootInfo()) }

  /** Dispose root's local copy, if open. */
  async dispose(): Promise<void> {
    const f = this.rootF
    this.rootF = undefined
    await f?.then((x) => x.dispose(), () => {})
  }

  private async issuerOn(root: RootInfo): Promise<boolean> {
    try { return await this.onRoot((f) => isIssuerOn(f, root.onboarding, root.access, this.o.me)) } catch (e) {
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
    return { code: await this.issue((await this.rootInfo()).onboarding, code, o.label, seconds, o.uses) }
  }

  /** Every code on root with its grants, newest first. */
  async codes(): Promise<CodeView[]> {
    const { onboarding } = await this.rootInfo()
    return this.onRoot((f) => readCodes(f, onboarding, this.o.me))
  }

  /** Stop further redeems of a code (its grants stay valid). */
  async revokeCode(hash: Hex): Promise<void> {
    const { onboarding } = await this.rootInfo()
    await this.rootTx('Revoke a code', onboarding, encodeFunctionData({ abi: Onboarding.abi, functionName: 'revoke', args: [hash] }), (a, n) => revokeTx(a, n, onboarding, hash))
  }

  private async issue(onboarding: Address, code: string, label: string, seconds: number, uses: number): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + seconds
    const data = encodeFunctionData({ abi: Onboarding.abi, functionName: 'issue', args: [codeHash(code), label, BigInt(expiresAt), uses] })
    await this.rootTx(`Issue ${label}`, onboarding, data, (a, n) => issueTx(a, n, onboarding, code, label, expiresAt, uses))
    return code
  }

  /** `fn` after every root tx queued before it has settled. */
  private serial<A>(fn: () => Promise<A>): Promise<A> {
    const p = this.rootQueue.then(fn, fn)
    this.rootQueue = p.catch(() => {})
    return p
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

  /** Root's Onboarding and ChainAccess addresses (one unsigned GET /health per call path). */
  private async rootInfo(): Promise<RootInfo> {
    const root = (await new NodeClient(this.o.workerUrl).health()).root
    if (!root?.onboarding) throw new Error(`${this.o.workerUrl} has no onboarding on its root chain`)
    return { onboarding: root.onboarding, access: root.access }
  }

  /** `fn` on root's local copy, synced first. The copy is opened once (kept in the follower store under "root"); a failure drops it, so the next call reopens. */
  private async onRoot<A>(fn: (f: Follower) => Promise<A>): Promise<A> {
    const opened = (this.rootF ??= Follower.open(this.client('Read root'), 'root', this.o.wasm, { store: this.o.followerStore }))
    try {
      const f = await opened
      await f.sync()
      return await fn(f)
    } catch (e) {
      if (this.rootF === opened) { this.rootF = undefined; void opened.then((f) => f.dispose(), () => {}) }
      throw e
    }
  }

  /** Send one Onboarding tx to root, after the ones before it: simulated first where I can read root (its revert reason thrown), else the worker decides. */
  private rootTx(purpose: string, onboarding: Address, data: Hex, tx: (a: LocalAccount, nonce: number) => Promise<Hex>): Promise<void> {
    return this.serial(async () => {
      await this.onRoot((f) => simulate(f, this.o.me, onboarding, data)).catch((e) => { if (!(e instanceof FollowerRemoved)) throw e })
      const client = this.client(purpose)
      mined(await client.submit('root', [await tx(client.account!, await client.nonce('root'))]))
    })
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
  private send(c: ChainRecord, redeem?: { code: string; onboarding: Address }): Promise<ChainRecord> {
    // a redeem is a root tx: its nonce read and its mining (in the create) wait for the root txs before it
    return redeem ? this.serial(() => this.create(c, redeem)) : this.create(c)
  }

  private async create(c: ChainRecord, onRoot?: { code: string; onboarding: Address }): Promise<ChainRecord> {
    const code = onRoot?.code
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
        if (onRoot) redeem = await redeemTx(account, await client.nonce('root'), onRoot.onboarding, onRoot.code, c.id)
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
