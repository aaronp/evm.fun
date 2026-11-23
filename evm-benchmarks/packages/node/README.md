# @evmb/node: how a node stores its chain

A chain node persists only what each block changed, and boots from current state, so per-block work and memory stay flat as the chain grows. Design: [chain store](../../docs/superpowers/specs/2026-11-23-chain-store-design.md). Why: [the cost spike](../../docs/spikes/cf-cost.md) (a full dump rewritten per block cost 170 ms and 39.5 MB per 1-tx block at 10,000 blocks).

## Tables

`ChainStore` (`src/store.ts`) sits on a tiny `Sql` interface (`exec`, `tx`) that Durable Object SQLite and `bun:sqlite` both satisfy.

| Table | Key | Holds |
|---|---|---|
| `meta` | `k` | `chainId` |
| `accounts` | `addr` | account (balance, nonce) as webevm serialises it |
| `code` | `addr` | contract code |
| `storage` | `addr, slot` | one row per non-zero slot |
| `blocks` | `number` | hash, full header, raw txs, receipts (JSON) |

## What a commit writes

`ChainNode.apply(timestamp, txs)` runs the block, then diffs the state dump before and after (`diffState`) and calls `store.commit(block, diff)`: in one transaction, an upsert or delete per changed account, code and slot row, plus one block row. A slot set to zero or an emptied account is deleted, so a fresh boot cannot carry a stale value. If a tx is rejected or the commit throws, nothing is written and the node is rebuilt from the store.

## Boot and rebuild

`stateDump()` builds a state-only webevm dump (all state rows, the last 256 headers, empty receipts and transactions) and `loadState` takes it: that is `ChainNode.boot`. The node rebuilds itself the same way after a rejected block and every `rebuildEvery` blocks (default 1,000), because webevm keeps all history in memory and has no pruning.

## What is not kept

The in-memory node keeps no old receipts or txs, and only the last 256 headers plus up to `rebuildEvery` blocks since the last rebuild. History stays in `blocks` (read with `store.blocks(from, to)`). Nothing is pruned from the store.

## Soak

`make soak-node` runs 10,000 mixed blocks (ETH, ERC-20, whole-balance transfers that zero a slot) on file-backed `bun:sqlite`, `rebuildEvery: 1000`. At 2,500, 5,000 and 10,000 it boots a node from a copy of the store and checks the same root and the same next block hash as the live node. It fails on a mismatch, memory (JS heap plus `external`; a Durable Object's 128 MB also covers wasm memory) of 128 MB or more, or a last-1,000-block commit time over 2x that of blocks 1,000-2,000.

"Rows and bytes written" are measured by wrapping `store.commit`: rows = diff keys + 1 block row; bytes = JSON length of the diff plus the block; `commitMsAvg` is the SQL commit only; the diff compute (the O(state) part) is not in it. Memory is read after a GC, a short yield and a second GC (finalizers of disposed wasm nodes run after a tick; without the yield the reading was inflated to about 130 MB).

Result (Bun on an M-series Mac, 2026-11-23): commit 0.54-0.65 ms per block, 8 rows and about 9.9 KB per block, memory (`memMB`) 44-58 MB (JS heap 33-41 MB), all flat from 1,000 to 10,000 blocks; boots matched at all three heights.

`external` only partly reflects wasm linear memory (one revm node: external +2.4 MB, rss +15.6 MB), so `memMB` is a lower bound; the real Durable Object figure is measured under workerd in t-134.

Limit: `diffState` compares whole-state dumps, so it is O(state) per block. Fine for the soak's small state; switch to a touched-keys diff when state grows past a few MB (risk R51).
