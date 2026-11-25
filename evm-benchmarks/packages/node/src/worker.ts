// The chain worker: `handle` routes, each chain is one ChainDO (a ChainHost over the DO's SQLite).
import { DurableObject } from 'cloudflare:workers'
// @ts-ignore wrangler bundles .wasm as a compiled WebAssembly.Module
import wasm from 'revm-wasm/revm.wasm'
import { ChainHost, handle, subscribeRequest, type ChainHandleLike, type ChainRequest } from './router'
import { LiveHub, PING, PONG, headMessage } from './live'
import type { BlockSummary } from './client'
import { doSql } from './doSql'
import type { SerializedState } from 'webevm'
import type { Hex } from 'viem'

interface Env { CHAIN: DurableObjectNamespace; ROOT_ADMIN: string }

const chains = (env: Env) => (id: string) => env.CHAIN.get(env.CHAIN.idFromName(id)) as unknown as ChainHandleLike

export default {
  fetch: (req: Request, env: Env) => handle(req, { chain: chains(env), subscribe: (id, r) => env.CHAIN.get(env.CHAIN.idFromName(id)).fetch(r) }),
}

export class ChainDO extends DurableObject<Env> {
  host = new ChainHost(doSql(this.ctx.storage), wasm, { rootAdmin: this.env.ROOT_ADMIN ?? '', chain: chains(this.env), onHead: (h) => this.#push(h) })

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  #push(h: BlockSummary) {
    const hub = new LiveHub(() => this.ctx.getWebSockets().map((ws) => ({ ws, tag: this.ctx.getTags(ws)[0]! })), (a) => this.host.canRead(a))
    this.ctx.waitUntil(hub.broadcast(h).catch(console.error))
  }

  /** A signed websocket upgrade: same checks as GET blocks, then a hibernating socket tagged with the signer. */
  async fetch(req: Request): Promise<Response> {
    const out = await this.host.serve(subscribeRequest(req))
    if (out.status !== 200) return Response.json(out.body, { status: out.status })
    const { tag, head } = out.body as { tag: string; head: BlockSummary }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server, [tag])
    server.send(headMessage(head))
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketClose(ws: WebSocket, code: number) { ws.close(code === 1005 || code === 1006 ? 1000 : code) }

  serve(r: ChainRequest) { return this.host.serve(r) }
  create(chainId: string, signer: string, dump: SerializedState, setup: [Hex, Hex]) { return this.host.create(chainId, signer, dump, setup) }
  rootInfo() { return this.host.rootInfo() }
}
