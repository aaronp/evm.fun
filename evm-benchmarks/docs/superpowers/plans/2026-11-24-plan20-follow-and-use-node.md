# Follow and use, part 1: chain ACL, per-tx submit, Follower writes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A device writes on its local copy of a cloud chain (online or offline), its signed txs reach the cloud node which mines them per tx, and the `Follower` settles each as confirmed, conflicted or refused — proven end to end with two devices racing.

**Architecture:** A chain `ACL` (over `ChainAccess`) checks only the submitting key; `ChainNode.apply` accepts or refuses each tx; the cloud answers per tx and indexes tx hashes for idempotent resubmits. `Follower` gains `send`, a pending queue, rebase-on-sync and settlement, persisting through a `FollowerStore` interface (in-memory here; IndexedDB in part 2).

**Tech Stack:** Bun, TypeScript, webevm 0.9.1 + revm-wasm 0.3.1, viem, Cloudflare Workers/DO via wrangler 4.81.0 (local only).

**Spec:** `docs/superpowers/specs/2026-11-24-follow-and-use-design.md` (builds on `2026-11-23-devices-follow-design.md`).

## Global Constraints

- webevm **0.9.1**, revm-wasm **0.3.1**. `packages/node/src/*` must not import `bun:*` or `node:*`.
- **Two access controls, never conflated:** the chain `ACL` checks only the key that signs the request; tx senders need no chain role (contracts decide). Remove the "every sender is a writer" check.
- `POST /chains/:id/submit` body cap **1 MiB** (`MAX_SUBMIT_BYTES = 1024 * 1024`, exported from `client.ts`); other routes keep 64 KiB; create keeps 8 MiB.
- Submit reply: `{ head: BlockSummary; results: TxResult[] }`, `TxResult = { hash: Hex; result: 'mined'; block: number } | { hash: Hex; result: 'refused'; code: 'nonce' | 'invalid'; reason: string }`, in request order. Signer not a writer → 403 for the whole request (unchanged). No accepted txs → no block.
- A tx whose hash is already on chain → `mined` with its block (idempotent resend).
- Reverted txs are mined (receipt status 0).
- Pending outcome compare: **status** and **logs** (address, topics, data, in order) against the **first** local outcome, which is never overwritten.
- Use `ChainNode` only via its public methods; all `ChainService` writes go through `#writes`.
- Commit with `git commit --only -m … -- <paths>`, messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `design/`, `.env.*`, `.run/`, root `package.json`. Never run `wrangler login`/`deploy`. Full `bun test` before each commit (R11: rerun; may need to run outside the sandbox).

## Review Focus

1. **A device loses the submit reply and resends** → every tx answers `mined` with the same block; nothing mined twice.
2. **A batch where tx 2 of 3 has a nonce gap** → tx 1 mined, tx 2 refused (`nonce`), tx 3 refused (`nonce`), and the Follower re-signs 2 and 3 so both end confirmed or conflicted.
3. **Sync while pending txs exist and the cloud has moved on** → local state = cloud head + pending re-run; the stored confirmed copy never contains pending effects.
4. **The cloud rebuilds (every 1000) or the Follower reopens (every `reopenEvery`) with pending txs** → pending survive and settle.
5. **Submit 403 because this device is a reader** → its pending txs are refused (`not a writer`), the Follower keeps following (not "removed").

---

### Task 1: Throughput baseline

**Files:**
- Create: `packages/node/scripts/throughput.ts`, `docs/spikes/cf-throughput.md`
- Modify: `Makefile` (target `throughput-node`)

- [ ] **Step 1:** `throughput.ts` runs in-process (`handle` over `ChainHost`/bunSql, as `test/router-devices.test.ts` builds it) by default, or against `--url <worker>` (signed requests as `NodeClient`). It creates a chain, gives 10 sender keys each their own `MintableToken`, then submits batches of **1, 10 and 100** token transfers (one tx per sender per round, separate contracts), 20 rounds each; prints txs/s and p50/p95 latency per batch size.
- [ ] **Step 2:** Run in-process and (with `make dev-services` up) against the local worker; stop anything started. Write `docs/spikes/cf-throughput.md`: numbers, machine, the recommended Follower batch size (`DEFAULT_BATCH`), and where the time goes.
- [ ] **Step 3:** Commit `spike(node): submit throughput baseline, batches of 1/10/100 (t-132)`.

### Task 2: Chain `ACL`; only the submitter is checked

**Files:**
- Create: `packages/node/src/acl.ts`
- Modify: `packages/node/src/service.ts`, `packages/node/src/index.ts`
- Test: `packages/node/test/acl.test.ts`, `packages/node/test/service.test.ts`

