// Device replica: a signed client for the chain DO plus its own local webevm/revm node that
// replays accepted blocks and checks them against the DO. Only fetch/WebSocket/crypto.subtle,
// so it runs in Bun and the browser; the caller supplies the revm wasm (bytes, URL or Module).
import type { Hex, LocalAccount } from 'viem'
import { applyBlock, makeChain, makeReadToken, signRequest, type AccessConfig, type BlockRecord, type Chain, type Genesis } from './chain'

export class Device {
  constructor(readonly base: string, readonly account: LocalAccount) {}
  get address() { return this.account.address.toLowerCase() }

  async call<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const url = new URL(path, this.base)
    const text = body === undefined ? '' : JSON.stringify(body)
    const a = await signRequest(this.account, method, url, text)
    const res = await fetch(url, {
      method, body: method === 'GET' ? undefined : text,
      headers: { 'content-type': 'application/json', 'x-ts': a.ts, 'x-nonce': a.nonce, 'x-sig': a.sig },
    })
    return { status: res.status, data: await res.json() as T }
  }

  createChain(genesis: Genesis, access: Omit<AccessConfig, 'admin'> = {}) {
    return this.call<{ chainId: string }>('POST', '/chains', { genesis, access })
  }

  /** Self-issued bearer read token (no server session). */
  readToken(chainId: string, ttlS = 60) { return makeReadToken(this.account, chainId, ttlS) }

  /** Subscribe with a signed request, or with ?token=<bearer> when `auth` is 'token'. */
  async socket(chainId: string, auth: 'sig' | 'token' = 'sig') {
    const url = new URL(`/chains/${chainId}/subscribe`, this.base.replace(/^http/, 'ws'))
    if (auth === 'token') url.searchParams.set('token', await this.readToken(chainId))
    else for (const [k, v] of Object.entries(await signRequest(this.account, 'GET', url, ''))) url.searchParams.set(k, v)
    return new WebSocket(url)
  }
}

export interface Check { number: number; rootOk: boolean; hashOk: boolean; replayMs: number }

export class Replica {
  head!: { number: number; hash: string }
  checks: Check[] = []
  private queue: Promise<unknown> = Promise.resolve()
  private constructor(readonly device: Device, readonly chainId: string, readonly chain: Chain) {}

  static async open(device: Device, chainId: string, wasm: Parameters<typeof makeChain>[1]) {
    const info = await device.call('GET', `/chains/${chainId}`)
    if (info.status !== 200) throw new Error(`open ${chainId}: ${info.status} ${JSON.stringify(info.data)}`)
    const r = new Replica(device, chainId, await makeChain(info.data.genesis as Genesis, wasm))
    const [g0] = (await device.call<BlockRecord[]>('GET', `/chains/${chainId}/blocks?after=-1`)).data
    const local = (await r.chain.node.request({ method: 'eth_getBlockByNumber', params: ['0x0', false] })) as { hash: string }
    if (local.hash !== g0!.hash || (await r.chain.node.getStateRoot()) !== g0!.stateRoot) throw new Error('genesis mismatch')
    r.head = { number: 0, hash: local.hash }
    return r
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  /** Pull and replay every accepted block after our head. */
  sync() {
    return this.serial(async () => {
      for (;;) {
        const { status, data } = await this.device.call<BlockRecord[]>('GET', `/chains/${this.chainId}/blocks?after=${this.head.number}`)
        if (status !== 200) throw new Error(`fetch: ${status} ${JSON.stringify(data)}`)
        for (const b of data) await this.replay(b)
        if (data.length < 100) return this.head
      }
    })
  }

  private async replay(b: BlockRecord) {
    if (b.parentHash !== this.head.hash) throw new Error(`block ${b.number} does not extend our head`)
    const t0 = performance.now()
    const local = await applyBlock(this.chain, b.timestamp, b.txs)
    const c = { number: b.number, rootOk: local.stateRoot === b.stateRoot, hashOk: local.hash === b.hash, replayMs: performance.now() - t0 }
    this.checks.push(c)
    if (!c.rootOk) throw new Error(`state root mismatch at ${b.number}: local ${local.stateRoot} vs DO ${b.stateRoot}`)
    this.head = { number: local.number, hash: local.hash }
  }

  /**
   * Propose txs: execute optimistically on the local node at a timestamp we choose, push them with
   * our head as expectedHead, then check the DO's accepted block against our local result.
   * On refusal (409 stale head, 400 rejected) roll the local node back and return the refusal.
   */
  submit(txs: Hex[]) {
    return this.serial(async () => {
      const before = await this.chain.node.dumpState()
      const timestamp = Math.floor(Date.now() / 1000)
      const t0 = performance.now()
      let local: BlockRecord | undefined
      try { local = await applyBlock(this.chain, timestamp, txs) } catch {}
      const localMs = performance.now() - t0
      const res = await this.device.call('POST', `/chains/${this.chainId}/submit`, { expectedHead: this.head.hash, timestamp, txs })
      if (res.status !== 200 || !local) {
        await this.chain.node.loadState(before)
        return { ...res, localMs }
      }
      const b = res.data.block as BlockRecord
      const c = { number: b.number, rootOk: local.stateRoot === b.stateRoot, hashOk: local.hash === b.hash, replayMs: localMs }
      this.checks.push(c)
      if (!c.rootOk) throw new Error(`optimistic root mismatch at ${b.number}`)
      this.head = { number: b.number, hash: b.hash }
      return { ...res, localMs }
    })
  }

  /** Subscribe; every head notification triggers a sync. */
  async subscribe(onSynced?: (head: Replica['head']) => void) {
    const ws = await this.device.socket(this.chainId)
    await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err })
    ws.onmessage = () => this.sync().then((h) => onSynced?.(h), (e) => console.error('sync failed', e))
    return ws
  }

  request(method: string, params: unknown[] = []) { return this.chain.node.request({ method, params }) }
}
