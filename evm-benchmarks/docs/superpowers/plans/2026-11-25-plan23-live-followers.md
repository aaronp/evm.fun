# Live followers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chain's Durable Object pushes each new head over a hibernating WebSocket; followers (Bun and evm.fun) sync on it instead of polling, and the polling timer is deleted.

**Architecture:** A small `live.ts` in `packages/node` holds the wire format, a pure `LiveHub` (broadcast + revocation over abstract sockets) and the client loop `liveSync`. `ChainHost` gains a `GET subscribe` admission route and an `onHead` hook; `worker.ts`'s `ChainDO.fetch` upgrades admitted requests and wires the hub to `ctx.getWebSockets()`. evm.fun's follower chain swaps its timer for `liveSync`.

**Tech Stack:** Bun, TypeScript, Cloudflare Durable Objects (hibernation API), viem, React 19.

**Spec:** `docs/superpowers/specs/2026-11-25-live-followers-design.md`

## Global Constraints

- Route `GET /chains/:id/subscribe`, signed in the query (`ts`, `nonce`, `sig`; body `''`); without `upgrade: websocket` → **426** `{ error: 'expected a websocket upgrade' }`; bad/replayed signature 401, non-reader 403, unknown chain 404 `no such chain` (same bodies as `GET /blocks`).
- Message, exactly: `{"type":"head","number":<n>,"hash":"0x…"}`; sent on connect and after every mined block.
- Revocation: after each block, `canRead` once per distinct tag (tag = signer, lowercase); failing sockets closed with **4003** `removed from chain` **before** the head is sent.
- Heartbeat: client sends text `ping` every **30 000 ms**; DO auto-responds `pong` (`ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))`); no `pong` within **10 000 ms** → client closes and reconnects.
- Reconnect backoff: **1 000 ms** doubling to **60 000 ms**, reset on a successful open. On every open, and after every failed connect, run one `sync()`. After a 4003 close: one `sync()`, no reconnect.
- evm.fun setting: `SyncInterval = 'live' | 'manual'`, default `'live'`; a stored `5`/`15`/`60` reads as `'live'`. No polling timer remains.
- `packages/node/src/*` no `bun:*`/`node:*` (the worker imports it). Tokens only in web; three themes; phone width. No new dependencies.
- Commit with `git commit --only -m … -- <paths>`, messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `design/`, `.env.*`, `.run/`, `_site/`, `relay/`, root `package.json`, `docs/adr/card.json`, `docs/schedule/card.json` (unrelated local changes). Tests per package (web files individually if Bun segfaults, R11), `bun run web:build`, `make e2e-node`.

## Review Focus

1. **Many sockets, one block:** `canRead` runs once per distinct tag, not per socket (three sockets of one key → one call). Task 1.
2. **A removed device** gets its 4003 close and never the head of the block that removed it. Task 1.
3. **A replayed subscribe URL** (same nonce) → 401. Task 1.
4. **A half-open socket** (laptop sleep, no close event): the missed `pong` closes it, it reconnects and runs the catch-up sync. Task 2.
5. **Manual → Live** in another evm.fun tab or settings connects without a reload; Live → Manual closes the socket. Task 3.

---

### Task 1: Worker pushes heads

**Files:**
- Create: `packages/node/src/live.ts` (wire format + `LiveHub`; the client loop is added in Task 2)
- Modify: `packages/node/src/router.ts` (subscribe route in `handle` and in `ChainHost.#serve`; `onHead`), `packages/node/src/worker.ts` (`ChainDO.fetch`, auto-response, hub), `packages/node/src/client.ts` (`subscribeUrl`), `packages/node/src/index.ts` (export `live`), `packages/node/scripts/e2e.ts`
- Test: `packages/node/test/live.test.ts`, `packages/node/test/router-devices.test.ts`, `packages/node/test/auth.test.ts`

