// One chain's logic, independent of Durable Objects: create from a dump + set-up block, submit, redeem codes, info.
import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, getAddress, isHex, keccak256, parseEventLogs, parseTransaction, recoverTransactionAddress, type Abi, type Address, type Hex } from 'viem'
import type { SerializedState } from 'webevm'
import { ChainAccess } from '@evmb/contracts'
import type { Sql } from './sql'
import { chainAcl, type ACL } from './acl'
import { ChainStore, type SerializedBlock } from './store'
import { ChainNode, type NodeConfig } from './node'
import { codeHash, GRANT_CREATE_CHAIN, GRANT_READER, GRANT_WRITER, type BlockRecord, type BlockSummary, type CodeRecord, type Member, type NodesView, type RemoteChainInfo, type SubmitResult, type TxResult } from './client'

export class ServiceError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

const BAD_CODE = 'bad, used or expired code'
/** An idle device's cursor is rewritten at most this often (seconds). */
const CURSOR_REFRESH_S = 60
/** Most blocks one `blocks()` call returns. */
const MAX_BLOCKS = 100
const summary = (h: SerializedBlock): BlockSummary => ({ number: h.number, hash: h.hash, stateRoot: h.stateRoot })
const sender = (raw: Hex) => recoverTransactionAddress({ serializedTransaction: raw as never }).then((a) => a.toLowerCase())
const meta = (sql: Sql, k: string) => sql.exec('SELECT v FROM meta WHERE k = ?', k)[0]?.v as Address | undefined
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Creates in progress, so a second concurrent create on the same sql is refused before it awaits anything. */
const creating = new WeakSet<Sql>()

function initTables(sql: Sql) {
  new ChainStore(sql) // creates its tables, incl. meta
  sql.exec('CREATE TABLE IF NOT EXISTS redeems (hash TEXT, by TEXT, chainId TEXT, at INTEGER)')
  sql.exec('CREATE TABLE IF NOT EXISTS cursors (address TEXT PRIMARY KEY, name TEXT, block INTEGER NOT NULL, seenAt INTEGER NOT NULL)')
}

/** Drop every row, so a refused create leaves no chain behind and a retry starts clean. */
function wipe(sql: Sql) {
  sql.tx(() => { for (const t of ['meta', 'accounts', 'code', 'storage', 'blocks', 'txs', 'redeems', 'cursors']) sql.exec(`DELETE FROM ${t}`) })
}

/** The stateless set-up checks (exactly two contract creations sent by `signer`); the root runs them before spending a code. */
export async function checkSetup(signer: string, setup: unknown): Promise<void> {
  if (!Array.isArray(setup) || setup.length !== 2) throw new ServiceError(400, 'setup must be exactly two txs')
  try {
    for (const raw of setup as Hex[]) {
      if (parseTransaction(raw).to) throw new ServiceError(400, 'setup txs must be contract creations')
      if ((await sender(raw)) !== signer.toLowerCase()) throw new ServiceError(403, 'setup txs must be sent by the request signer')
    }
  } catch (e) {
    throw e instanceof ServiceError ? e : new ServiceError(400, `bad setup tx: ${msg(e)}`)
  }
}

export class ChainService {
  #writes: Promise<unknown> = Promise.resolve()

  private constructor(private sql: Sql, private store: ChainStore, private node: ChainNode, readonly chainId: string, readonly access: Address, readonly aliases: Address) {}

  /** The stored chain, booted; null if this sql holds no (fully created) chain. */
  static async open(sql: Sql, wasm: NodeConfig['wasm'], opts: { chainId: string }): Promise<ChainService | null> {
    initTables(sql)
    const [access, aliases] = [meta(sql, 'access'), meta(sql, 'aliases')]
    if (!access || !aliases) return null
    const id = meta(sql, 'id')
    if (id && id !== opts.chainId) throw new Error(`this sql holds chain ${id}, not ${opts.chainId}`)
    const store = new ChainStore(sql)
    return new ChainService(sql, store, await ChainNode.boot(store, { wasm }), opts.chainId, access, aliases)
  }

  /** Load `dump`, mine the two set-up txs (ChainAccess, Aliases) as one block; refuse unless they are what they claim. */
  static async create(sql: Sql, wasm: NodeConfig['wasm'], opts: { chainId: string; signer: string; dump: SerializedState; setup: [Hex, Hex]; timestamp: number }): Promise<ChainService> {
    initTables(sql)
    if (meta(sql, 'access') || creating.has(sql)) throw new ServiceError(409, 'chain already exists')
    creating.add(sql)
    try {
      return await ChainService.#create(sql, wasm, opts)
    } finally {
      creating.delete(sql)
    }
  }

