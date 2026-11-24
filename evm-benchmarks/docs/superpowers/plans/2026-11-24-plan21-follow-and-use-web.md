# Follow and use, part 2: writing from evm.fun — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every evm.fun page can write to a deployed chain from any writer device, online or offline; the chain opens offline from browser storage; pending, confirmed, conflicted and refused transactions are shown in one place.

**Architecture:** The follower chain's Approach (`cloud/followerChain.ts`) routes `submit`/`awaitSettled` to `Follower.send` (plan 20) and opens the Follower with an IndexedDB `FollowerStore` over `store/kv.ts`, guarded by a per-chain Web Lock so one tab writes. A Pending panel, an app-bar count and a conflict badge show the queue. Two small `Follower` changes come first so sends never wait on the network.

**Tech Stack:** Bun, React 19, Tailwind 4, viem, webevm 0.9.1, packages/node `Follower`/`FollowerStore`.

**Spec:** `docs/superpowers/specs/2026-11-24-follow-and-use-design.md` (evm.fun section; plan 20 built the worker and `Follower`).

## Global Constraints

- The follower submits as its device key (`follows.account`); pages send as whichever account they act as (chain ACL vs contract ACLs, ADR-0025).
- On a reader device, a send is refused locally with exactly: `This device can only read <chain name>.`
- Pending records live in kv store `followerPending:<chain id>` keyed by `seq`; the confirmed copy in `followerConfirmed` keyed by chain id (the local chain id is the `FollowerStore` key).
- One writing tab per chain: `navigator.locks` lock `evmb-follower:<chain id>`. A tab without it follows read-only from the cloud with no store and shows "Open in another tab: changes are made there."
- When kv isn't persistent (memory fallback), the chain shows: "This browser isn't saving data: pending changes are lost if you close the tab."
- Status copy: offline → "Offline — last synced <relative time>. Changes are kept and sent when you're back."
- Tokens only, three themes, phone width, contrast tests green. No new dependencies.
- Commit with `git commit --only -m … -- <paths>`, messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `design/`, `.env.*`, `.run/`, root `package.json`. Tests per package (`bun test packages/<name>`; web files individually if Bun segfaults, R11) and `bun run web:build` before each commit.

## Review Focus

1. **Send while a sync is stuck on a dead network** → the page gets its local result within a second; the tx is pending.
2. **Two tabs on one chain** → only the lock holder writes to the store; closing it lets the other take over on its next sync without losing pending records.
3. **Reload with pending txs, offline** → the chain opens from storage showing them pending; online again → they settle.
4. **A device removed while a tx's reply was lost** → that tx shows refused with "may have been mined before removal", not a plain refusal.
5. **Conflicted tx** → the app-bar badge turns warning and the Pending panel shows both outcomes; dismissing it clears the badge.

---

### Task 1: `Follower` — sends never wait on the network

**Files:**
- Modify: `packages/node/src/follower.ts`, `packages/node/src/followerStore.ts`
- Test: `packages/node/test/follower-writes.test.ts`, `follower-store.test.ts`

**Interfaces:**
- Produces: `sync()` does its network I/O (submit, page fetches) outside the serial queue and only node/store work inside it, so `send` and `read` never wait on a request; at most one sync runs at a time (a second call joins the running one). Confirmed copies carry `savedAt: number` (ms); `Follower.lastSynced: number | undefined`. On removal, pending txs answered `mined` or whose last submit got no reply are refused with reason `removed from chain — it may have been mined before removal`; others `removed from chain`.

- [ ] **Step 1: Failing tests:** `send resolves while a sync hangs on a never-resolving submit`; `read resolves while a sync hangs on a page fetch`; `two concurrent syncs run once`; `lastSynced set after a sync and restored from the stored copy`; `removal after a lost reply refuses with "may have been mined before removal"`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + node package + `make e2e-node` ALL PASS.
- [ ] **Step 5:** Commit `feat(node): Follower syncs without holding sends; lastSynced; honest removal refusals (t-132)`.

### Task 2: Browser `FollowerStore`, one writing tab, offline open

**Files:**
- Create: `packages/web/src/cloud/followerStore.ts`
- Modify: `packages/web/src/cloud/followerChain.ts`, `packages/web/src/chain/registry.ts`
- Test: `packages/web/test/follower-store-web.test.ts`, `packages/web/test/follower-chain.test.ts`

