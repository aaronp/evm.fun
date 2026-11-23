# Spike report: personal chain on a Cloudflare Durable Object (t-128)

Branch `spike-cf-chain`, commit `1c24e48`, code in `evm-benchmarks/spike/cf-chain/`.
Everything ran locally under `wrangler dev` 4.81 / workerd (no deploy, no login, no credentials).

**Verdict: it works.** One SQLite-backed DO per chain runs webevm 0.9.1 with the **revm-wasm** engine unchanged. It authorises signed device requests, sequences submissions, persists state and blocks atomically, survives a real process restart, and two device replicas replay its blocks to the **same state root and the same block hash**. There are two real problems a production build would have to fix. First, the snapshot is O(chain). Second, determinism relies on a webevm internal for per-block timestamps.

| # | Item | Result |
|---|------|--------|
| 1 | webevm + revm in a DO under wrangler dev | **worked** (`engine = revm-wasm` reported by the DO) |
| 2 | API create / submit(expectedHead) / fetch(afterBlock) / subscribe | **worked** |
| 3 | Persistence: snapshot + block + receipts in one SQLite tx; restart continues at same head | **worked** (snapshot grows linearly with chain length, see risks) |
| 4 | Membership + EIP-191 signed requests; non-members refused; owner add/remove | **worked** |
| 5 | Replica (Bun) re-executes and compares root + hash | **worked in Bun**. Browser: **partly**. It bundles with `--target=browser`, but I did not run it in a browser. |
| 6 | Demo: A + B + DO, outsider refused, restart persists | **worked**: `ALL PASS`, 26 checks |

Stretch (playground `ChainHandle` over the remote chain): **not done**.

---

## Layout

```
spike/cf-chain/
  wrangler.jsonc     DO binding CHAIN -> ChainDO, new_sqlite_classes migration, nodejs_compat
  src/chain.ts       shared by DO and replica: makeChain(genesis, wasm), applyBlock(chain, ts, txs), EIP-191 auth helpers
  src/worker.ts      Worker router + ChainDO (auth, mutex, SQLite, hibernating WebSockets)
  src/replica.ts     Device (signed HTTP/WS client) + Replica (local webevm/revm node: sync, optimistic submit, subscribe)
  demo.ts            end-to-end demo; spawns wrangler dev twice against one --persist-to dir
  determinism.ts     varies block/genesis timestamps and compares roots/hashes
  growth.ts          snapshot size and load time at 10..2000 blocks
```

## How to run

```sh
cd evm-benchmarks/spike/cf-chain
bun demo.ts          # starts/stops wrangler dev itself (port 8799, state in .wrangler/demo-state)
bun determinism.ts   # determinism probe (Bun only)
bun growth.ts        # snapshot growth (Bun only)
wrangler dev --port 8799   # just the server
```

In the Claude Code sandbox the run also needed `WRANGLER_LOG_PATH`/`XDG_CONFIG_HOME` pointed at `$TMPDIR` (demo.ts sets them). Wrangler's attempts to reach `workers.cloudflare.com` were blocked, and that did not matter for local dev.

## 1. It runs: revm in workerd — worked

