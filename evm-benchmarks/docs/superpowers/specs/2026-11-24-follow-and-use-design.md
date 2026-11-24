# Follow and use (B): write locally, the cloud orders — design

Board: second half of t-132 ("follow and use"); roadmap t-136, demo steps f–g. Builds on the devices design
(`2026-11-23-devices-follow-design.md`, "A: follow and show"), t-134 (deploy) and t-129 (chain store).

## Intent

A deployed chain is the **synchronisation point between a user's devices** (Aaron, 2026-11-24). Each device writes
straight away — online or offline — on its own copy; its signed transactions go to the cloud node, which puts them in
one order and makes the only real history. Changes that don't touch each other go through without fuss; real clashes
(a double spend) show up as failures on the device that lost. Offline writing is the main reason: a phone on a train
keeps working, and its changes are safe until it reconnects.

## Decided with Aaron

- **The cloud node stays the single source of truth.** Devices never make canonical blocks; their local blocks are a
  preview. Only signed transactions travel.
- **Conflicts are decided by the contracts (approach A).** The cloud re-executes each transaction on its own head, in
  arrival order, and mines whatever happens. A transaction whose contract check fails (spending a balance that is
  already gone) is on record as failed. The device compares the cloud's result with its local one and marks the
  difference "conflicted". Commutative changes combine (two `count++` → 2); silent overwrites are caught only where
  the contract checks a version (the key/value contract, t-139).
- **Local storage behind a clear storage API** whose browser implementation happens to be IndexedDB: the pending
  queue *and* the follower's confirmed copy survive closing the tab, so a chain opens with no signal.
- **The logic lives in `packages/node`'s `Follower`** behind a `FollowerStore` interface (approach 1); evm.fun supplies
  an IndexedDB store over `store/kv.ts`; tests use an in-memory one.
- **Two separate access controls, never conflated** (Aaron, 2026-11-24):
  - **The chain's ACL** says who may *submit* to the chain (and who may read it): the key that signs the request to
    the cloud node. It says nothing about who signed the transactions inside.
  - **A contract's own ACL** says who may *act* on that contract: its own logic over `msg.sender` or signatures. A
    fund's token may accept only its members' signatures while a broker (a chain writer) submits them; a chain may
    allow writes from [a, b, c, d], a subset [a, c], or a separate set [e, f, g] — all intentional.
  - So the cloud checks **only the submitting key** against the chain's write list; transaction senders are left to
    the contracts. (Today's extra "every sender is a writer" check goes.)
  - An `ACL` interface in `packages/node`: `{ write: Address[]; read: Address[]; readOpen: boolean }` plus
    `canWrite(a)` / `canRead(a)`, with a **chain implementation** over `ChainAccess.sol` (admin, `writers()`,
    `readers()`, `readOpen`). The worker's access checks go through it. Contract ACLs (a later `Governance.sol` with an
    allow-list) are separate implementations of the same shape.
- **Shown in one place:** an "N pending" count in the app bar, a Pending list per chain and a notice when something
  conflicts; pages show their result as today.

## How it works

### One write, end to end

1. A page sends a transaction on a deployed chain. The device runs it on its local copy at once (a local block on
   top of the confirmed head) and the page shows the result, marked **pending**. The pending record is stored before
   the page sees the result.
2. Whenever online, the device sends its pending queue to the cloud in batches (`POST /chains/:id/submit`).
3. The cloud checks each transaction on its own, refuses only the invalid ones (with a reason), and mines the rest in
   one block. It answers per transaction.
4. The device pulls the cloud's blocks as today (`GET /blocks`, root and hash checked). It loads its last confirmed
   copy, applies the cloud blocks, saves that as the new confirmed copy, then re-runs whatever is still pending on top.
5. Each pending transaction ends as:
   - **confirmed** — mined, with the same outcome as the local run (status and logs);
   - **conflicted** — mined, but failed or produced different logs from the local run;
   - **refused** — the cloud would not take it (not a writer any more, removed, malformed), with the reason.
6. Other devices see the change the way they follow today.

### Worker (packages/node)

