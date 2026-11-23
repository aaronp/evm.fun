# Spike: what a chain costs on Cloudflare, and whether incremental storage (t-129) must come first

Date: 2026-11-23. Throwaway measurement spike on top of `spike/cf-chain` (webevm 0.9.1 + revm-wasm 0.3.1). Nothing was
deployed; the only server run was local `wrangler dev`.

**Short answer:** money is not the problem. Every scenario below costs $0 on top of the $5/month Workers Paid minimum,
in both storage designs, for as long as design (a) keeps working. The problem is that design (a), which is today's
full-snapshot rewrite, stops working. Its per-block write, cold boot and memory all grow with the chain's length, so a
busy chain hits the Durable Object's 128 MB memory within days and a personal chain within a few months. The
smallest useful t-129 (described at the end) should land with t-134, before real chains exist that would need
migrating.

## How it was measured

| Script | What it does |
|---|---|
| `spike/cf-chain/cost.ts [maxBlocks]` | Builds a chain with a mixed workload in Bun. At 100, 1,000 and 10,000 blocks it measures 5 one-tx and 5 twenty-tx submits, worker-style: admission (ecrecover plus `canWrite` per tx), execute, then persist both ways into `bun:sqlite` copies of the worker's tables. It also measures the device payloads and the three ways to join. |
| `spike/cf-chain/cost-idle.ts [s]` | Starts local `wrangler dev`, creates a chain and opens a subscription through a byte-counting TCP proxy, then counts the bytes that flow while idle. |
| `spike/cf-chain/cost-heap.ts` | Measures the JS heap held by one node as the chain grows, and by a fresh node loaded from a state-only dump versus a full dump. |

The workload is deterministic and round-robin: an ETH transfer to one of 200 recipients, an ERC-20 `transfer`
(OpenZeppelin `MintableToken` from `packages/contracts`), and `Notice.post(title, 3 lines)`. The `post` call rewrites
the title, the array length, 3 string slots and the revision. There are 3 sender keys, all writers, and `ChainAccess`
and `Aliases` are in genesis, as in the worker. The chain's state stays small: 433 accounts, code entries and slots
at 10,000 blocks.

Caveats:
- Times are from Bun on an M-series Mac, not workerd. The cf-chain spike measured the same steps in workerd at small
  heights and got similar numbers (1-tx block: execute 1 ms, dump under 1 ms, persist under 1 ms).
- SQLite row counts and byte counts do not depend on the runtime. Timings do.
- Design (b)'s diff is computed here by comparing two full `dumpState` flat states. That is O(state), and its time is
  not included in the table. A real build would read webevm's per-block change set, which is not public API (see
  "Ecosystem").

## 1. Per-block cost on the node

### CPU per submit (ms, Bun, mean of 5)

| Height | Block | Admit | Execute | (a) dump + stringify | (a) SQLite write | **(a) total** | (b) SQLite write | **(b) total** |
|---|---|---|---|---|---|---|---|---|
| 100 | 1 tx | 1.6 | 1.0 | 0.4 | 2.5 | **5.5** | 1.0 | **3.6** |
| 100 | 20 tx | 12.6 | 9.5 | 0.8 | 3.8 | **26.7** | 1.0 | **23.1** |
| 1,000 | 1 tx | 0.7 | 0.8 | 3.8 | 11.9 | **17.3** | 0.9 | **2.5** |
| 1,000 | 20 tx | 12.3 | 8.8 | 2.8 | 14.7 | **38.5** | 2.0 | **23.0** |
| 10,000 | 1 tx | 1.3 | 1.3 | 37.3 | 130 | **170** | 1.9 | **4.5** |
| 10,000 | 20 tx | 12.2 | 9.4 | 26.4 | 138 | **186** | 1.2 | **22.7** |

Admission costs about 0.6 ms per tx: ecrecover plus one `canWrite` eth_call. Execution costs about 0.5 ms per tx.
Both are flat. In (a), persisting costs about 17 ms per 1,000 blocks of chain and soon dwarfs everything else. In
(b) it stays flat.

