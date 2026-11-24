# Chain store: incremental state storage — short design

Board: t-129 (child of the roadmap t-136; before t-134). Evidence: [docs/spikes/cf-cost.md](../../spikes/cf-cost.md).

## Intent and why

A chain node (the Cloudflare Durable Object first, later other nodes) must persist its chain so that per-block work
and memory stay flat as the chain grows. Today's spike rewrites a full webevm dump, with all history, every block,
and webevm holds all history in memory: 170 ms and 39.5 MB written per 1-tx block at 10,000 blocks, and 228 MB of
heap against the DO's 128 MB. The spike measured the fix: store only what each block changed; boot from current state.

## Goals

- `packages/node/src/store.ts`: a UI-free **`ChainStore`** over a SQL interface that both Durable Object SQLite
  (`ctx.storage.sql`) and `bun:sqlite` satisfy, so it is tested in the normal `bun test` suite.
  - `create(dump)`: store a starting chain (state rows + its recent headers + head).
  - `commit(block, diff)`: in one transaction, the block row (full header, txs, receipts) and the changed accounts,
    code and storage slots (upserts; deletions for cleared slots and removed accounts).
  - `head()`, `blocks(from, to)`: for fetch/sync.
  - `stateDump()`: a state-only webevm dump (accounts, code, storage, the last 256 headers, no receipts/txs) that
    `loadState` accepts.
- `packages/node/src/node.ts`: the node lifecycle over webevm + revm: `boot(store)` (fresh node + `loadState(store.stateDump())`),
  `apply(timestamp, txs)` → block + diff (computed by us: touched accounts/slots read before and after, since
  webevm's change sets are internal), and **rebuild every N blocks** (default 1,000) the same way as boot to bound memory.
- Carries over the spike's marked workarounds (timestamp via webevm internal, rebuild on rollback) unchanged (t-130).

## Done when

- A Bun test drives 10,000 mixed blocks (ETH, ERC-20, slot writes and clears) through `node` + `ChainStore` on
  `bun:sqlite` and checks: the state root after a fresh boot equals the live node's at several heights; the next
  block after a boot equals the one without; per-block commit time and rows/bytes written stay flat (no growth trend
  from 1,000 to 10,000); node heap stays under 128 MB.
- Docs (t-137): a page on how a node stores its chain.

## Non-goals

- The worker, routes, auth, access, views, deploy codes (t-134); pruning old blocks; device sync (t-132); upstream
  webevm changes (t-130).

## Anti-goals

- A booted node whose state root or next block differs from the node that wrote the store.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| **Diff rows (chosen)** | Our own per-block diff into account/slot rows; boot from a built state-only dump | Flat cost, proven in the spike; we compute diffs ourselves |
| Trimmed full dump | Keep writing a dump, minus old history | Smallest change, but still rewrites all state every block |
| Upstream change sets | Patch webevm to expose per-block changes | Cleanest diffs, but blocks on t-130 |

## Left to the builder

- Table layout; how "touched" accounts/slots are found (tx receipts' logs and the access list, or a state compare
  over touched addresses); the rebuild interval if 1,000 measures badly.
