# Devices, part 1: worker routes, join, cursors, Follower — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cloud node serves a chain's current state, its blocks and its members (with each device's position), lets a device join with an owner-issued code, and a UI-free `Follower` keeps a device's copy in step, checked by state root — proven end to end with two devices, including removal.

**Architecture:** New `ChainService` methods (state, blocks, members, join, cursors) behind new router routes, mirrored in `NodeClient`. `Follower` (packages/node) builds a webevm node with the exact config `ChainNode` uses (one shared function), loads the state dump, and replays fetched blocks. Part 2 (evm.fun) builds on this.

**Tech Stack:** Bun, TypeScript, webevm 0.9.1 + revm-wasm 0.3.1, viem, Cloudflare Workers/DO via wrangler 4.81.0 (local only).

**Spec:** `docs/superpowers/specs/2026-11-23-devices-follow-design.md` (with `2026-11-23-node-cursors-design.md`, superseded on the route; and t-134's `2026-11-23-deploy-to-cf-design.md`).

## Global Constraints

- webevm **0.9.1**, revm-wasm **0.3.1**. `packages/node/src/*` must not import `bun:*` or `node:*`.
- Use `ChainNode` only via `create/boot/apply/read/head/stateRoot/dispose`; never call it from inside a `read` callback. All `ChainService` writes go through its `#writes` queue.
- Routes (reader = `canRead(signer)`; every request signed as today): `GET /chains/:id/state` (reader) → `{ head: BlockSummary, dump }`; `GET /chains/:id/blocks?after=N` (reader) → `{ head: BlockSummary, blocks: BlockRecord[] }`, at most **100** blocks; `GET /chains/:id/nodes` (reader) → `NodesView`; `POST /chains/:id/join` (any signer) `{ claim }` → `{ head: BlockSummary, role: 'reader' | 'writer' }`.
- `x-node-name` request header (≤ **32** chars, trimmed; added to CORS allow-headers) names the device.
- Cursor rule: on `GET blocks`, upsert `{address, name, block, seenAt}` when the delivered block is higher than the stored one, or when the stored `seenAt` is ≥ **60 s** old; otherwise write nothing.
- Join precheck: the claim is a `claim(string)` call to this chain's `ChainAccess`, sent by the signer; `invites(hash)` has uses left, `timestamp <= expiry`, and `grants & (GRANT_READER | GRANT_WRITER)` non-zero (`GRANT_READER = 1`, `GRANT_WRITER = 2`); refused claims mine nothing (403 `bad, used or expired code`); failures count toward the per-IP limit (10 per 10 min → 429), same table as deploy redeems.
- `inviteTx` gains `grants` as its last parameter, default `GRANT_CREATE_CHAIN` (existing callers unchanged).
- Commit with `git commit --only -m … -- <paths>`, messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `design/`, `.env.*`, `.run/`, root `package.json`. Never run `wrangler login`/`deploy`. Full `bun test` before each commit (risk R11: rerun; may need to run outside the sandbox).

## Review Focus

1. **A removed device keeps polling:** its next `blocks`/`state`/`nodes` is 403, and `nodes` no longer lists it (its cursor is dropped from the view even though the row remains).
2. **A follower that falls behind more than one page** (> 100 blocks) catches up fully in one `sync()` and ends at the cloud head with matching root and hash.
3. **A join with a create-chain code, an expired code, or a used-up code** → 403 and no block; a member joining again with a valid code is harmless (no duplicate role).
4. **The cloud chain rebuilds its node every N blocks:** a follower that synced before a rebuild boundary keeps matching after it (same config both sides).
5. **An idle follower polling every few seconds** writes no cursor row more than once a minute.

---

### Task 1: `ChainService` — state, blocks, members, join, cursors

**Files:**
- Modify: `packages/node/src/service.ts`, `packages/node/src/client.ts` (types + `GRANT_READER`, `GRANT_WRITER`)
- Test: `packages/node/test/service-devices.test.ts`

**Interfaces:**
- Produces (types in `client.ts`): `BlockRecord = { header: SerializedBlock; txs: Hex[]; receipts: unknown[] }`; `Member = { address: Address; role: 'admin' | 'writer' | 'reader'; name?: string; block?: number; behind?: number; seenAt?: number }`; `NodesView = { head: BlockSummary; admin: Address; readOpen: boolean; members: Member[] }`.
- Produces (`ChainService`): `state(): Promise<{ head: BlockSummary; dump: SerializedState }>`; `blocks(after: number, limit = 100): { head: BlockSummary; blocks: BlockRecord[] }`; `touch(address: string, name: string | undefined, block: number, at: number): void` (the cursor rule; `cursors` table created lazily); `nodes(): Promise<NodesView>` (admin + writers + readers from `ChainAccess`, a member that is both listed once with the higher role, joined with cursors; non-member cursors omitted; `behind = head - block`); `join(signer: string, claim: Hex, timestamp: number): Promise<{ head: BlockSummary; role: 'reader' | 'writer' }>` (precheck above, inside `#writes`).

- [ ] **Step 1: Failing tests** (bunSql, as service.test.ts builds chains): `state() boots a fresh node to the same root`; `blocks(after) pages at 100 and returns head`; `join with a reader code adds a reader; with a writer code a writer`; `join refuses a create-chain code, an expired code, a used-up code — 403, head unchanged`; `joining twice with valid codes leaves one role entry`; `nodes lists admin/writers/readers once each, with cursor fields; a removed member and its cursor are gone`; `touch writes on a higher block, and on an empty poll only after 60 s`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** PASS + full suite.
- [ ] **Step 5:** Commit `feat(node): service state, blocks, members, device join and cursors (t-132, t-133, t-140)`.

### Task 2: Router routes and `NodeClient`

**Files:**
- Modify: `packages/node/src/router.ts`, `packages/node/src/client.ts`
- Test: `packages/node/test/router-devices.test.ts` (in-process `handle` over `ChainHost`/bunSql, as the web stand-in does)

**Interfaces:**
- Consumes: Task 1.
- Produces: the four routes (Global Constraints); `ChainRequest.name` from `x-node-name`; `NodeClient` gains `constructor(baseUrl, account?, opts?: { name?: string })` (sends `x-node-name` when set), `state(chainId)`, `blocks(chainId, after)`, `nodes(chainId)`, `join(chainId, claim)`; `inviteTx(account, nonce, access, code, ttlS, uses, grants = GRANT_CREATE_CHAIN)`; `accessTx(account: LocalAccount, nonce: number, access: Address, fn: 'removeReader' | 'removeWriter' | 'setReadOpen', arg: Address | boolean): Promise<Hex>`; `nonce(chainId)` accepts any chain id.

- [ ] **Step 1: Failing tests:** each route's happy path and its 401/403/404; `GET blocks` records the caller's cursor with its `x-node-name`; `POST join` with a bad code counts toward 429; a non-member can call `join` but not `state`; `nonce` works for a non-root chain.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + full suite.
- [ ] **Step 5:** Commit `feat(node): routes for state, blocks, nodes and join; NodeClient device methods (t-132, t-133, t-140)`.

### Task 3: `Follower`

**Files:**
- Modify: `packages/node/src/node.ts` (extract `nodeOptions(env)` — the one config both sides use)
- Create: `packages/node/src/follower.ts`
- Modify: `packages/node/src/index.ts`
- Test: `packages/node/test/follower.test.ts` (in-process worker as Task 2)

**Interfaces:**
- Consumes: `NodeClient` (Task 2), `nodeOptions`.
- Produces: `class Follower { static open(client: NodeClient, chainId: string, wasm: NodeConfig['wasm']): Promise<Follower>; sync(): Promise<BlockSummary>; read<T>(fn: (node: SlimNode) => Promise<T>): Promise<T>; head: BlockSummary; status: 'following' | 'removed' | 'mismatch'; dispose(): Promise<void> }` — `sync` loops pages until caught up; a 403 sets `status = 'removed'` and throws `FollowerRemoved`; a root or hash mismatch sets `status = 'mismatch'` and throws with block number and both roots; serialised; after `removed`/`mismatch`, `read` throws.

- [ ] **Step 1: Failing tests:** `follows 250 admin-submitted blocks across pages and rebuild boundaries (rebuildEvery 100 on the cloud side) with matching root and hash`; `a joined reader follows`; `after removal, sync → FollowerRemoved and read throws`; `a tampered block (test stub returning a wrong stateRoot) → mismatch`.
- [ ] **Step 2:** FAIL. **Step 3:** implement (`ChainNode` uses `nodeOptions` too — no behaviour change; t-129 tests stay green). **Step 4:** PASS + full suite + `make soak-node` still OK.
- [ ] **Step 5:** Commit `feat(node): Follower — sync from the cloud node with state-root checks (t-132)`.

### Task 4: End to end, docs, board

**Files:**
- Modify: `packages/node/scripts/e2e.ts`, `packages/node/README.md`, `docs/board/board.md`, `docs/superpowers/specs/2026-11-23-node-cursors-design.md` (note: route superseded by `/nodes`)

- [ ] **Step 1: e2e additions** (local worker): B deploys a chain; B invites C as reader (1-use, 5 min) and D as writer; C and D join; both follow with `Follower` and reach B's head; B submits 3 blocks; both follow; `nodes` shows B (admin), C (reader), D (writer) with names and blocks; C stops polling, B adds 2 blocks, `nodes` shows C 2 behind; B removes C → C's next sync is removed (403) and `nodes` omits C; a create-chain code used to join → 403; C's reused code → 403. `make e2e-node` → ALL PASS; paste output.
- [ ] **Step 2:** README: the four routes, joining, the cursor rule, `Follower`; the cursor design note. Board: t-140 DoD worker items ticked (panel is part 2); t-133 and t-132 notes "part 1 done (worker + Follower)". Regenerate cards with `node_modules/.bin/agile card …`.
- [ ] **Step 3:** full `bun test`; leave nothing running.
- [ ] **Step 4:** Commit `test(node): two-device e2e (join, follow, cursors, remove); docs and board (t-132, t-133, t-140)`.