**Interfaces:**
- Produces: `interface ACL { list(): Promise<{ write: Address[]; read: Address[]; readOpen: boolean }>; canWrite(a: Address): Promise<boolean>; canRead(a: Address): Promise<boolean> }`; `chainAcl(call: (fn: string, args?: unknown[]) => Promise<unknown>): ACL` over `ChainAccess` — `write` = admin ∪ writers, `read` = write ∪ readers (members; excludes "anyone" from `readOpen`), deduped, checksummed. `ChainService.acl: ACL`; `canRead`/`canWrite`/`isMember`/`nodes` use it.

- [ ] **Step 1: Failing tests:** `chainAcl lists admin and writers in write, plus readers in read`; `readOpen reported, read list unchanged`; `submit by a writer of a tx signed by a key with no chain role is mined`; `submit signed by a non-writer → 403` (still).
- [ ] **Step 2:** FAIL. **Step 3:** implement; drop the per-sender writer check in `#submit`. **Step 4:** PASS + full suite.
- [ ] **Step 5:** Commit `feat(node): chain ACL interface over ChainAccess; submit checks only the submitter (t-132)`.

### Task 3: Per-tx submit, tx index, 1 MiB cap

**Files:**
- Modify: `packages/node/src/node.ts`, `packages/node/src/store.ts`, `packages/node/src/service.ts`, `packages/node/src/router.ts`, `packages/node/src/client.ts`
- Test: `packages/node/test/node.test.ts`, `store.test.ts`, `service.test.ts`, `router-devices.test.ts`

**Interfaces:**
- Produces: `ChainNode.apply(timestamp, txs): Promise<{ block?: StoredBlock; results: ({ ok: true; hash: Hex } | { ok: false; hash: Hex; error: string })[] }>` — each tx sent on its own; a node-rejected tx is reported, the rest mined; no accepted txs → no block, nothing committed (existing callers adapt; redeem/join keep their own "must be mined" checks). `ChainStore.blockOf(hash: Hex): number | undefined` (a `txs(hash PRIMARY KEY, block)` table filled on commit and on create from the dump). `ChainService.submit(signer, txs, ts): Promise<SubmitResult>`; `TxResult`, `SubmitResult`, `MAX_SUBMIT_BYTES` in `client.ts`; `NodeClient.submit` returns `SubmitResult`.
- Nonce classing: before sending, a tx whose hash is indexed → `mined` (its block); otherwise a node rejection mentioning the nonce → `code: 'nonce'`, any other → `code: 'invalid'`.

- [ ] **Step 1: Failing tests:** `apply mines valid txs and reports a bad-nonce tx without failing the block`; `apply with only bad txs mines nothing`; `blockOf finds txs from create and from later blocks`; `submit [ok, gap, ok-after-gap] → mined, refused nonce, refused nonce`; `resending a mined batch answers mined with the same block and adds no block`; `a reverting tx is mined with status 0`; `router accepts a 900 KiB submit, 413 above 1 MiB, 413 above 64 KiB on other routes`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + full suite + `make soak-node` OK.
- [ ] **Step 5:** Commit `feat(node): per-tx submit results, idempotent resends via a tx index, 1 MiB submit cap (t-132)`.

### Task 4: `FollowerStore` and offline open

**Files:**
- Create: `packages/node/src/followerStore.ts`
- Modify: `packages/node/src/follower.ts`, `packages/node/src/index.ts`
- Test: `packages/node/test/follower-store.test.ts`

**Interfaces:**
- Produces: `type Outcome = { status: 'success' | 'reverted'; logs: { address: Address; topics: Hex[]; data: Hex }[] }`; `type PendingTx = { hash: Hex; raw: Hex; from: Address; nonce: number; seq: number; first: Outcome; status: 'pending' | 'confirmed' | 'conflicted' | 'refused'; block?: number; cloud?: Outcome; reason?: string; dependsOn?: Hex }`; `interface FollowerStore { loadConfirmed(key: string): Promise<{ head: BlockSummary; dump: SerializedState } | undefined>; saveConfirmed(key: string, c: { head: BlockSummary; dump: SerializedState }): Promise<void>; listPending(key: string): Promise<PendingTx[]>; putPending(key: string, tx: PendingTx): Promise<void>; deletePending(key: string, hash: Hex): Promise<void> }`; `class MemoryFollowerStore implements FollowerStore`. `Follower.open(client, chainId, wasm, o?: { reopenEvery?: number; store?: FollowerStore; key?: string })` (`key` defaults to `chainId`): with a stored copy it boots from it **without network** (root checked against its head); otherwise from `GET /state` and saves it. Every `sync` that advanced saves the confirmed copy (no pending effects).