**Interfaces:**
- Produces (`live.ts`): `CLOSE_REMOVED = 4003`, `PING = 'ping'`, `PONG = 'pong'`; `headMessage(h: BlockSummary): string`; `parseHead(data: unknown): { number: number; hash: Hex } | null` (null for anything not a well-formed head message, incl. `'pong'`); `interface LiveSocket { send(data: string): void; close(code: number, reason: string): void }`; `class LiveHub { constructor(sockets: () => { ws: LiveSocket; tag: string }[], canRead: (tag: string) => Promise<boolean>); broadcast(h: BlockSummary): Promise<void> }`.
- Produces (router): `ChainHost` accepts `GET subscribe` → `{ status: 200, body: { tag: string; head: BlockSummary } }` after the same auth and reader check as `GET blocks` (no cursor touch); `ChainHost` cfg gains `onHead?: (h: BlockSummary) => void`, called once after any `serve`/`create` that raised the head; `ChainHost.canRead(addr: string): Promise<boolean>`. `handle`: `GET /chains/:id/subscribe` → 426 without upgrade, else `deps.subscribe(id, req)` (`RouterDeps.subscribe?: (id: string, req: Request) => Promise<Response>`; absent → 501). The `ChainRequest` for it takes `ts`/`nonce`/`sig` from the query.
- Produces (client): `NodeClient.subscribeUrl(chainId: string): Promise<string>` — `ws:`/`wss:` URL (from `http:`/`https:`) of `/chains/:id/subscribe` with `ts`, `nonce`, `sig` signed over `GET`, that path and `''`.
- Worker: `ChainDO.fetch(req)` builds the `ChainRequest`, `host.serve`; non-200 → JSON error response; 200 → `WebSocketPair`, `ctx.acceptWebSocket(server, [tag])`, `server.send(headMessage(head))`, 101. Constructor sets the auto-response; `onHead` → `new LiveHub(() => ctx.getWebSockets().map(ws => ({ ws, tag: ctx.getTags(ws)[0] })), a => host.canRead(a)).broadcast(h)`. `webSocketClose(ws, code)` closes its side.

- [ ] **Step 1: Failing tests:**
  - live: `headMessage → parseHead round-trips`; `parseHead rejects 'pong', junk JSON, a negative number, a non-hex hash`; `broadcast sends the head to readers`; `broadcast closes non-readers with 4003 'removed from chain' and never sends them the head`; `three sockets of one tag → canRead called once`.
  - router: `subscribe without upgrade → 426`; `host GET subscribe: reader → 200 {tag, head}`, `non-reader → 403`, `replayed nonce → 401`, `unknown chain → 404 'no such chain'`; `onHead fires once after a submit mines a block, not after GET blocks`; `onHead fires after join`.
  - auth: `subscribeUrl is ws(s) and recoverSigner(GET, url, '') gives the account`.
- [ ] **Step 2:** run `bun test packages/node/test/live.test.ts packages/node/test/router-devices.test.ts packages/node/test/auth.test.ts` → FAIL.
- [ ] **Step 3:** implement per Interfaces.
- [ ] **Step 4:** PASS + `bun test packages/node`. e2e (`scripts/e2e.ts`, needs only `WebSocket`): a reader subscribes and gets the current head on open; a writer submits and the reader gets the new head within 5 s; a subscribe without upgrade → 426; after the admin removes the reader, its socket closes with 4003. `make e2e-node` ALL PASS.
- [ ] **Step 5:** Commit `feat(node): the chain's Durable Object pushes new heads over hibernating WebSockets (t-144)`.

### Task 2: `liveSync` — the follower's side

**Files:**
- Modify: `packages/node/src/live.ts`, `packages/node/src/follower.ts` (only `get head(): BlockSummary` if no such accessor exists), `packages/node/scripts/e2e.ts`
- Test: `packages/node/test/live-sync.test.ts`

**Interfaces:**
- Consumes: Task 1's `subscribeUrl`, `parseHead`, `PING`, `PONG`, `CLOSE_REMOVED`; `Follower.sync()`.
- Produces: `liveSync(f: { sync(): Promise<unknown>; head: { number: number } }, url: () => Promise<string>, o?: { WebSocket?: typeof WebSocket; pingMs?: number; pongMs?: number; minBackoffMs?: number; maxBackoffMs?: number; onState?: (s: 'connecting' | 'live' | 'down' | 'removed') => void }): () => void` (returns stop). Defaults per Global Constraints. A new signed URL per connect (nonces are single-use). `sync()` errors are caught (the Follower records them); a stopped Follower's sync throwing `FollowerRemoved`/`FollowerGone` stops the loop.

