# Live followers: the worker pushes new heads — short design

Board: t-144 (child of t-112). Agreed with Aaron, 2026-11-25, after the SpacetimeDB spike (t-155) showed
subscription followers working. Pure Cloudflare: no SpacetimeDB involved.

## Intent

Followers stop polling. The chain's Durable Object tells each connected follower when it mines a block, and the
follower runs the sync it already has. Idle followers cost nothing (R57), and the follower side is the shape a
SpacetimeDB destination would reuse later (a "new head" signal, then fetch and verify).

## Design

- **Route:** `GET /chains/:id/subscribe` with `Upgrade: websocket`, signed in the query (`ts`, `nonce`, `sig`;
  `auth.ts` already strips them from the signed target, body empty). The worker forwards the request to the chain's
  Durable Object with `stub.fetch` (an RPC call can't return a 101). The DO checks the signature, the nonce and
  `canRead` as for `GET /blocks`; refused → 401/403, no such chain → 404 `no such chain`, no upgrade header → 426.
- **Socket:** hibernating (`ctx.acceptWebSocket(ws, [signer])`, tag = signer; every request is signed today, open-read chains too). On
  connect the DO sends the current head; after each mined block it sends `{"type":"head","number":n,"hash":"0x…"}` to
  every socket.
- **Revocation:** after each block, the DO re-checks `canRead` once per distinct tag and closes sockets that fail
  with code **4003** before sending the head. (The worker has no delete route, so there is no server-side "gone" close; a follower learns a chain is gone from its catch-up sync's 404 `no such chain`.)
- **Heartbeat:** `ctx.setWebSocketAutoResponse` answers the text `ping` with `pong` without waking the DO. The client
  pings every 30 s and reconnects if no `pong` arrives within 10 s.
- **Follower (packages/node):** `Follower` gains an optional live mode: open a socket via a `NodeClient.subscribe`
  helper; on connect and on every `head` message newer than its own, run `sync()` (existing, at most one at a time).
  On close or error it reconnects with backoff (1 s doubling to 60 s, reset on a successful connect); a 4003 close
  runs one sync (its 403 makes the existing removal path fire) and stops reconnecting; a failed connect also runs
  one sync, so a 404 `no such chain` stops it as gone. The Bun Follower uses the same code
  (Bun has `WebSocket`), so tests and e2e cover it.
- **evm.fun:** the sync setting becomes **Live** (default) or **Manual** (no socket; Sync now only). The polling timer,
  its 5/15/60 s options and its failure back-off are deleted; a stored 5/15/60 reads as Live. Status: connected →
  as today; socket down → "offline" with last synced, pending txs kept; Sync now always works. A hidden tab keeps
  its socket (an idle hibernating socket costs nothing).
- **Local:** `make dev-services` (wrangler dev) supports hibernating sockets; `make e2e-node` gains a live-follow case.

## Non-goals

Pushing whole blocks (approach B); SpacetimeDB; changing submit (a POST, settled by its response; other devices'
txs arrive via `head`); token auth for sockets (the signed query is enough; see Risks).

## Approaches

| | Approach | Trade-off |
|---|---|---|
| **A. Head only (chosen)** | Socket carries `{head, hash}`; follower runs its existing `/blocks` sync | Smallest change; one request per new block, none idle; a missed message is caught by the next or by reconnect |
| B. Full blocks | Socket carries the block | Saves one request, but repeats paging, size caps (blocks to 1.5 MB) and gap handling |
| C. SSE / long poll | | A DO can't hibernate on them, so it bills duration; dropped |

## Risks

R57 gains the control "live followers: no idle polls". A signed query sits in the socket URL (logs at the edge);
it is single-use (nonce) and expires with the skew window (300 s), so a leaked one can't reconnect later.

## Left to the builder

Where the DO's broadcast hooks into `ChainHost` (a callback after a mine is fine); message parsing details; the UI
wording of Live/Manual beyond the above.
