// The chain worker: `handle` routes, each chain is one ChainDO (a ChainHost over the DO's SQLite).
import { DurableObject } from 'cloudflare:workers'
// @ts-ignore wrangler bundles .wasm as a compiled WebAssembly.Module
import wasm from 'revm-wasm/revm.wasm'
import { ChainHost, handle, type ChainHandleLike, type ChainRequest } from './router'
import { doSql } from './doSql'
import type { SerializedState } from 'webevm'
import type { Hex } from 'viem'

interface Env { CHAIN: DurableObjectNamespace; ROOT_ADMIN: string }

const chains = (env: Env) => (id: string) => env.CHAIN.get(env.CHAIN.idFromName(id)) as unknown as ChainHandleLike

export default {
  fetch: (req: Request, env: Env) => handle(req, { chain: chains(env) }),
}

export class ChainDO extends DurableObject<Env> {
  host = new ChainHost(doSql(this.ctx.storage), wasm, { rootAdmin: this.env.ROOT_ADMIN ?? '', chain: chains(this.env) })

  serve(r: ChainRequest) { return this.host.serve(r) }
  create(chainId: string, signer: string, dump: SerializedState, setup: [Hex, Hex]) { return this.host.create(chainId, signer, dump, setup) }
  rootInfo() { return this.host.rootInfo() }
}
