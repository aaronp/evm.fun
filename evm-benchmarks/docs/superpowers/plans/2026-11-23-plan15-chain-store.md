# Chain store (t-129) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `ChainStore` that persists only what each block changed, and a `ChainNode` that boots from current state and rebuilds every N blocks, so a chain node's per-block work and memory stay flat as the chain grows.

**Architecture:** New UI-free package `packages/node` (`@evmb/node`). `store.ts` holds state rows, block rows and meta behind a tiny `Sql` interface that Durable Object SQLite and `bun:sqlite` both satisfy. `node.ts` wraps a webevm 0.9.1 + revm node: it applies blocks, diffs state before/after, commits block + diff to the store, and rebuilds itself from `store.stateDump()` on boot, every N blocks and after a rejected block.

**Tech Stack:** Bun, TypeScript, webevm 0.9.1, revm-wasm 0.3.1, viem, `bun:sqlite` (tests only).

**Spec:** `docs/superpowers/specs/2026-11-23-chain-store-design.md` (evidence: `docs/spikes/cf-cost.md`; reference code: `spike/cf-chain/src/chain.ts`, `spike/cf-chain/cost.ts`, `spike/cf-chain/cost-heap.ts`).

## Global Constraints

- webevm **0.9.1** and revm-wasm **0.3.1** exactly (as approach 01 and the spike).
- `packages/node/src/*` must not import `bun:*` or `node:*` (it will run in a Cloudflare Worker); `bun:sqlite` only under `packages/node/test/`.
- Node config: `computeStateRoot: true`, `miningConfig: { type: 'manual' }`, `blockEnv` with `baseFeePerGas: 0n` and the per-block `timestamp` set by mutating `blockEnv` (the spike's marked webevm-internal workaround — keep its `ponytail:` comment, t-130).
- State dump for boot: `{ version: 1, chainId, accounts, code, storage, blocks: last 256 headers, receipts: {}, transactions: {} }`.
- Default `rebuildEvery` = **1000**; `HEADERS_KEPT` = **256**.
- Commit with `git commit --only -m … -- <paths>`; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `design/`. No Cloudflare deploys.
- Default `bun test` stays fast: unit tests use ≤ 400 blocks; the 10,000-block soak is a script (`make soak-node`), not part of `bun test`.

## Review Focus

1. **A slot set to zero / an account emptied** must disappear from the store (row deleted), or a fresh boot carries a stale value and the root differs. Test: transfer a holder's whole ERC-20 balance, then boot and compare roots.
2. **A rejected block** (bad nonce / insufficient funds tx) must leave store and live node exactly as before, and the next good block must match a node that never saw the rejection.
3. **A commit that throws midway** must write nothing (block row and diff in one transaction).
4. **Boot right after a rebuild boundary** (height = k·N) and **between boundaries** must both give the same root and next block hash as the live node.
5. **`create(dump)` from a chain with history** (as t-134 will upload): every block in the dump is fetchable via `blocks()` with its txs and receipts, and `stateDump()` keeps only the last 256 headers.

---

### Task 1: Package and `ChainStore`

**Files:**
- Create: `packages/node/package.json`, `packages/node/src/sql.ts`, `packages/node/src/store.ts`, `packages/node/src/index.ts`
- Test: `packages/node/test/store.test.ts`, `packages/node/test/bunSql.ts`

**Interfaces:**
- Produces:
  - `src/sql.ts`: `type SqlValue = string | number | null`; `interface Sql { exec(query: string, ...bindings: SqlValue[]): Record<string, SqlValue>[]; tx<T>(fn: () => T): T }`
  - `test/bunSql.ts`: `bunSql(db?: Database): Sql` (in-memory `bun:sqlite` by default; `tx` = `db.transaction(fn)()`).
  - `src/store.ts`:
    - `interface StateDiff { accounts: Record<string, string | null>; code: Record<string, string | null>; storage: Record<string, Record<string, string | null>> }` — `null` = delete.
    - `interface StoredBlock { header: SerializedBlock; txs: Hex[]; receipts: unknown[] }` (`SerializedBlock`, `SerializedState` from `webevm`).
    - `class ChainStore { constructor(sql: Sql); exists(): boolean; create(dump: SerializedState): void; commit(block: StoredBlock, diff: StateDiff): void; head(): SerializedBlock; blocks(from: number, to: number): StoredBlock[]; stateDump(): SerializedState }`
    - `export const HEADERS_KEPT = 256`

- [ ] **Step 1: Package.** `@evmb/node`, private, `type: module`, `main: src/index.ts`; dependencies `webevm: 0.9.1`, `revm-wasm: 0.3.1`, `viem: ^2.58.1`; devDependencies `@evmb/contracts: workspace:*`. Run `bun install`; expected: lockfile gains `@evmb/node` only.
- [ ] **Step 2: Write failing tests** in `store.test.ts` (dump fixtures built by hand as `SerializedState` literals):
  - `create then stateDump returns the same accounts, code, storage, chainId and the last 256 headers, with empty receipts and transactions` (fixture with 300 blocks; `stateDump().blocks.length === 256`, last header equals fixture's last).
  - `create stores every block of the dump with its raw txs and receipts` (`blocks(1, 300)` length 300; block 5's `txs` = the fixture's raw txs for block 5's tx hashes; receipts in tx order).
  - `commit applies upserts and deletes` (diff sets account A, deletes account B, sets slot S1, deletes slot S2, sets code C → `stateDump()` reflects exactly that; `head()` is the committed header).
  - `commit is atomic` (a `StoredBlock` whose header number duplicates an existing block → `commit` throws; `stateDump()` and `head()` unchanged — diff rows not written).
  - `exists is false before create, true after; create twice throws`.
- [ ] **Step 3: Run** `bun test packages/node/test/store.test.ts` — expected FAIL (module missing).
- [ ] **Step 4: Implement** `sql.ts`, `store.ts`, `index.ts` (re-exports). Tables: `meta(k PK, v)`, `accounts(addr PK, v)`, `code(addr PK, v)`, `storage(addr, slot, v, PK(addr, slot))`, `blocks(number PK, hash, header JSON, txs JSON, receipts JSON)`. `stateDump()` reads all state rows plus the last `HEADERS_KEPT` headers ordered by number.
- [ ] **Step 5: Run** the tests — expected PASS. Then `bun test` from the repo root — expected all pass (Bun may segfault at exit, risk R11: rerun).
- [ ] **Step 6: Commit** `packages/node`, `bun.lock` (only if `bun install` changed it for `@evmb/node`): `feat(node): ChainStore — state rows + block rows, state-only dump (t-129)`.

### Task 2: `ChainNode` — apply, diff, boot, rebuild

**Files:**
- Create: `packages/node/src/node.ts`
- Modify: `packages/node/src/index.ts` (export)
- Test: `packages/node/test/node.test.ts`, `packages/node/test/workload.ts`

**Interfaces:**
- Consumes: `ChainStore`, `StateDiff`, `StoredBlock`, `HEADERS_KEPT`, `Sql` (Task 1).
- Produces (`src/node.ts`):
  - `interface NodeConfig { wasm: WebAssembly.Module | ArrayBufferView; rebuildEvery?: number }`
  - `function diffState(before: SerializedState, after: SerializedState): StateDiff` — compares `accounts`, `code`, `storage` only; a key present before and absent after → `null`; an address whose storage map disappears → each of its old slots `null`.
  - `class ChainNode { static boot(store: ChainStore, cfg: NodeConfig): Promise<ChainNode>; static create(store: ChainStore, dump: SerializedState, cfg: NodeConfig): Promise<ChainNode>; apply(timestamp: number, txs: Hex[]): Promise<StoredBlock>; readonly node: SlimNode; head(): SerializedBlock; stateRoot(): Promise<string>; blocksSinceRebuild: number }`
  - `apply`: send txs, `mine()`, read receipts; if any tx is rejected or mining throws → rebuild from the store and rethrow; else `diffState(prevDump, dumpState())`, `store.commit({header, txs, receipts}, diff)`; when `blocksSinceRebuild >= rebuildEvery` rebuild from `store.stateDump()`.
  - `test/workload.ts`: `workload(): { genesis(): SerializedState; nextBlock(i: number): Promise<Hex[]> }` — deterministic keys; block mix: ETH transfers, `AssetToken` deploy at block 1 then transfers, every 10th block one holder sends its whole balance (slot to zero), every 7th block 20 txs, else 1–3.

- [ ] **Step 1: Write failing tests** in `node.test.ts` (wasm from `require.resolve('revm-wasm/revm.wasm')`; store on `bunSql()`; `rebuildEvery: 100`; 350 blocks of `workload()`):
  - `a fresh boot matches the live node` — at heights 99, 100, 101, 250, 350: `ChainNode.boot(sameStore)` → `stateRoot()` equals live, and applying the same next block on both gives the same header `hash` and `stateRoot`.
  - `a zeroed balance leaves the store` — after a whole-balance transfer, the holder's slot is absent from `store.stateDump().storage[token]`.
  - `a rejected block changes nothing` — `apply` with a tx at a wrong nonce rejects; `head()`, `stateRoot()` and `store.stateDump()` equal their values before; the next good block's hash equals a reference node's that never saw the rejection.
  - `rebuild resets history` — after a rebuild, `(await node.node.dumpState()).blocks.length <= HEADERS_KEPT + rebuildEvery`.
  - `diffState` unit cases: added, changed, removed account; removed slot; removed storage map.
- [ ] **Step 2: Run** `bun test packages/node/test/node.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** `node.ts` (node construction lifted from the spike's `makeChain`, without the genesis access contracts) and `workload.ts`. `diffState` over whole-state dumps is O(state) per block: mark it `// ponytail: whole-state compare per block; touched-keys diff if state grows past a few MB`.
- [ ] **Step 4: Run** the tests — expected PASS; then root `bun test` — all pass.
- [ ] **Step 5: Commit** `feat(node): ChainNode — per-block diffs, boot from current state, rebuild every N (t-129)`.

### Task 3: 10,000-block soak, docs, board

**Files:**
- Create: `packages/node/soak.ts`, `packages/node/README.md`
- Modify: `Makefile` (target `soak-node`), `docs/board/board.md` (t-129 DoD ticks + results), `docs/adr/decisions.md` (ADR "Incremental chain storage"), `docs/risks/risks.md` (risk: diff is a whole-state compare — O(state) per block)

**Interfaces:**
- Consumes: `ChainNode`, `ChainStore`, `workload()`, `bunSql()`.

- [ ] **Step 1: Write `soak.ts`:** 10,000 `workload()` blocks, `rebuildEvery: 1000`, file-backed `bun:sqlite` in `$TMPDIR`. Every 1,000 blocks print one JSON line `{ height, commitMsAvg, rowsWrittenAvg, bytesWrittenAvg, heapMB }` (heap after `Bun.gc(true)`). At 2,500, 5,000 and 10,000: fresh boot → root equals live, next block hash equal. Exit non-zero if any root/hash mismatch, if heap ≥ 128 MB, or if `commitMsAvg` of the last 1,000 blocks is more than 2× that of blocks 1,000–2,000.
- [ ] **Step 2: Makefile** `soak-node: ## 10,000-block chain-store soak (t-129)` → `bun packages/node/soak.ts`. Run `make soak-node` — expected exit 0; paste its output into the board card.
- [ ] **Step 3: README** "How a node stores its chain": tables, what a commit writes, boot, rebuild every N, what is not kept (old receipts/txs in memory; history stays in `blocks`), the soak numbers, link to `docs/spikes/cf-cost.md`.
- [ ] **Step 4: Board / ADR / risk.** Tick t-129's DoD with the soak numbers; ADR "Incremental chain storage: state rows + block rows; boot from a state-only dump" (context, decision, consequences, alternatives from the design); risk for the whole-state diff ceiling. Regenerate: `node_modules/.bin/agile card docs/board/board.md docs/board`, `make adr`, `make risks`.
- [ ] **Step 5: Commit** `docs(node): soak, README, ADR, risk; t-129 done criteria (t-129)`.