### Bytes and SQLite rows written per block

| Height | Block | (a) bytes written | (a) rows written | (b) bytes written | (b) rows written | Changed accounts / slots |
|---|---|---|---|---|---|---|
| 100 | 1 tx | 427 KB snapshot + 2.0 KB block row | 3 | 2.0 KB block + 0.55 KB state | 4.2 | 1.4 / 1.8 |
| 100 | 20 tx | 615 KB + 38.7 KB | 3 | 38.7 KB + 3.6 KB | 23.2 | 9.6 / 12.6 |
| 1,000 | 1 tx | 4.24 MB + 2.2 KB | 11 | 2.2 KB + 0.67 KB | 4.8 | 1.4 / 2.4 |
| 1,000 | 20 tx | 4.42 MB + 38.7 KB | 11 | 38.7 KB + 3.6 KB | 23.4 | 9.6 / 12.8 |
| 10,000 | 1 tx | 39.5 MB + 2.3 KB | 81 | 2.3 KB + 0.68 KB | 5.0 | 1.2 / 2.8 |
| 10,000 | 20 tx | 39.7 MB + 38.6 KB | 81 | 38.6 KB + 3.6 KB | 23.4 | 9.8 / 12.6 |

- **(a) rows** = 1 block row + every old 1 MB chunk deleted (Cloudflare counts deletes as rows written) + every new
  chunk inserted, so `2·⌈snapshot/1 MB⌉ + 1`. The snapshot grows by about **3.95 KB per 1-tx block** with this mix
  (2.8 KB with plain transfers in `growth.ts`), or about 1.8 KB per tx in 20-tx blocks.
- **(b) rows** = 1 block row + one row per changed account, code entry or storage slot. Its bytes are measured as
  key plus hex value, the encoding used in `cost.ts`.
- **Both designs** also write about 2 rows per signed request, through the nonce replay guard (insert now, delete
  later). That is the submit plus every device's signed `GET /blocks`. At 5 devices this is 12 rows per block, more
  than (b)'s state rows. Using bearer read tokens for GETs would remove it.
- **Not known:** Cloudflare does not say whether a primary-key index update counts as an extra row. A `WITHOUT ROWID`
  table keeps that question moot for (b).
- **The block row is mostly receipts:** 2.3 KB for a 1-tx block, versus 0.64 KB for the raw txs alone.

### Memory and boot (the real limit)

- **Node heap:** in Bun, the node's JS heap was 103 MB at 2,500 blocks, 175 MB at 5,000 and 228 MB at 10,000 (1-tx
  transfers, `cost-heap.ts`). webevm keeps every block, receipt and tx in memory. A fresh node loaded from the
  10,000-block full dump held 130 MB.
- **Snapshot copies:** design (a) also holds the snapshot string in memory (`this.snapshot`) plus a second copy while
  stringifying: 39.5 MB each at 10,000 blocks.
- **The limit:** a Durable Object gets 128 MB. V8 will differ from JavaScriptCore, but the order of magnitude says a
  DO running today's code fails somewhere around **3,000–8,000 blocks**. That is an estimate; it was not reproduced
  in workerd.
- **Boot from rows, (b):** loading a state-only dump took 45–56 ms at every height. The heap of a node loaded that way
  was too small to separate from GC noise.
- **Boot from the full snapshot, (a):** about 59 ms per 1,000 blocks (590 ms at 10,000). A hibernating DO is evicted
  and boots again on the next event, so on a quiet chain (a) pays this on nearly every block.

## 2. Per-device traffic