- `import wasm from 'revm-wasm/revm.wasm'` works straight away. Wrangler's default CompiledWasm rule turns it into a `WebAssembly.Module`, `createRevmEngine({wasm})` accepts a Module, and revm-wasm then uses the synchronous `new WebAssembly.Instance`. That matters because Workers forbid compiling wasm from bytes at runtime, and this path never does.
- I needed no patches to webevm or revm-wasm. The only config change was the compatibility date: `2026-10-01` was refused because the local workerd supports up to `2026-04-12`, so the spike pins `2026-04-12`. `nodejs_compat` is on.
- Evidence:
  - `wrangler deploy --dry-run --outdir dist` gives `Total Upload: 2495.15 KiB / gzip: 710.91 KiB`.
  - The demo prints `PASS  DO node engine = revm-wasm` (the DO's `node.engine.id`).
- I did not need the default engine as a fallback.

## 2. API — worked

All requests are signed (see 4). The Worker generates the chainId and routes `/chains/:id/*` to `idFromName(id)`.

| Call | Route | Notes |
|---|---|---|
| create(genesis, accessPolicy) → chainId | `POST /chains` `{genesis:{chainId,timestamp,alloc}, accessPolicy:{members}}` | signer becomes owner; 201 `{chainId, head}` |
| info | `GET /chains/:id` | genesis, head, members, engine, instance, bootMs |
| submit(chainId, expectedHead, signedTxs) → block | `POST /chains/:id/submit` `{expectedHead, timestamp?, txs}` | **409 `stale head`** if expectedHead ≠ head hash; 400 + rollback if any tx is rejected |
| fetch(chainId, afterBlock) → blocks | `GET /chains/:id/blocks?after=N` | up to 100 blocks with raw txs, receipts, stateRoot, proposer |
| subscribe | `GET /chains/:id/subscribe` (WebSocket, auth in query) | hibernation API (`ctx.acceptWebSocket`, tagged by signer); pushes `{type:'head', number, hash}` |
| members | `POST /chains/:id/members` `{add?, remove?}` | owner only; removing a member closes their sockets (4003) |

How a submission is handled:

1. Every mutation goes through an explicit promise-chain mutex (`serial()`), which holds across all the awaits inside webevm.
2. The DO checks the signature, then membership, then `expectedHead`, then the timestamp (≥ parent, ≤ now+30 s).
3. `applyBlock` sends each tx with `eth_sendRawTransaction` in manual mining mode, then calls `mine()`.
4. `dumpState` is written in one `transactionSync` with the block row, receipts and snapshot chunks.
5. The DO broadcasts the new head over the WebSockets.

If a tx is rejected, the DO calls `loadState(lastSnapshot)` so nothing stays half-queued.

Demo evidence:
```
PASS  A creates chain -> 201 50e984af-…
PASS  A submits block 1 (deploy + transfer) -> 200
PASS  A submits a 50-tx block -> 200
PASS  B followed via subscription to block 22 (22 notifications)
PASS  B submits on a stale head -> 409 stale head
PASS  B submits on current head -> 200 block 23
PASS  A syncs B's block, heads equal
```

## 3. Persistence — worked

SQLite tables:

- `meta`: chainId, genesis
- `members`: addr, role
- `blocks`: number, hash, parent, ts, state_root, proposer, txs, receipts, snapshot_bytes
- `snapshot`: the dumpState JSON in 1 MB chunks, because a DO SQLite value is capped at 2 MB
- `nonces`

On boot, the DO runs `blockConcurrencyWhile`: it builds the node from the genesis, then calls `loadState(latest snapshot)`.

The restart is real:

- demo.ts kills the whole wrangler/workerd process group.
- It waits until the port stops answering.
- It starts wrangler again on the same `--persist-to`.
- It checks that the DO instance id changed.

```
PASS  after restart DO head = 23 0xe59db4cd… (same as before)
PASS  restart gave a new DO instance (31932d6b -> d18393e9)
PASS  post-restart block 24 extends old head
PASS  B replays post-restart block, root+hash match
```

## 4. Membership and auth — worked

- **Request signing:** EIP-191 `personal_sign` over
  `cf-chain v1\n{METHOD} {path?query minus auth params}\n{sha256(body)}\n{ts}\n{nonce}`.
  It is sent in the headers `x-ts`, `x-nonce` and `x-sig`; WebSockets send it as query params instead.
- **Signer check:** the DO recovers the signer address with viem `recoverMessageAddress`.
- **Replay protection:** the timestamp must be within ±300 s, and each nonce can be used once (stored in SQLite and pruned).

```
PASS  B (not yet approved) refused with 403
PASS  B cannot add itself (owner only)
PASS  A (owner) approves B
PASS  unsigned request refused with 401
PASS  non-member X: GET chain -> 403
PASS  non-member X: fetch blocks -> 403
PASS  non-member X: submit -> 403
PASS  non-member X: subscribe -> refused
PASS  replayed signed request: first 200, replay 401
PASS  A removes B -> B refused, B's socket closed 4003
```

Not done: limiting *tx senders* to members. The request is authenticated, but the signed txs inside it can come from any key. The owner key also cannot be rotated.

## 5. Replicas — worked in Bun, browser partly

`Replica` holds its own `makeChain(genesis)` node with exactly the same config as the DO: revm, `computeStateRoot: true`, manual mining, pinned `genesisTimestamp`. It has three operations:

- **open:** builds the local node, then checks that the local genesis hash and root equal the DO's block 0.
- **sync / subscribe:** fetches blocks after its local head, checks `parentHash`, replays them with `applyBlock` at the DO's timestamp, and compares the state root and block hash.
- **submit (proposal):** executes the txs optimistically on the local node, at a timestamp the replica picks itself. It then posts them with `expectedHead`. If the DO refuses, the replica rolls back with `loadState`. If the DO accepts, the replica checks that the DO's block equals its local block, so it never has to re-execute.

```
PASS  A: optimistic local root+hash == DO for 22 blocks
PASS  B: replayed root+hash == DO for 22 blocks
PASS  B's local counter storage = 70 (expect 70)
PASS  fresh replica replays 24 blocks from genesis in 41 ms, all match
```

The replica uses only `fetch`, `WebSocket`, `crypto.subtle`, viem and webevm, and the caller passes in the wasm.

- `bun build --target=browser src/replica.ts --minify` produces 509 KB, or 155 KB gzipped (wasm not included).
- I did **not** run it in a real browser, because no playwright package is installed.

## Determinism findings

These come from `bun determinism.ts`: the same genesis and the same signed txs, with one input changed at a time.

```
pinned inputs, rerun 1.1 s later   transfer-block: root same hash same | TIMESTAMP-reading block: root same hash same
block timestamp +1 s               transfer-block: root same hash DIFF | TIMESTAMP-reading block: root DIFF hash DIFF
genesis timestamp +1 s             transfer-block: root same hash DIFF | TIMESTAMP-reading block: root same hash DIFF
```

- **Block timestamp** is the only thing that varies by default: webevm uses the wall clock when mining.
  - It always breaks the hash.
  - It breaks the state root once any contract reads `TIMESTAMP`.
- **Genesis timestamp** is also wall clock by default. It changes every block hash through `parentHash`, but not the roots.
  - Fix: pin it with the `genesisTimestamp` option, which the spike does from the genesis record.
- **webevm has no per-block timestamp control.** There is no `evm_setNextBlockTimestamp` and no `mine({timestamp})`. `blockEnv.timestamp` exists, but it pins *every* mined block to one value.
  - The spike's workaround: webevm keeps `options.blockEnv` **by reference** (`const blockEnv = options.blockEnv`) and reads `.timestamp` at each mine. So `applyBlock` changes `env.timestamp` before each `mine()`.
  - This works on 0.9.1 but relies on an internal. It is marked with a `ponytail:` comment in `src/chain.ts`.
  - The real fix is upstream: `mine({timestamp})` or `evm_setNextBlockTimestamp`.
- **Coinbase, prevRandao and baseFee** are constant by default: zero coinbase, constant prevRandao, flat 1 gwei base fee with no EIP-1559 adjustment. Both sides get them from the same config, so they are deterministic. They could also be pinned through `blockEnv`.
- **Block hash** is fully reproducible once both timestamps are pinned. With `computeStateRoot: true` the header carries the real state root, and that is included in the hash.
- **The proposer picks the timestamp** (bounded by the DO), so an optimistic local block can equal the canonical one.

## Measurements

These are local, on an M-series Mac. In workerd, `performance.now()` has 1 ms granularity, so "0" means under 1 ms.

| What | Value |
|---|---|
| revm.wasm | 1,232,019 B |
| Worker bundle (`--dry-run`) | 2,495 KiB total / 711 KiB gzip (worker.js 1.32 MB + wasm) |
| wrangler dev ready | ~700 ms |
| DO cold request after restart (client wall clock, includes DO boot) | 30–32 ms |
| DO boot (makeChain + loadState of a 161 KB snapshot, in-DO) | 9 ms |
| warm GET | ~3 ms |
| 1-tx block in DO, median (n=20) | execute 1 ms, dump <1 ms, persist (SQLite tx) <1 ms; round trip ~5 ms (wrangler log) |
| 50-tx block in DO | execute 18–19 ms, dump <1 ms, persist 1 ms; round trip ~21 ms |
| first block after restart | execute 10 ms (cold engine) |
| replica local execute/replay per 1-tx block (Bun) | ~1.1 ms |
| fresh replica full replay, 24 blocks | 41 ms |

Snapshot size per block number, in bytes. This is the DO demo chain (the counter contract plus the 50-tx block):

`0:1558 5:18477 10:32926 15:47391 20:61856 21:64749 22:158771 23:161663`

Snapshot growth in Bun (`growth.ts`, 1-tx transfer blocks):

```
blocks=10   snapshot=30KB    dump+stringify=0.3ms  parse+load=2.0ms
blocks=100  snapshot=284KB   dump+stringify=0.4ms  parse+load=5.1ms
blocks=500  snapshot=1416KB  dump+stringify=1.8ms  parse+load=36.6ms
blocks=1000 snapshot=2831KB  dump+stringify=2.3ms  parse+load=48.6ms
blocks=2000 snapshot=5665KB  dump+stringify=4.9ms  parse+load=92.7ms
```

That is about **2.8 KB per 1-tx block**, and the cause is that `dumpState` includes every block, receipt and tx. The DO rewrites the whole snapshot on every block, so the write volume is O(chain) per block, and cold boot is O(chain) too. Blocks and receipts are already stored separately in SQLite, so this is double storage.

## What a real build would need

- **Storage adapter.** Persist the flat state *incrementally* (account, code and slot rows changed per block) instead of the whole `dumpState`. Keep history only in the `blocks` table. Use either:
  - a webevm `PersistenceAdapter` with a diff API, or
  - a revm `StateStore` backed directly by DO SQLite. revm-wasm already exposes `StateStore` and host functions.

  Either way, add periodic checkpoints and prune history from the snapshot (`stateHistory` off).
- **Upstream webevm:** a per-block timestamp (`mine({timestamp})`), and a dump that leaves out history.
- **Auth:**
  - real device enrolment (QR/pairing flow, owner-signed invites)
  - owner key rotation, and multiple owners or thresholds (the card's "permission contract" idea)
  - tx-sender ↔ device binding
  - rate limits
  - optionally session tokens so each request is not ecrecovered (~1 ms each in JS)
  - a WebSocket auth refresh
- **Sync protocol:**
  - paging beyond 100 blocks (the loop exists)
  - catch-up from a snapshot instead of from genesis for new devices
  - a resubmit/rebase policy after a 409 (the replica currently just refuses)
  - offline proposals
  - the DO verifying the proposer's claimed root, which would let a replica skip re-execution
- **Ops:** limits on block gas and txs per submit, DO alarms to compact, deploy and observability. None of this was tried, since the spike ran local only.

## Risks

- **Snapshot O(chain):** per-block write and boot time grow linearly; boot is about 50 ms per 1,000 small blocks in Bun. DO SQLite costs per row written, and the chunked snapshot is rewritten every block. This is the first thing to fix.
- **The timestamp hack depends on webevm internals.** A webevm upgrade could silently break replay determinism. The demo's root+hash checks would catch it.
- **workerd version drift.** The production runtime and compat date are newer than the local workerd. Production was not tested.
- **The single-threaded DO is the throughput ceiling:** about 1 ms per small tx locally, and the mutex serialises everything. That is fine for a personal chain.
- **Bundle size:** 711 KiB gzip is fine on paid Workers (10 MB) and close to comfortable on free (3 MB).
- **Wasm memory per DO instance:** not measured.
- **Browser replica not executed** in a real browser. It bundles, but WebKit/Chromium behaviour with the revm wasm URL path is unproven here; the existing playground does use revm in the browser.
- **The non-member WebSocket refusal** is observed only as "refused" (the upgrade gets a 403). I did not check the close code.