**Interfaces:**
- Produces: `kvFollowerStore(kv: Kv): FollowerStore` (stores per Global Constraints; values cloned by kv). `followerApproach` options gain `store?: FollowerStore` and `lock?: (name: string, fn: () => Promise<void>) => boolean` (default: `navigator.locks.request(name, { ifAvailable: true }, …)`; returns false when held elsewhere; absent API → always granted). `FollowerStatus` gains `{ kind: 'offline'; lastSynced?: number; detail: string }` (used when a Follower is open but the cloud can't be reached; `unreachable` stays for "never opened"); `statusBadge` maps it to warn. `registry` passes `kvFollowerStore(deps.kv)`.

- [ ] **Step 1: Failing tests:** `kvFollowerStore round-trips confirmed copies and pending records by seq`; `pending records of two chains don't mix`; `a follower with a stored copy opens with the node unreachable and reports offline with lastSynced`; `a tab without the lock opens without a store and refuses sends with the other-tab message`; `memory-only kv shows the not-saving notice text`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + web files + build.
- [ ] **Step 5:** Commit `feat(web): followers keep their copy and pending txs in IndexedDB; one writing tab; offline open (t-132)`.

### Task 3: Writing from every page; Pending panel and app-bar count

**Files:**
- Modify: `packages/web/src/cloud/followerChain.ts`, `packages/web/src/tx/send.ts`, `packages/web/src/chain/registry.ts`, `packages/web/src/components/cloud/DevicesPanel.tsx` (status line), `packages/web/src/components/AppBar.tsx`
- Create: `packages/web/src/components/cloud/PendingPanel.tsx`
- Test: `packages/web/test/follower-chain.test.ts`, `packages/web/test/follower-pending.test.ts`

**Interfaces:**
- Consumes: Task 1–2; `Follower.send/pending/dismiss`, `onPending`, `signer`.
- Produces: the follower Approach's `submit(raws)` calls `Follower.send` per raw (a node-rejected tx throws its error) and `awaitSettled(hashes)` returns those local receipts (as `@evmb/core` `Receipt`); `pending()` = count of `pending` records; `pendingTxs(): PendingTx[]`, `dismiss(hash)`, `onPending` → registry `emit`. Role: `client.nodes()` once on open and after a submit 403; a reader → `submit` throws the reader message (Global Constraints). `signer(from)` returns the browser account's `LocalAccount` (accounts store). `readOnly()` and the guard in `signAndSend` are removed. `PendingPanel({ chain })`: each record — status badge, short hash, sender label, `first` outcome; conflicted shows local vs cloud status and log count, and `dependsOn`; refused shows the reason; **Dismiss** on settled records, **Dismiss settled** for all. App bar: "N pending" (neutral) while any are pending, "N conflicted" (warn) while any conflicted are undismissed; clicking goes to the chain's Pending panel.

- [ ] **Step 1: Failing tests:** `a writer follower's send returns the local receipt at once and counts as pending`; `a reader follower's send throws "This device can only read <name>."`; `settled records update pending() and notify`; `a refused nonce re-sign uses the browser account's key`; `app-bar summary counts pending and undismissed conflicted` (pure helper `pendingSummary(txs)`); `dismiss clears a conflicted record`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + web files + build. Write the browser checklist into the report: two browsers (or two profiles) as phone and tablet on `make dev-services`; offline (devtools) writes on both, back online, both confirm; same key on both spending one balance → one conflicted; reload offline with pending; second tab shows the other-tab message; reader device refused; three themes and phone width.
- [ ] **Step 5:** Commit `feat(web): write to deployed chains from every page; Pending panel and app-bar count (t-132)`.

### Task 4: Docs and board

**Files:**
- Modify: `docs/superpowers/specs/2026-11-23-devices-follow-design.md` ("Read-only until B" → B done), `packages/web` user docs if any mention read-only followers (grep `Read-only until B`), `docs/risks/risks.md` (update R59/R60 with the browser store and the tab lock), `docs/board/board.md` (t-132: B done in code, DoD "checked in a browser" unticked, moved to Doing)

- [ ] **Step 1:** Update the docs; grep the repo for `Read-only until B` and fix every remaining mention. Regenerate board and risk cards with the tools earlier commits used (`agile`, `risk-register`).
- [ ] **Step 2:** Tests per package + build.
- [ ] **Step 3:** Commit `docs: follow and use done in evm.fun; risks and board (t-132)`.