- [ ] **Step 1: Failing tests:** `open with a stored copy makes no request` (client whose fetch throws); `open without one boots from the cloud and stores it`; `sync stores the new confirmed head`; `a stored copy with a wrong root → FollowerMismatch`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + full suite (t-132 Follower tests unchanged).
- [ ] **Step 5:** Commit `feat(node): FollowerStore — confirmed copy and pending records; offline open (t-132)`.

### Task 5: `Follower.send`, rebase and settlement

**Files:**
- Modify: `packages/node/src/follower.ts`
- Test: `packages/node/test/follower-writes.test.ts` (in-process worker, two Followers)

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces: `Follower.open` options gain `signer?: (from: Address) => LocalAccount | undefined` (for nonce re-signs), `batch?: number` (default `DEFAULT_BATCH` from Task 1), `onPending?: (txs: PendingTx[]) => void`. Methods: `send(raw: Hex): Promise<Receipt>` (runs it locally in a local block at `max(now, latest local block's timestamp + 1)`, stores the record as `pending` with `first`, then returns; a node-rejected tx throws and stores nothing); `pending(): PendingTx[]`; `dismiss(hash: Hex): Promise<void>` (settled records only). `sync()` now: (1) submits `pending` txs not yet mined, in `seq` order, batches of `batch` within `MAX_SUBMIT_BYTES`; (2) pulls and replays cloud blocks onto the **confirmed** state (reload the stored confirmed dump when local blocks exist) and saves it; (3) settles each mined tx from the block's receipt: same as `first` → `confirmed`, else `conflicted` (with `cloud`); (4) re-runs still-pending txs on top; a re-run whose outcome differs from `first` after an earlier tx conflicted gets `dependsOn` = that tx. Refusals: `nonce` → re-sign that tx and the sender's later pending ones with the next nonces (via `signer`; without a key → `refused`), keep `first` and `seq`, update `hash`/`raw`/`nonce`; `invalid` → `refused` with reason; submit 403 → those txs `refused` ("<signer> is not a writer on this chain"), status stays `following`. Removal (403 on blocks) → all pending `refused` ("removed from chain").

- [ ] **Step 1: Failing tests:** `send shows the local result at once and stores it pending`; `independent writes from two devices both confirm and each device sees the other's`; `same key on both devices spending one balance → first confirmed, second re-signed then conflicted with cloud status reverted`; `a broker device submits a tx signed by a key with no chain role → confirmed`; `a pending tx survives reopen (reopenEvery 5) and settles`; `confirmed copy in the store never includes pending effects`; `resend after a lost reply (stub drops the first reply) → confirmed once`; `reader device: send works locally, sync refuses it (not a writer), follower still following`; `a tx depending on a conflicted one is marked dependsOn`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + full suite.
- [ ] **Step 5:** Commit `feat(node): Follower writes — send locally, submit, rebase, settle; nonce re-signs (t-132)`.

### Task 6: End to end, docs, board

**Files:**
- Modify: `packages/node/scripts/e2e.ts`, `packages/node/README.md`, `docs/adr/decisions.md` (ADR: the cloud orders; chain ACL vs contract ACLs), `docs/risks/risks.md`, `docs/board/board.md`

- [ ] **Step 1: e2e additions** (local worker, `MemoryFollowerStore`): two writer devices; phone and tablet each send offline (no sync) to separate tokens, then sync → both confirmed, each sees the other's; one key imported on both spends one balance → one confirmed, one conflicted; a broker device submits a member-signed tx → confirmed; phone reopens from its store with the worker stopped → opens at its stored head with pending intact; restart → it settles. `make e2e-node` → ALL PASS; paste output.
- [ ] **Step 2:** README: per-tx submit, idempotent resends, the 1 MiB cap, chain ACL vs contract ACLs, `Follower` writes and `FollowerStore`. ADR (next number in `decisions.md`). Risks: "pending txs live only on the device until synced" and "a contract without version checks lets the later write win silently". Board: t-132 note "B part 1 done (worker + Follower writes)"; new Backlog card "Governance.sol: a self-governed allow-list as ChainAccess admin" (parent t-112). Regenerate cards with `node_modules/.bin/agile card …`.
- [ ] **Step 3:** full `bun test`; leave nothing running.
- [ ] **Step 4:** Commit `test(node): two-device write race e2e; docs, ADR, risks, board (t-132)`.
