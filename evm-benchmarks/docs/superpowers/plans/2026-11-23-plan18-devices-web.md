# Devices, part 2: evm.fun follower chains, Join, Devices panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In evm.fun, a deployed chain is a read-only follower on every device: the owner's copy converts after Deploy, another device joins with a code, and a Devices panel shows each member's name, role and position, with invite and remove for the admin.

**Architecture:** A new chain type `follower` whose handle wraps part 1's `Follower` (packages/node) behind the playground's existing `ChainHandle`/`Approach` seam: reads go to the follower's node, sends are refused ("Read-only until B"). The registry builds, persists (as a pointer only) and removes followers; a poll loop syncs them. UI: Deploy converts, Cloud page Join, Chains page Devices panel. UI-free logic lives in `src/cloud/*` and is tested in Bun against the in-process worker stand-in (packages/node `handle` over `ChainHost`/bunSql), as `cloud-deploy.test.ts` does.

**Tech Stack:** React 19 + Tailwind 4 (evm.fun), Bun tests, `@evmb/node` (`Follower`, `NodeClient`, `claimTx`, `inviteTx`, `accessTx`, `generateCode`), webevm 0.9.1 + revm-wasm 0.3.1.

**Spec:** `docs/superpowers/specs/2026-11-23-devices-follow-design.md` (incl. "Settled after the builder check"); part 1 plan and its final review notes (`docs/superpowers/plans/2026-11-23-plan17-devices-worker.md`).

## Global Constraints

- `ChainType` gains `'follower'`; `ChainInfo.follows?: { nodeUrl: string; chainId: string; account: Address }`. A follower always signs as `follows.account` (never the acting account) and sends that account's label as its device name.
- Sends on a follower throw `Read-only until B: this chain lives on <nodeUrl>`; pages that send show that message through their existing error paths. Snapshots, restore, mine and chain export are unavailable on followers (disabled with that reason).
- Polling is **configurable** (Aaron): a per-browser setting on the Cloud page, "Sync followers every" **5 s** (default) / 15 s / 60 s / **Manual**, stored like other per-browser settings (localStorage, try/catch; not workspace data) and applied to running followers without reopening them. Manual means no timer: the chain card and Devices panel have **Sync now** (always available, in every mode). While a timer runs: paused when the tab is hidden; on error back off ×2 up to **60 s**, then back to the setting after a success; one `open` per session. Streaming (the cloud pushing new blocks) replaces polling later. The Follower re-opens from `/state` every **1000** replayed blocks to bound memory.
- Follower states shown to the user: `following` (block, "in sync" / "N behind" from `cloudHead`); `removed` ("Removed from <name>: your copy is no longer updated", Delete); `mismatch` ("Your copy differs from the cloud at block N", Delete / Re-join); `needs-key` ("Needs <address>'s key", link to Accounts → Import key); `unreachable` (network error: "Can't reach <url>", retrying); `clock` (401: "Check this device's clock"); `gone` (404: "This chain no longer exists").
- Invites default to **1 use, reader**, TTL presets 5 min / 1 h / 1 day; choosing writer with uses > 1 shows "Anyone who can read this chain could see a multi-use writer code once it is used. Prefer single-use." (risk R55).
- Remove = `removeReader` and/or `removeWriter` (whichever roles the member has), plus `setReadOpen(false)` if reads are open and the admin confirms, as consecutive-nonce txs in one `submit`.
- Workspace files: followers saved as `{ id, name, createdAt, follows }` in a new optional `followers` array (no state); Open re-syncs them. Older files without it load unchanged.
- UI: tokens only, three themes, contrast tests, phone width; real data only. Commit with `git commit --only -m … -- <paths>`, messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `design/`, `.env.*`, `.run/`, root `package.json`. Full `bun test` and `bun run web:build` before each commit (risk R11: rerun; may need to run outside the sandbox).

## Review Focus

1. **Deploy, then reload the page:** the converted chain re-syncs as a follower (not a plain chain), same id, same contract and asset records, at the cloud head.
2. **The acting account changes** while a follower is open: the follower keeps signing as `follows.account`; nothing looks like removal.
3. **The follower's key is missing** (workspace opened in another browser, or the account deleted): `needs-key`, no requests sent, no crash on any page.
4. **A device is removed while its Chains page is open:** within one poll it shows `removed`; the Devices panel elsewhere drops it.
5. **A plain chain deployed before this change** whose local head moved past `deployed.head`: shows "local changes since deploy" with Export first; nothing converts without confirmation.