| What | Bytes | How |
|---|---|---|
| WebSocket `head` notification per block | 105 B payload (+2–6 B frame) | measured (JSON length) |
| `GET /blocks?after=N` response, 1-tx block | 2.4 KB JSON, **0.76 KB gzipped** | measured |
| `GET /blocks?after=N` response, 20-tx block | 38.7 KB JSON, 4.4 KB gzipped | measured |
| …of which raw txs (all a replay needs) | 0.64 KB (1 tx), 11.2 KB (20 tx) | measured; the rest is receipts |
| `GET` request with signed headers | about 0.5 KB | estimated (URL + `x-ts`/`x-nonce`/`x-sig`) |
| Idle, subscribed, 120 s | **0 bytes either way**, socket still open | measured through a TCP proxy against local `wrangler dev` |

Per device that is about 3 KB per block uncompressed (about 1.3 KB gzipped): 300 KB a day at 100 tx/day, and 30 MB
a day (about 13 MB gzipped) at 10,000 tx/day.

When idle, the spike's server sends nothing and the client sends nothing. Cloudflare answers protocol pings without
waking the object, and those pings are not billed. Outgoing WebSocket messages are free. Incoming messages are billed
at 20 per request, and our clients send none.

What was not measured: how long a real browser and Cloudflare's edge keep an idle socket open. The cost model
therefore assumes each device reconnects 24 times a day, and that each reconnect is one upgrade plus one catch-up
GET.

## 3. Joining (Bun)

| Chain | (a) replay all blocks: download / time | (b) state-only snapshot: download / load | (c) full dump: download / load |
|---|---|---|---|
| 100 blocks | 408 KB (48 KB gz) / 151 ms | 162 KB (30 KB gz) / 20 ms | 718 KB (91 KB gz) / 24 ms |
| 1,000 | 2.5 MB (308 KB gz) / 754 ms | 364 KB (59 KB gz) / 45 ms | 4.4 MB (534 KB gz) / 92 ms |
| 10,000 | 22.2 MB (2.7 MB gz) / 6.9 s | 365 KB (59 KB gz) / 56 ms | 38.9 MB (4.6 MB gz) / 590 ms |

- **Replay** downloads what `Replica.sync` downloads: blocks with receipts. A txs-only feed would be about a third of
  that: 135 KB at 100 blocks and 840 KB at 1,000.
- **State-only** means `accounts`, `code` and `storage` plus the last 256 block headers (the `BLOCKHASH` window), with
  empty `receipts` and `transactions`.
  - The state itself is only 47–83 KB, of which code is 26 KB. The 256 headers are about 280 KB, mostly
    `logsBloom`; keeping fewer headers would shrink it.
  - At each size, a node loaded this way had the right state root, and built a next block with the **same hash and
    root** as the DO.
- **Trust:** a state-only joiner trusts the DO's root instead of re-executing history. That is fine for a user's own
  devices, and it is the reason to keep replay available.
- **Times** include building a node (about 15 ms). Every replay ended at the right root.

## 4. Cloudflare cost model

### Prices

Fetched 2026-11-23. The DO pricing page's metadata says it was modified 2026-11-13. Sources:

- <https://developers.cloudflare.com/durable-objects/platform/pricing/>
- <https://developers.cloudflare.com/workers/platform/pricing/>
- <https://developers.cloudflare.com/durable-objects/best-practices/websockets/>
- <https://developers.cloudflare.com/durable-objects/platform/limits/>

| Item | Workers Paid ($5/month minimum per account) | Free |
|---|---|---|
| Worker requests | 10 M/month included, then $0.30/M | 100 k/day |
| Worker CPU | 30 M CPU-ms included, then $0.02/M ms | 10 ms per invocation |
| DO requests (HTTP, RPC, WS upgrade; **incoming** WS messages count 1 per 20; outgoing free; protocol pings free) | 1 M included, then $0.15/M | 100 k/day |
| DO duration (128 MB × wall time while active; **not billed while hibernation-eligible**) | 400 k GB-s included, then $12.50/M GB-s | 13 k GB-s/day |
| SQLite rows read | 25 B included, then $0.001/M | 5 M/day |
| SQLite rows written (deletes count) | 50 M included, then $1.00/M | 100 k/day |
| SQLite stored | 5 GB-month included, then $0.20/GB-month | 5 GB total |