- [ ] **Step 1: Failing tests** (fake `WebSocket` class, ms-scale timing options):
  - `open → sync once, state live`; `head newer than f.head → sync`; `head not newer → no sync`; `'pong' and junk messages → no sync`.
  - `close 1006 → down, reconnects after minBackoff with a fresh url, then sync on open`; `backoff doubles to max and resets after an open`; `failed connect runs one sync`.
  - `close 4003 → one sync, state removed, no reconnect`.
  - `no pong within pongMs → socket closed and reconnected, then sync` (Review Focus 4).
  - `stop() closes the socket and nothing reconnects`; `sync throwing FollowerGone stops the loop`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + `bun test packages/node`; e2e: a Bun `Follower` with `liveSync` reaches a head another key mined within 5 s without calling `sync()` itself. `make e2e-node` ALL PASS.
- [ ] **Step 5:** Commit `feat(node): liveSync — followers sync on pushed heads, reconnect with backoff, ping/pong (t-144)`.

### Task 3: evm.fun — Live or Manual, polling deleted

**Files:**
- Modify: `packages/web/src/cloud/node.ts` (`SyncInterval`), `packages/web/src/cloud/followerChain.ts` (timer → `liveSync`), the settings control that lists the intervals (grep `setSyncInterval`), `packages/web/src/components/cloud/DevicesPanel.tsx` (status copy if it names an interval)
- Test: `packages/web/test/follower-chain.test.ts`, plus the settings test if one exists

**Interfaces:**
- Consumes: `liveSync`, `NodeClient.subscribeUrl`.
- Produces: `SyncInterval = 'live' | 'manual'`; `getSyncInterval()` maps stored `5`/`15`/`60`/unknown to `'live'`. `followerApproach` options gain `WebSocket?: typeof WebSocket` (tests). Live → one `liveSync` per open follower (started after open, stopped on dispose, on switching to Manual, on losing the tab lock); Manual → no socket. `liveSync` `down` → status `{ kind: 'offline', lastSynced, detail }` (existing copy); `live` → existing synced status. The polling timer, its interval options and failure back-off are deleted; the hidden-tab pause is deleted (sockets stay open).

- [ ] **Step 1: Failing tests:** `default setting is live and opens one socket`; `a stored 15 reads as live`; `manual opens no socket; Sync now still syncs`; `switching manual → live connects, live → manual closes it` (Review Focus 5); `socket down shows offline with lastSynced and keeps pending txs`; `dispose closes the socket`.
- [ ] **Step 2:** FAIL. **Step 3:** implement; `grep -rn "setTimeout\|backoff" packages/web/src/cloud/followerChain.ts` shows no polling left.
- [ ] **Step 4:** PASS + web files individually + `bun run web:build`. Write the browser checklist into the report: `make dev-services`; two browsers on one chain, Live: a send on one appears on the other within seconds with no Sync now; devtools offline → "Offline — last synced…", back online → reconnects and catches up; Manual: Network tab shows no socket, Sync now works; switch back to Live without reload; remove a device from the admin → the removed browser shows removed; three themes, phone width.
- [ ] **Step 5:** Commit `feat(web): followers go live over WebSockets; Live/Manual replaces polling intervals (t-144)`.

### Task 4: Docs, risks, board

- [ ] **Step 1:** `packages/node/README.md` (subscribe route, message, close codes, heartbeat, `liveSync`); `docs/risks/risks.md` R57 — add control "Live followers: no idle polls; a GET /blocks only per new block" and the signed-URL note (single-use nonce, 300 s skew); board t-144 Backlog → Doing with DoD (`- [x]` code/tests/e2e, `- [ ]` checked in a browser). Regenerate cards with `node_modules/.bin/agile card|badge` and `risk-register card|badge`.
- [ ] **Step 2:** Commit `docs: live followers (t-144)`.
