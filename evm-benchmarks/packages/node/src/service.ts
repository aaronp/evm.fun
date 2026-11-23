// One chain's logic, independent of Durable Objects: create from a dump + set-up block, submit, redeem codes, info.
import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, getAddress, parseEventLogs, parseTransaction, recoverTransactionAddress, type Abi, type Address, type Hex } from 'viem'
import type { SerializedState } from 'webevm'
import { ChainAccess } from '@evmb/contracts'
import type { Sql } from './sql'
import { ChainStore, type SerializedBlock } from './store'
import { ChainNode, type NodeConfig } from './node'
import { codeHash, GRANT_CREATE_CHAIN, type BlockSummary, type CodeRecord, type RemoteChainInfo } from './client'

export class ServiceError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

const BAD_CODE = 'bad, used or expired code'
const summary = (h: SerializedBlock): BlockSummary => ({ number: h.number, hash: h.hash, stateRoot: h.stateRoot })
const sender = (raw: Hex) => recoverTransactionAddress({ serializedTransaction: raw as never }).then((a) => a.toLowerCase())
const meta = (sql: Sql, k: string) => sql.exec('SELECT v FROM meta WHERE k = ?', k)[0]?.v as Address | undefined
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Creates in progress, so a second concurrent create on the same sql is refused before it awaits anything. */
const creating = new WeakSet<Sql>()

function initTables(sql: Sql) {
  new ChainStore(sql) // creates its tables, incl. meta
  sql.exec('CREATE TABLE IF NOT EXISTS redeems (hash TEXT, by TEXT, chainId TEXT, at INTEGER)')
}

/** Drop every row, so a refused create leaves no chain behind and a retry starts clean. */
function wipe(sql: Sql) {
  sql.tx(() => { for (const t of ['meta', 'accounts', 'code', 'storage', 'blocks', 'redeems']) sql.exec(`DELETE FROM ${t}`) })
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
      const blk = await node.apply(opts.timestamp, setup).catch((e) => { throw new ServiceError(400, `setup block rejected: ${msg(e)}`) })
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

  private call(abi: Abi, fn: string, args: unknown[] = []): Promise<any> {
    return this.node.read((n) => ethCall(n, this.access, abi, fn, args))
  }

  async info(): Promise<RemoteChainInfo> {
    return { chainId: this.chainId, head: summary(this.node.head()), admin: await this.call(ChainAccess.abi, 'admin'), access: this.access, aliases: this.aliases }
  }

  canRead(addr: string): Promise<boolean> { return this.call(ChainAccess.abi, 'canRead', [addr]) }
  canWrite(addr: string): Promise<boolean> { return this.call(ChainAccess.abi, 'canWrite', [addr]) }

  async nonceOf(addr: string): Promise<number> {
    return Number(await this.node.read((n) => n.request({ method: 'eth_getTransactionCount', params: [addr, 'latest'] })))
  }

  /** Mine `txs` as one block; the signer and every sender must be writers. */
  submit(signer: string, txs: Hex[], timestamp: number): Promise<BlockSummary> {
    return this.#write(() => this.#submit(signer, txs, timestamp))
  }

  /** Writes (submit, redeem) run one at a time, checks and block together, so no other block lands between them. */
  #write<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#writes.then(fn)
    this.#writes = run.catch(() => {})
    return run
  }

  async #submit(signer: string, txs: Hex[], timestamp: number): Promise<BlockSummary> {
    const senders = await Promise.all(txs.map(sender)).catch((e) => { throw new ServiceError(400, `bad tx: ${msg(e)}`) })
    for (const a of new Set([signer.toLowerCase(), ...senders]))
      if (!(await this.canWrite(a))) throw new ServiceError(403, `${a} is not a writer on this chain`)
    const blk = await this.node.apply(timestamp, txs).catch((e) => { throw new ServiceError(400, `block rejected: ${msg(e)}`) })
    return summary(blk.header)
  }

  /**
   * Root chain only: mine `claim` (a `claim(code)` to ChainAccess sent by `signer`) as its own block.
   * The invite is checked first (inside the write queue), so a bad code never reaches a block.
   */
  redeem(signer: string, claim: Hex, timestamp: number): Promise<{ codeHash: Hex }> {
    return this.#write(() => this.#redeem(signer, claim, timestamp))
  }

  async #redeem(signer: string, claim: Hex, timestamp: number): Promise<{ codeHash: Hex }> {
    let code: string
    try {
      const tx = parseTransaction(claim)
      if (tx.to?.toLowerCase() !== this.access.toLowerCase()) throw new Error('not sent to the root ChainAccess')
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
    // a reader/writer invite on root is a valid claim on-chain, but not a deploy code
    if ((Number(grants) & GRANT_CREATE_CHAIN) === 0) throw new ServiceError(403, 'not a deploy code')
    const blk = await this.node.apply(timestamp, [claim]).catch((e) => { throw new ServiceError(400, `claim rejected: ${msg(e)}`) })
    if ((blk.receipts[0] as { status: number }).status !== 1) throw new ServiceError(403, BAD_CODE)
    return { codeHash: hash }
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