Billable usage is rounded up to the next million before the rate applies. The limits are 10 GB per DO and 8 MB per
row; the spike's 1 MB chunks were sized for an older 2 MB limit.

### Per-block inputs (from sections 1–2)

- **Requests per block:** 1 submit + D device GETs.
- **Rows per block:**
  - (b): 5 state rows + 2·(1+D) nonce rows.
  - (a): `2·⌈3.95 KB·h / 1 MB⌉ + 1` + 2·(1+D) nonce rows.
- **Duration per block:**
  - (b): about 10 ms submit + 3 ms per GET, plus a 50 ms boot whenever the DO had hibernated.
  - (a): adds about 17 ms per 1,000 blocks to the submit, and about 59 ms per 1,000 blocks to every boot.
- **Duration in GB-s** = seconds × 0.128.

These are Bun timings used as estimates for workerd. The warm-GET figure of 3 ms comes from the cf-chain spike.

### (i) Idle chain, 3 devices connected

- **Requests:** 3 devices × 24 reconnects × 2 requests × 30 days = **4.3 k requests/month**.
- **Rows:** about 8.6 k nonce rows.
- **Duration:**
  - (b): 2,160 wakes × 53 ms × 0.128 = **15 GB-s**.
  - (a) at 10,000 blocks: 2,160 × 0.65 s × 0.128 = **180 GB-s**.
- **Storage:** what the chain already holds.

**Cost: $0** beyond the minimum, for both designs. An idle, hibernated chain costs nothing in duration; only the
reconnects show up.

### (ii) Personal chain, 100 tx/day, 3 devices

That is 3,000 blocks a month, about 15 minutes apart, so the DO usually wakes for each block.

- **Requests:** 3,000 submits + 9,000 GETs + 4,320 reconnect requests = **16 k requests/month**.
- **Rows:**
  - (b): 3,000 × (5 + 8) + 8.6 k = **48 k rows/month**.
  - (a) in month 1 (snapshot reaching 12 MB): about 3,000 × 23 = **78 k rows/month**.
  - (a) after a year (about 36 k blocks, a 144 MB snapshot, 289 rows per block): **0.9 M rows/month**. That is if it
    could run that long; memory says it cannot.
- **Duration:**
  - (b): 3,000 × 70 ms + 2,160 × 53 ms = 325 s → **42 GB-s**.
  - (a) in month 1: about 590 s → **76 GB-s**.
  - (a) at 36 k blocks: about 3,000 × 2.7 s → **1,040 GB-s**.
- **Storage:**
  - (b): about 9 MB per month (block rows).
  - (a): about 19 MB per month (block rows plus a snapshot that duplicates them).

**Cost: $0** beyond the minimum, for both designs, and well inside every included amount. (a) does not survive the
memory wall at roughly 3,000–8,000 blocks, which is 1–3 months at this rate.

### (iii) Active chain, 10,000 tx/day, 5 devices, 1 tx per block

That is 300,000 blocks a month, one every 8.6 s on average.

- **Requests:** 300 k + 1.5 M GETs + 14 k reconnect requests = **1.81 M DO requests**.
  - 0.81 M is billable, rounded up to 1 M: **$0.15**.
  - Worker requests are also 1.81 M, inside the 10 M included.
- **Rows, (b):** 300 k × (5 + 12) = **5.1 M rows/month**, inside the 50 M included. At list price that would be $5.10.
  With bearer tokens on GETs instead of nonces it would be 2.1 M.
- **Duration, (b):** about 25 ms per block, plus a 50 ms boot on the roughly 31% of gaps longer than 10 s (assumed
  hibernation delay; Cloudflare says only "a short period"). That gives 300 k × 41 ms = 12.3 k s → **1.6 k GB-s**,
  inside the 400 k included ($0.02 at list price).