- **Per-transaction submit.** The request's signer must be a chain writer (via the chain `ACL`); then `submit`
  validates each tx independently (decodes, nonce is the sender's next — senders need no chain role) and mines the valid ones as one block; the reply lists `{ hash, result: 'mined' | 'refused', reason?,
  block? }` per tx plus the head. A batch is no longer all-or-nothing.
- **Idempotent resubmits.** A device that lost the reply resends; a tx whose hash is already on the chain is answered
  `mined` with its block, not refused. The cloud keeps a tx-hash → block index beside the chain store.
- **Batch size.** The submit body cap rises from 64 KiB to **512 KiB** (contract deploys are large; t-139 needs it too). Not 1 MiB: a block's row (txs plus receipts) must stay under Durable Object SQLite's 2 MB row limit.
- The cloud mines reverted transactions (status 0) as part of the block — the history shows the attempt.

### Follower (packages/node, UI-free)

- `FollowerStore` interface: the confirmed copy (state dump + head) and the pending records (raw tx, hash, sender,
  nonce, local outcome, status, cloud outcome or reason). An in-memory implementation ships with the package.
- `Follower.open` loads the confirmed copy from the store when there is one (offline open), otherwise from the cloud
  as today; it syncs when online.
- `send(raw)`: runs the tx locally, stores the pending record, returns the local receipt. Serialised with `sync`.
- `sync()`: sends the pending queue in batches, pulls blocks, rebases (load confirmed → apply cloud blocks with checks
  → store confirmed → re-run pending), and settles each pending record from the per-tx replies and mined receipts.
- **Nonces.** If a pending tx is refused only for its nonce (e.g. the same key used on two devices, or an earlier tx
  of that sender refused), the device re-signs it and that sender's later pending txs with the next nonces and
  resends them, so they are judged on their contract outcome (confirmed or conflicted); it never drops them silently.
- **What "confirmed" compares against:** the **first** local outcome — what the page showed — kept on the record and
  never overwritten by later re-runs. A pending tx whose re-run outcome changes after an earlier one conflicted is
  marked as depending on it.
- Reads see the confirmed copy plus pending (what the user just did).

### evm.fun

- Every playground page can write to a deployed chain through the existing send path, as whichever account it acts
  as; the follower submits as its device key (`follows.account`). "Read-only until B" goes away when that key is a
  chain writer; on a reader device sends are refused locally: "This device can only read <chain>."
- A **Pending** list on the chain (Chains page and the follower status line): each tx with its status; conflicted ones
  show the local and cloud outcome; dismiss to clear settled records. "N pending" in the app bar while any wait.
- **Offline:** the chain opens from the stored copy with "offline — last synced <time>"; sends queue; the queue sends
  when back online.
- The IndexedDB store over `kv`; when storage is blocked (memory fallback), a notice that pending changes won't
  survive closing the tab.

### Throughput test (early)

A small measurement against the local worker: batches of 1, 10 and 100 simple txs (separate contracts), txs/s and
latency per batch, written up in `docs/spikes/`. It sets the default batch size and tells us where the ceiling is
(one Durable Object, in order).

## Goals

- Write offline on any member device; nothing the user did is lost; it confirms when online.
- Independent writes from several devices all confirm.
- A real clash shows as conflicted on the device that lost, with what happened.

## Non-goals

Devices making canonical blocks (multi-producer); per-page pending markers; detecting stale reads in the cloud (approach B); merging state
(CRDTs); retrying conflicted transactions automatically; WebSocket push (t-144); the version-checked key/value
contract itself (t-139); history before the stored dump.

## Anti-goals

- A transaction shown as confirmed whose cloud outcome differs.
- A pending transaction lost without being shown as refused or conflicted.
- A device whose view mixes pending and confirmed state without saying which is which.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A: the contract decides (chosen)** | Cloud mines everything; device compares outcomes | No new machinery; honest history; overwrites caught only with version checks |
| B: stale-read detection | Cloud refuses a tx if anything it read changed | Catches every overlap; refuses commutative changes; needs read-set tracking |
| **1: in `Follower` behind `FollowerStore` (chosen)** | UI-free, tested end to end | `Follower` grows; evm.fun adapts |
| 2: in evm.fun only | Fewer parts to start | Conflict logic tested only through browser-shaped code |
| Multi-producer | Devices make blocks | Fork choice, rotating signers; not needed with a single source of truth |

## Constraints

As earlier steps: webevm 0.9.1 / revm-wasm 0.3.1; `packages/node/src` imports no `bun:*`/`node:*`; tokens only,
three themes, phone width; commit with `git commit --only`; never commit `design/`; nothing deploys except
`make deploy` by Aaron; `make e2e-node` extended with a two-device race (independent writes both confirm; the same
balance spent on both, from one key imported on both devices → one confirmed, one conflicted after a nonce re-sign;
a broker device submitting a tx signed by a key with no chain role → mined); docs (t-137).

## Later (own cards)

- **`Governance.sol`:** an allow-list contract whose own changes are governed by a Governance contract (itself or
  another). It can become `ChainAccess`'s admin (any address, contracts included), so the chain's ACL is governed by
  members instead of one key. Its ACL implements the same `ACL` shape.
- **ACL as a view:** `GET /chains/:id/access-controls/latest` (deploy-cf design, t-139 views) serves the chain's ACL as
  JSON for clients. The worker keeps reading `ChainAccess` directly — same block, no lag.
- **Read limits are chain-wide:** anyone on the chain's read list can read all of its state; a contract cannot hide
  its storage from them. Private data needs a separate chain (or encryption).

## Size

**L**, two plans: (1) worker per-tx submit + index + cap, `Follower` pending/rebase/store, throughput test, e2e;
(2) evm.fun send path, Pending list and status, IndexedDB store, offline open.

## Left to the builder

Batch size default (from the throughput test); how often the confirmed copy is saved (at least after each sync that
advanced, and on page hide); exact Pending list layout and copy; how outcomes are compared beyond status and logs.