---

### Task 1: Follower chains in the registry

**Files:**
- Modify: `packages/node/src/follower.ts` (`reopenEvery` option, default 1000; `open` accepts it), `packages/web/src/chain/handle.ts`, `packages/web/src/chain/registry.ts`, `packages/web/src/chain/revm.ts` (follower deps)
- Create: `packages/web/src/cloud/followerChain.ts`
- Test: `packages/web/test/follower-chain.test.ts`, `packages/node/test/follower.test.ts` (reopen)

**Interfaces:**
- Produces:
  - `followerApproach(o: { follows; account: LocalAccount | undefined; label?: string; wasm; onStatus(s: FollowerStatus): void; onHead(h: BlockSummary): void }): Approach & { status(): FollowerStatus; syncNow(): Promise<void> }` — `request` via `Follower.read`; `submit`/`mine`/`snapshot`/`restore` throw the read-only reason; owns the poll loop (Global Constraints) started on first use and stopped on `dispose`.
  - `syncInterval` setting: `getSyncInterval(): 5 | 15 | 60 | 'manual'`, `setSyncInterval(v)`, `onSyncIntervalChange(cb)` in `src/cloud/node.ts` (beside the node URL setting); running followers re-arm their timer on change; `'manual'` stops the timer.
  - `type FollowerStatus = { kind: 'following'; block: number; behind: number } | { kind: 'removed' | 'mismatch' | 'needs-key' | 'unreachable' | 'clock' | 'gone'; detail: string }`.
  - Registry: `addFollower(o: { name: string; follows: ChainInfo['follows']; id?: string; createdAt?: string }): Promise<ChainHandle>`; `build` uses `followerApproach` for `type === 'follower'` (looks up `follows.account` in the accounts store); `convertToFollower(id: string, follows): Promise<ChainHandle>` (keeps id, name, contract and asset records; disposes the engine; purges its IndexedDB state); `remove` works for followers; followers count toward the live cap.

- [ ] **Step 1: Failing tests** (in-process worker; admin deploys a chain; device keys from `privateKeyToAccount`): `addFollower opens at the cloud head and eth_blockNumber/eth_getBalance answer`; `send on a follower throws the read-only reason`; `the poll picks up blocks the admin submits (fake timers or syncNow)`; `removal → status removed`; `missing account → needs-key, no request sent`; `network error → unreachable, then following again`; `the sync interval setting re-arms a running follower; manual stops the timer and syncNow still works`; `a 401 → clock; a 404 → gone`; `convertToFollower keeps id and records, drops local state`; node: `reopenEvery re-opens from /state and keeps matching`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; full suite; web build.
- [ ] **Step 5:** Commit `feat(web): follower chains — read-only handle over Follower, polling, statuses (t-132)`.

### Task 2: Deploy converts the owner's copy; earlier deploys convert on open

**Files:**
- Modify: `packages/web/src/cloud/deploy.ts`, `packages/web/src/components/cloud/DeployDialog.tsx`, `packages/web/src/pages/ChainsPage.tsx`
- Test: `packages/web/test/cloud-deploy.test.ts`

**Interfaces:**
- Consumes: `convertToFollower` (Task 1).
- Produces: `deployChain` ends with `convertToFollower(id, { nodeUrl, chainId: r.chainId, account: account.address })` after the head-hash check (replacing `setDeployed`); the dialog's result says "Your copy now follows the cloud chain. Older transaction history isn't kept in this browser." `convertDeployed(id): Promise<'converted' | 'diverged'>` for plain chains with `deployed`: converts when the local head equals `deployed.head`, else returns `'diverged'`; ChainsPage shows the diverged notice with **Export chain** and **Convert anyway** (confirm).

- [ ] **Step 1: Failing tests:** `after deploy the chain is a follower at the cloud head with the same id and records`; `a refused deploy still changes nothing`; `convertDeployed converts at the deployed head; returns diverged after a local block, and converts only when asked`.
- [ ] **Step 2–4:** FAIL → implement → PASS; full suite; web build.
- [ ] **Step 5:** Commit `feat(web): deploy converts the owner's copy to a follower; earlier deploys convert on open (t-132)`.

### Task 3: Join a chain; workspace pointers