- **Storage, (b):** about 0.9 GB per month of block rows, mostly receipts.
  - Billed storage passes the 5 GB-month included after about 6 months; from then on, $0.20 per GB-month.
  - **The 10 GB per-DO cap is reached after about 11 months.**
  - Storing raw txs only (about 0.64 KB per tx) gives 0.2 GB per month, or about 4 years to the cap.
- **(b) total:** about **$0.15/month** beyond the minimum, rising by about $0.20 per month for each month of history
  past month 6.
- **(a):** does not work.
  - The snapshot is 40 MB after day 1 and 120 MB after day 3.
  - The node heap passes 128 MB on about day 1.
  - Persisting at the end of day 1 takes about 170 ms per block.
  - Day 1 alone would be about 530 k rows and 260 GB-s, still free.
  - Hypothetically, over a full month, per-block rows sum to about 350 M rows (**about $300**) and about 170 TB
    written. That figure is O(n²) and shows why the design cannot continue. Batching 20 tx per block does not help
    much, because the snapshot grows about 1.8 KB per tx either way.

### Summary

| Scenario | (a) full snapshot | (b) incremental |
|---|---|---|
| (i) idle, 3 devices | $0 | $0 |
| (ii) 100 tx/day, 3 devices | $0, until memory fails at about 1–3 months | $0 |
| (iii) 10k tx/day, 5 devices | fails within days (O(n²) writes, memory) | about $0.15/month; storage $0.20/GB-month after about 6 months; 10 GB cap at about 11 months unless history is pruned |

Every figure is on top of the $5/month account minimum, which covers many chains of type (i) and (ii). The included
amounts are per account, not per chain. Each additional chain of type (iii) costs, at list price, about $0.27 in DO
requests, $0.54 in Worker requests and $5.10 in rows (rows drop to $2.10 with token GETs), so about $6 per month per
busy chain once the allowances are used up.

## 5. Ecosystem: what we can reuse

### webevm 0.9.1 (read in `node_modules/webevm/src`, types and README)

- **`dumpState()`** takes no options. It always returns the flat state plus **every** block header, receipt and tx.
  There is no history-free dump, prune, compact or checkpoint API.
- **`PersistenceAdapter`** is `{load(), save(state)}`. Its `save` receives that same full dump after every block, so
  the IndexedDB adapter is today's design (a): one record, rewritten every block.
- **`stateHistory: {blocks: N}`** is an opt-in undo log for *historical reads* (`eth_call` at an older block). It is
  off by default, and the spike does not enable it. It is not pruning: it adds to the dump.
  - A side use: its last record names the keys the head block changed. It is only reachable through `dumpState`,
    though.
- **`loadState()` accepts a trimmed dump.**
  - Verified here: accounts, code and storage plus the last 256 headers, with empty receipts and txs, load to the
    right root and produce identical next blocks.
  - So a history-free snapshot is **buildable today, by us, without upstream changes**. We drop the fields ourselves.
  - The caveat from the cf-chain spike still holds: `loadState` does not delete accounts missing from the dump, so
    always load into a fresh node.
- **Per-block change sets exist internally** (`ChangeSet`, `headBlockChangeSet`; the derived trie applies only dirty
  keys) but are not exported.
  - Without upstream help, (b) must find the diff by calling `dumpState()` and comparing its flat state with the
    previous one. That is O(state), which is small here (433 keys), plus an O(chain) walk over block headers inside
    `dumpState`.
  - Upstream asks for t-130:
    - an `onBlock(changes)` hook or a `dumpState({history: false})` option
    - a way to drop old blocks and receipts from memory
- **Memory:** the node keeps all blocks, receipts and txs in memory with no way to prune them. The only way to bound
  it today is to rebuild the node from a state-only dump (about 50 ms).
  - Caveat: after such a rebuild, `eth_getLogs` and receipts for older blocks are gone from the node. The spike's
    `erc20` view recipe scans `Transfer` logs since deploy, so it would have to read the blocks table, or keep a
    holder set, instead.

### revm-wasm 0.3.1