  static async #create(sql: Sql, wasm: NodeConfig['wasm'], opts: { chainId: string; signer: string; dump: SerializedState; setup: [Hex, Hex]; timestamp: number }): Promise<ChainService> {
    const signer = opts.signer.toLowerCase()
    const setup = opts.setup as Hex[]
    await checkSetup(signer, setup)

    wipe(sql) // a half-created chain from an earlier crash
    const store = new ChainStore(sql)
    let node: ChainNode | undefined
    try {
      node = await ChainNode.create(store, opts.dump, { wasm })
      const { block: blk, results } = await node.apply(opts.timestamp, setup).catch((e) => { throw new ServiceError(400, `setup block rejected: ${msg(e)}`) })
      const no = results.flatMap((r) => (r.ok ? [] : [r.error]))[0]
      if (no !== undefined || !blk) throw new ServiceError(400, `setup block rejected: ${no}`)
      const receipts = blk.receipts as { status: number; contractAddress: Address }[]
      if (receipts.some((r) => r.status !== 1)) throw new ServiceError(400, 'a setup tx reverted')
      const [access, aliases] = receipts.map((r) => getAddress(r.contractAddress)) as [Address, Address]
      const admin = await node.read((n) => ethCall(n, access, ChainAccess.abi, 'admin')).catch(() => null)
      if (String(admin).toLowerCase() !== signer) throw new ServiceError(403, 'ChainAccess.admin() is not the request signer')
      sql.tx(() => {
        sql.exec("INSERT INTO meta VALUES ('access', ?)", access)
        sql.exec("INSERT INTO meta VALUES ('aliases', ?)", aliases)
        sql.exec("INSERT INTO meta VALUES ('id', ?)", opts.chainId)
      })
      return new ChainService(sql, store, node, opts.chainId, access, aliases)
    } catch (e) {
      await node?.dispose().catch(() => {})
      wipe(sql)
      throw e instanceof ServiceError ? e : new ServiceError(400, `bad dump: ${msg(e)}`)
    }
  }

  readonly acl: ACL = chainAcl((fn, args) => this.call(ChainAccess.abi, fn, args))

  private call(abi: Abi, fn: string, args: unknown[] = []): Promise<any> {
    return this.node.read((n) => ethCall(n, this.access, abi, fn, args))
  }

  async info(): Promise<RemoteChainInfo> {
    return { chainId: this.chainId, head: summary(this.node.head()), admin: await this.call(ChainAccess.abi, 'admin'), access: this.access, aliases: this.aliases }
  }

  canRead(addr: string): Promise<boolean> { return this.acl.canRead(addr as Address) }
  canWrite(addr: string): Promise<boolean> { return this.acl.canWrite(addr as Address) }
  /** Admin, writer or reader: excludes keys that can read only because readOpen is on. */
  async isMember(addr: string): Promise<boolean> {
    return (await this.call(ChainAccess.abi, 'isReader', [addr])) || (await this.canWrite(addr))
  }

  async nonceOf(addr: string): Promise<number> {
    return Number(await this.node.read((n) => n.request({ method: 'eth_getTransactionCount', params: [addr, 'latest'] })))
  }

  /**
   * Mine `txs` as one block and answer each in order: a tx already on chain answers its block (a resend is
   * idempotent), the rest are mined or refused by the node. The signer must be a writer; tx senders are not checked.
   */
  submit(signer: string, txs: Hex[], timestamp: number): Promise<SubmitResult> {
    return this.#write(() => this.#submit(signer, txs, timestamp))
  }

  /** Writes (submit, redeem) run one at a time, checks and block together, so no other block lands between them. */
  #write<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#writes.then(fn)
    this.#writes = run.catch(() => {})
    return run
  }

  async #submit(signer: string, txs: Hex[], timestamp: number): Promise<SubmitResult> {
    if (!txs.every((t) => isHex(t))) throw new ServiceError(400, 'bad tx: txs must be hex strings')
    // only the submitting key is checked; what a tx's own sender may do is up to the contracts
    const a = signer.toLowerCase()
    if (!(await this.canWrite(a))) throw new ServiceError(403, `${a} is not a writer on this chain`)
    const hashes = txs.map((t) => keccak256(t))
    const fresh = txs.filter((_, i) => this.store.blockOf(hashes[i]!) === undefined)
    const { results } = fresh.length ? await this.node.apply(timestamp, fresh).catch((e) => { throw new ServiceError(400, `block rejected: ${msg(e)}`) }) : { results: [] }
    const errors = new Map(results.flatMap((r) => (r.ok ? [] : [[r.hash, r.error] as const])))
    return {
      head: summary(this.node.head()),
      // looked up after the block, so a tx sent twice in one request answers mined for both copies
      results: hashes.map((hash): TxResult => {
        const block = this.store.blockOf(hash)
        if (block !== undefined) return { hash, result: 'mined', block }
        const reason = errors.get(hash)!
        return { hash, result: 'refused', code: /nonce/i.test(reason) ? 'nonce' : 'invalid', reason }
      }),
    }
  }

  /**
   * Root chain only: mine `claim` (a `claim(code)` to ChainAccess sent by `signer`) as its own block.
   * The invite is checked first (inside the write queue), so a bad code never reaches a block.
   */
  redeem(signer: string, claim: Hex, timestamp: number): Promise<{ codeHash: Hex }> {
    return this.#write(() => this.#redeem(signer, claim, timestamp))
  }

  async #redeem(signer: string, claim: Hex, timestamp: number): Promise<{ codeHash: Hex }> {
    const { hash, grants } = await this.#invite(signer, claim, timestamp)
    // a reader/writer invite on root is a valid claim on-chain, but not a deploy code
    if ((grants & GRANT_CREATE_CHAIN) === 0) throw new ServiceError(403, 'not a deploy code')
    await this.#claim(claim, timestamp)
    return { codeHash: hash }
  }

  /**
   * A device joins: mine `claim` (a `claim(code)` to this chain's ChainAccess sent by `signer`) as its own block,
   * only if the invite grants reader or writer (a deploy code adds no role). Same precheck as `redeem`.
   */
  join(signer: string, claim: Hex, timestamp: number): Promise<{ head: BlockSummary; role: 'reader' | 'writer' }> {
    return this.#write(async () => {
      const { grants } = await this.#invite(signer, claim, timestamp)
      if ((grants & (GRANT_READER | GRANT_WRITER)) === 0) throw new ServiceError(403, BAD_CODE)
      const head = await this.#claim(claim, timestamp)
      return { head, role: grants & GRANT_WRITER ? 'writer' : 'reader' }
    })
  }

  /** Parse and check a claim tx against its live invite; throws before anything is mined. Call inside the write queue. */
  async #invite(signer: string, claim: Hex, timestamp: number): Promise<{ hash: Hex; grants: number }> {
    let code: string
    let tx: ReturnType<typeof parseTransaction>
    try {
      tx = parseTransaction(claim)
      if (tx.to?.toLowerCase() !== this.access.toLowerCase()) throw new Error("not sent to this chain's ChainAccess")
      if (tx.value) throw new Error('claim tx must send no value')
      // the gas estimate below is for the bare call: an access list (or 7702 authorizations) would add intrinsic gas it misses
      if (tx.accessList?.length || 'authorizationList' in tx) throw new Error('claim tx must not carry an access list')
      const d = decodeFunctionData({ abi: ChainAccess.abi, data: tx.data! })
      if (d.functionName !== 'claim') throw new Error('not a claim(code) call')
      code = d.args[0] as string
    } catch (e) {
      throw new ServiceError(400, `bad claim tx: ${msg(e)}`)
    }
    if ((await sender(claim)) !== signer.toLowerCase()) throw new ServiceError(403, 'claim tx must be sent by the request signer')
    const hash = codeHash(code)
    const [expiry, usesLeft, grants] = await this.call(ChainAccess.abi, 'invites', [hash])
    // mirrors ChainAccess.claim's require (block.timestamp <= expiry); writes are serialised, so the state can't change before the block
    if (usesLeft === 0 || timestamp > Number(expiry)) throw new ServiceError(403, BAD_CODE)
    // a claim can pass the checks above and still revert in its block (e.g. too little gas), so simulate it and mine nothing.
    // eth_estimateGas, not eth_call: webevm's eth_call does not charge intrinsic gas against `gas`; the estimate is the
    // smallest gas limit at which the claim succeeds, and throws if it reverts at any limit.
    const need = await this.node.read((n) => n.request({ method: 'eth_estimateGas', params: [{ from: signer, to: this.access, data: tx.data }, 'latest'] }))
      .then(BigInt, () => null)
    if (need === null || (tx.gas ?? 0n) < need) throw new ServiceError(403, BAD_CODE)
    return { hash, grants: Number(grants) }
  }

  async #claim(claim: Hex, timestamp: number): Promise<BlockSummary> {
    const { block: blk, results: [r] } = await this.node.apply(timestamp, [claim]).catch((e) => { throw new ServiceError(400, `claim rejected: ${msg(e)}`) })
    if (!blk) throw new ServiceError(400, `claim rejected: ${r && !r.ok ? r.error : 'not mined'}`)
    if ((blk.receipts[0] as { status: number }).status !== 1) throw new ServiceError(403, BAD_CODE)
    return summary(blk.header)
  }

  recordRedeem(hash: Hex, by: string, chainId: string, at: number): void {
    this.sql.exec('INSERT INTO redeems VALUES (?, ?, ?, ?)', hash, by, chainId, at)
  }

  /** Every invite ever issued (expiry from its latest Invited event, uses left from state), with its recorded redeems. */
  async codes(): Promise<CodeRecord[]> {
    // ponytail: scans every stored block's receipts; index Invited events in a table if chains grow long
    const expiry = new Map<Hex, number>()
    for (const b of this.store.blocks(0, this.node.head().number))
      for (const l of parseEventLogs({ abi: ChainAccess.abi, eventName: 'Invited', logs: (b.receipts as { logs: any[] }[]).flatMap((r) => r.logs) }))
        if (l.address.toLowerCase() === this.access.toLowerCase()) expiry.set(l.args.codeHash, Number(l.args.expiry))
    const out: CodeRecord[] = []
    for (const [hash, exp] of expiry) {
      const [, usesLeft] = await this.call(ChainAccess.abi, 'invites', [hash])
      const redeemed = this.sql.exec('SELECT by, chainId, at FROM redeems WHERE hash = ? ORDER BY at', hash)
        .map((r) => ({ by: r.by as Address, chainId: r.chainId as string, at: r.at as number }))
      out.push({ hash, expiry: exp, usesLeft: Number(usesLeft), redeemed })
    }
    return out
  }

  /** Current state and the last 256 headers, enough to start a follower at `head`. */
  async state(): Promise<{ head: BlockSummary; dump: SerializedState }> {
    const dump = this.store.stateDump() // synchronous, so head and dump are the same block
    return { head: summary(dump.blocks.at(-1)!), dump }
  }

  /** Up to `limit` (at most 100) blocks after `after`, and the head. */
  blocks(after: number, limit = MAX_BLOCKS): { head: BlockSummary; blocks: BlockRecord[] } {
    const head = this.store.head()
    return { head: summary(head), blocks: this.store.blocks(after + 1, Math.min(after + Math.min(limit, MAX_BLOCKS), head.number)) }
  }

  /**
   * Record a device's position: only when `block` is past the stored one, or the stored one is a minute old.
   * The stored block never goes down, and an empty name keeps the stored one.
   */
  touch(address: string, name: string | undefined, block: number, at: number): void {
    const sql = this.sql
    const addr = address.toLowerCase()
    const [row] = sql.exec('SELECT name, block, seenAt FROM cursors WHERE address = ?', addr)
    if (row && block <= Number(row.block) && at - Number(row.seenAt) < CURSOR_REFRESH_S) return
    sql.exec('INSERT OR REPLACE INTO cursors VALUES (?, ?, ?, ?)', addr, name || (row?.name ?? null), Math.max(block, Number(row?.block ?? block)), at)
  }

  /** The access list (admin, writers, readers; each once, with its highest role) joined with the devices' cursors. */
  async nodes(): Promise<NodesView> {
    const head = summary(this.store.head()) // before the awaits, so a block landing meanwhile never overstates `behind`
    const [admin, { write, read, readOpen }] = await Promise.all([this.call(ChainAccess.abi, 'admin') as Promise<Address>, this.acl.list()])
    const writers = write.filter((a) => a !== admin), readers = read.filter((a) => !write.includes(a))
    const cursors = new Map(this.sql.exec('SELECT * FROM cursors').map((r) => [r.address as string, r]))
    const members: Member[] = []
    const seen = new Set<string>()
    for (const [role, list] of [['admin', [admin]], ['writer', writers], ['reader', readers]] as const)
      for (const address of list) {
        const key = address.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        const c = cursors.get(key)
        members.push(c
          ? { address, role, ...(c.name == null ? {} : { name: c.name as string }), block: Number(c.block), behind: Math.max(0, head.number - Number(c.block)), seenAt: Number(c.seenAt) }
          : { address, role })
      }
    return { head, admin, readOpen, members }
  }

  dump(): Promise<SerializedState> {
    return this.node.read((n) => n.dumpState())
  }

  dispose(): Promise<void> {
    return this.node.dispose()
  }
}

async function ethCall(n: { request(a: { method: string; params: unknown[] }): Promise<unknown> }, to: Address, abi: Abi, fn: string, args: unknown[] = []) {
  const data = (await n.request({ method: 'eth_call', params: [{ to, data: encodeFunctionData({ abi, functionName: fn, args } as never) }, 'latest'] })) as Hex
  return decodeFunctionResult({ abi, functionName: fn, data } as never) as any
}