**Files:**
- Create: `packages/web/src/cloud/join.ts`, `packages/web/src/components/cloud/JoinForm.tsx`
- Modify: `packages/web/src/pages/Cloud.tsx` (Join section; route `/cloud/join` prefill; the "Sync followers every" setting), `packages/web/src/workspace/{types,validate,build,load}.ts`
- Test: `packages/web/test/cloud-join.test.ts`, `packages/web/test/workspace.test.ts`

**Interfaces:**
- Produces: `joinChain(o: { client: NodeClient; chainId: string; code: string; account: LocalAccount; name: string; registry }): Promise<ChainHandle>` — `client.joinInfo(chainId)` → `claimTx(account, nonce, code, access)` → `client.join` → `registry.addFollower(...)`; refusals throw with the worker's message and add nothing. Join form: worker URL (prefilled), chain id, code, chain name (default "Joined <short id>"); `#/cloud/join?node=…&chain=…` prefills URL and chain id (never a code). Workspace: `followers?: { id; name; createdAt; follows }[]` validated (http(s) URL that parses, chain id shape, address) and round-tripped.

- [ ] **Step 1: Failing tests:** `a second key joins with a reader code and follows`; `a bad/expired/create-chain code → the worker's message, nothing added`; `the join link prefills URL and chain id only`; workspace: `followers round-trip; malformed follower entries refuse the file; files without followers load`.
- [ ] **Step 2–4:** FAIL → implement → PASS; full suite; web build.
- [ ] **Step 5:** Commit `feat(web): Join a chain with a code; followers saved as pointers in workspace files (t-133)`.

### Task 4: Devices panel, follower status in the UI

**Files:**
- Create: `packages/web/src/cloud/devices.ts`, `packages/web/src/components/cloud/DevicesPanel.tsx`
- Modify: `packages/web/src/pages/ChainsPage.tsx`, `packages/web/src/components/ChainPicker.tsx` (follower badge + status)
- Test: `packages/web/test/cloud-devices.test.ts`

**Interfaces:**
- Produces: `inviteDevice(o: { client; chainId; admin: LocalAccount; code: string; ttlS: number; uses: number; role: 'reader' | 'writer' }): Promise<void>`; `removeDevice(o: { client; chainId; admin: LocalAccount; member: Member; closeReads: boolean }): Promise<void>` (one submit, consecutive nonces from the admin's nonce); `multiUseWriterWarning(role, uses): string | undefined`.
  - **Devices panel** (Chains page, follower chains): cloud head; rows — name, short address (copy), role, block, "in sync / N behind", last seen; this device marked "(this device)". Admin only: **Invite a device** (code prefilled by `generateCode()`, Generate, TTL presets, uses 1, role reader/writer, the warning) → shows the code once with "Send this code to the other device" and a join link without the code; **Remove** per member except the admin (confirm; offers "Close reads" when `readOpen`).
  - The follower's status (Global Constraints) is shown on the chain card and in the chain picker; `removed`/`mismatch` offer Delete.

- [ ] **Step 1: Failing tests:** `invite then a second key joins with that code`; `removeDevice removes a reader, a writer, and one with both roles in one submit; the member then gets 403`; `closeReads sends setReadOpen(false) too`; `multi-use writer warning`.
- [ ] **Step 2–4:** FAIL → implement → PASS; contrast and no-raw-colours tests pass; full suite; web build.
- [ ] **Step 5:** Manual check against `make dev-services` driven through the modules (as plan 16 Task 5 did): deploy → follower; invite → second key joins → both in the panel; remove → removed status. Write a short browser checklist for Aaron in the report. Leave nothing running.
- [ ] **Step 6:** Commit `feat(web): Devices panel — members, positions, invite and remove; follower status in the UI (t-138, t-140)`.

### Task 5: Docs and board

**Files:**
- Modify: `packages/node/README.md` (evm.fun side: deploy → follower, join, devices), `docs/board/board.md` (t-132 A done, B remaining; t-133, t-138, t-140 ticks), `docs/adr/decisions.md` (ADR: every device is a follower until B; pointers in workspace files), risks (R55–R57 controls now in place where applicable).

- [ ] **Step 1:** Write the docs, ADR and board updates; regenerate cards (`node_modules/.bin/agile card …`, `node_modules/.bin/adr card|badge …`, `node_modules/.bin/risk-register card|badge …`).
- [ ] **Step 2:** full `bun test`, `bun run web:build`, `make e2e-node` still ALL PASS.
- [ ] **Step 3:** Commit `docs: devices on a deployed chain — evm.fun side; ADR, risks, board (t-132, t-133, t-138, t-140)`.