- It exposes a `StateStore` interface (get and commit of accounts, code and slots) and a `MemoryStore`.
- That is the hook for a store backed by DO SQLite, but webevm's revm engine binds revm to webevm's own state manager,
  so using it means bypassing webevm. It has no history, snapshots or pruning.

### The wider revm ecosystem

This part is from general knowledge and was not verified in this spike.

- **revm itself:** confirmed as described. It is an execution library behind a `Database` trait. Its `State` /
  `BundleState` produces per-block change sets and reverts in Rust, but revm-wasm does not expose them, and there is
  no storage or pruning.
- **reth:** has pruning (prune modes per segment) and snapshots ("static files"), but it is a native node on MDBX and
  cannot run in wasm, a browser or a DO. Confirmed: not usable here.
- **anvil (Foundry):** has `anvil_dumpState`/`loadState` and a `--prune-history` flag. It is native too, but it is
  prior art for "state dump without history".
- **Others:** nothing usable in a browser or DO offers pruned persistence: Helios is a light client, and Hardhat's EDR
  is native.

### Verdict

- **Reuse:**
  - `dumpState`/`loadState`, with our own trimming
  - `computeStateRoot` for checks
  - the blocks table the worker already has
- **Build:**
  - the per-block diff and the rows table
  - boot from rows
  - bounding the node's in-memory history by rebuilding it
  - later, pruning old block rows
- **Ask upstream (t-130):**
  - a change-set hook
  - a history-free dump
  - in-memory pruning

## Recommendation

**Should t-129 land before t-134 goes live?** Yes, the smallest version of it, but for robustness, not for cost.

- **Not cost:** cost is $0 above the minimum in every realistic scenario.
- **Robustness:** today's design (a) has O(chain) writes, boot and memory. It will break a personal chain within months
  and a busy one within days, at about 3,000–8,000 blocks.
- **Timing:** t-134 creates the first long-lived chains. Fixing the storage format before they exist avoids migrating
  live DOs later.
- **Upload format:** t-134 currently uploads a full dump. The worker should store only its state part and headers
  from the start.

The smallest t-129 that removes the cliff, roughly a day of work:

1. **State rows instead of the snapshot.** Add a table `state(k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID` with one row
   per account, code entry and slot. On each block:
   - call `dumpState()`
   - compare its flat `accounts`/`code`/`storage` with the previous flat state, kept in memory
   - upsert or delete the changed rows and insert the block row, in one `transactionSync`

   Drop the `snapshot` table.
2. **Headers in the blocks row.** Store the full `SerializedBlock` header (gas, baseFee, miner, mixHash, logsBloom) in
   the block row so boot can rebuild headers.
3. **Boot from rows.** Boot = `makeChain` + `loadState({accounts, code, storage, blocks: last 256 headers, receipts:
   {}, transactions: {}})`, then check the head's state root. This was measured at about 50 ms, flat, and was proven
   to give the same next block.
4. **Bound memory.** Rebuild the node the same way every N blocks (say 1,000). Read old receipts and logs from the
   blocks table, not the node.
5. **Rollback.** On a refused block, rebuild from rows, as the spike already rebuilds from its snapshot.

Defer to later cards:

- pruning the blocks table: it matters only for busy chains, at about 6–11 months
- storing txs only instead of receipts
- the upstream change-set hook (t-130)
- state-only joining for devices (t-131/t-133, where it is shown to work)
- replacing the nonce guard on GETs with read tokens: this halves rows per block, but the rows are free at these
  volumes

### Measured vs estimated

- **Measured:** all byte counts, row counts, Bun timings, join sizes and times, idle bytes, and the Bun heap.
- **Estimated:**
  - workerd timings, which are assumed close to Bun's (consistent with the cf-chain spike at small heights)
  - V8 heap versus JavaScriptCore
  - the hibernation delay (assumed 10 s)
  - the reconnect rate (24 per device per day)
  - whether index updates count as rows written
  - all monthly dollar figures
