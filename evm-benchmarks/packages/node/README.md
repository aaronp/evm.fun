# @evmb/node: how a node stores its chain

A chain node persists only what each block changed, and boots from current state, so per-block work and memory stay flat as the chain grows. Design: [chain store](../../docs/superpowers/specs/2026-11-23-chain-store-design.md). Why: [the cost spike](../../docs/spikes/cf-cost.md) (a full dump rewritten per block cost 170 ms and 39.5 MB per 1-tx block at 10,000 blocks).

## Tables

`ChainStore` (`src/store.ts`) sits on a tiny `Sql` interface (`exec`, `tx`) that Durable Object SQLite and `bun:sqlite` can each be adapted to in a few lines (`test/bunSql.ts`; on a DO, `exec` wraps `ctx.storage.sql.exec(...).toArray()` and `tx` wraps `ctx.storage.transactionSync`).

| Table | Key | Holds |
|---|---|---|
| `meta` | `k` | `chainId` |
| `accounts` | `addr` | account (balance, nonce) as webevm serialises it |
| `code` | `addr` | contract code |
| `storage` | `addr, slot` | one row per non-zero slot |
| `blocks` | `number` | hash, full header, raw txs, receipts (JSON) |

## What a commit writes

`ChainNode.apply(timestamp, txs)` runs the block, then diffs the state dump before and after (`diffState`) and calls `store.commit(block, diff)`: in one transaction, an upsert or delete per changed account, code and slot row, plus one block row. A slot set to zero, or an account missing from the dump, is deleted, so a fresh boot cannot carry a stale value. The block's txs and receipts come from the mined header, and the mined txs must be exactly the txs passed, in order. If a tx is rejected, the block holds any other tx, or the commit throws, nothing is written and the node is rebuilt from the store.

## Access

All access to the node goes through `apply(timestamp, txs)` and `read(node => ...)`, which run one at a time in call order (a Durable Object interleaves requests at every await, so two unqueued applies would mine each other's txs). The inner webevm node is replaced on every rebuild: never keep it outside a `read`.

## Boot and rebuild

`stateDump()` builds a state-only webevm dump (all state rows, the last 256 headers, empty receipts and transactions) and `loadState` takes it: that is `ChainNode.boot`. The node rebuilds itself the same way after a rejected block and every `rebuildEvery` blocks (default 1,000), because webevm keeps all history in memory and has no pruning. The every-N rebuild runs at the start of the next `apply`, before any tx is sent, so a failing rebuild never reports a committed block as failed.

## What is not kept

The in-memory node keeps no old receipts or txs, and only the last 256 headers plus up to `rebuildEvery` blocks since the last rebuild. History stays in `blocks` (read with `store.blocks(from, to)`). Nothing is pruned from the store.

## Soak

`make soak-node` runs 10,000 mixed blocks (ETH, ERC-20, whole-balance transfers that zero a slot) on file-backed `bun:sqlite`, `rebuildEvery: 1000`. At 2,500, 5,000 and 10,000 it boots a node from a copy of the store and checks the same root and the same next block hash as the live node. It fails on a mismatch, memory (JS heap plus `external`; a Durable Object's 128 MB also covers wasm memory) of 128 MB or more, or a last-1,000-block commit time over 2x that of blocks 1,000-2,000.

"Rows and bytes written" are measured by wrapping `store.commit`: rows = diff keys + 1 block row; bytes = JSON length of the diff plus the block; `commitMsAvg` is the SQL commit only; the diff compute (the O(state) part) is not in it. Memory is read after a GC, a short yield and a second GC (finalizers of disposed wasm nodes run after a tick; without the yield the reading was inflated to about 130 MB).

Result (Bun on an M-series Mac, 2026-11-23): commit 0.53-0.72 ms per block, 8 rows and about 9.9 KB per block, memory (`memMB`) 70-85 MB (JS heap 46-55 MB), all flat from 1,000 to 10,000 blocks; boots matched at all three heights. Memory is sampled at each 1,000th block, just before the due rebuild, so the node then holds its most history (an earlier run that rebuilt right after the commit read 44-58 MB).

`external` only partly reflects wasm linear memory (one revm node: external +2.4 MB, rss +15.6 MB), so `memMB` is a lower bound; the real Durable Object figure is measured under workerd in t-134.

Limit: `diffState` compares whole-state dumps, so it is O(state) per block. Fine for the soak's small state; switch to a touched-keys diff when state grows past a few MB (risk R51).


# The cloud worker (t-134)

`src/worker.ts` is a Cloudflare Worker with one Durable Object per chain (`ChainDO`, SQLite-backed, `ChainStore` + `ChainNode` as above). The root chain has the id `root`; every other chain has a `crypto.randomUUID()` id. Design: [deploy to CF](../../docs/superpowers/specs/2026-11-23-deploy-to-cf-design.md). Why codes live on the root chain: ADR-0023.

## Routes

Every request except `/health` is signed (`cf-chain v1` EIP-191 message over method, target, body hash, timestamp and nonce; headers `x-ts`, `x-nonce`, `x-sig`; 300 s skew, one use per nonce). `NodeClient` (`src/client.ts`) does the signing.

| Route | Who | What |
|---|---|---|
| `GET /health` | anyone | `{ ok, root }`: the root chain's head, admin and `ChainAccess` address, or `null` |
| `POST /chains` | root admin, or anyone with a deploy code | no claim: create `root` (only `ROOT_ADMIN`, once). With a `claim` tx (a code): redeem it on the root chain, then create a new chain with the signer as admin. Body: `{ dump, setup, claim? }`; `setup` is two contract creations by the signer, mined as block head+1 by the cloud node, which returns its dump |
| `GET /chains/<id>` | readers | chain id, head, admin, `access`, `aliases` |
| `POST /chains/<id>/submit` | writers | `{ txs }`: one block of the txs the node accepts, in order; answers per tx (see below) |
| `GET /chains/<id>/nonce` | anyone signed | `{ nonce, access }`: the signer's nonce and the chain's `ChainAccess` address (not secret: a joining device needs it for its claim) |
| `GET /chains/root/codes` | root admin | issued codes (hash, expiry, uses left, who redeemed) |

CORS allows `https://mychain.dev`, `https://aaronp.github.io` and `http://localhost:*`. Failed redeems and joins: 10 per IP per chain per 10 minutes, then `429`. Bodies are capped before auth: `POST /chains` at 8 MiB (`MAX_CREATE_BYTES` in `src/client.ts`; evm.fun refuses a larger chain before using a code), `POST /chains/:id/submit` at 512 KiB (`MAX_SUBMIT_BYTES`), every other route at 64 KiB; over the cap is `413`. A root invite is a deploy code only if it grants `GRANT_CREATE_CHAIN`; a reader/writer invite is refused (`403 not a deploy code`). If the chain creation fails after the redeem, the code stays used and `codes` lists that use as `failed: <error>`.

## Local services

`make dev-services` starts the worker with `wrangler dev` on `http://127.0.0.1:8799` (state in `.run/node-state`, pid and log in `.run/`), generates `.env.local` with a `ROOT_ADMIN_KEY` if missing and creates the root chain. `make dev-services-status` and `make dev-services-stop` report and stop it. `make e2e-node` runs `scripts/e2e.ts` against it (issue a code, deploy, and every refusal); it starts the worker if needed and stops it only if it started it. Only the root admin's address reaches the worker (`--var ROOT_ADMIN:<address>`).

## Deploying (live)

Run by hand, never from CI. One-time: add `mychain.dev` as a zone on your Cloudflare account, `bunx wrangler login` (in `packages/node`), and put `ROOT_ADMIN_KEY=0x…` in `.env.live` (git-ignored; deploy refuses to generate one). Then `make deploy`: it runs `wrangler deploy --env live --var ROOT_ADMIN:<address>` (custom domain `cloud.mychain.dev`, `workers.dev` if wrangler printed only that), creates the root chain if there is none, and prints the URL, the root chain id and "set GitHub repo variable NODE_URL to <url>". That variable makes the Pages build point evm.fun at the worker (`VITE_NODE_URL`); setting it does not rebuild the site, so re-run the Pages workflow afterwards. A build with `NODE_URL` unset points evm.fun at `http://localhost:8799`. Import the root key into evm.fun (Accounts → Import key) to issue codes.

Check the bundle without a login: `wrangler deploy --dry-run --env live` in `packages/node`.

## Issuing and redeeming codes

As the root admin, open evm.fun → Cloud: pick a code (one is generated: 4 words), a TTL (5 min, 1 h, 1 day) and uses (default 1), and Issue; only `keccak256(code)` and the expiry go on the root chain when it is issued. Redeeming puts the plaintext code on the root chain: the claim tx carries it into a root block (root reads are closed: only the root admin, and any reader it adds, can read root). Send the code out of band. The friend opens Chains → Deploy… on one of their chains and enters it: evm.fun uploads the chain's state with two set-up txs, the worker checks the code, creates the chain with the friend as admin, and evm.fun replaces its local copy with the cloud node's (same head hash) and marks it deployed. Refused: wrong, expired or used-up codes, a root create by anyone but `ROOT_ADMIN`, and a deploy whose set-up is not two creations by the signer. A deployed chain cannot be deployed again.

`deployChain` (`packages/web/src/cloud/deploy.ts`) takes a required `registry` option (`replaceState`, `setDeployed`); its errors carry `step` and `chainId`.


# Devices on a deployed chain (plan 17, part 1)

A device is a key that is a member of a chain's `ChainAccess` (reader or writer). Design: [devices follow](../../docs/superpowers/specs/2026-11-23-devices-follow-design.md).

| Route | Who | What |
|---|---|---|
| `GET /chains/<id>/state` | members | `{ head, dump }`: the chain's current state, to boot a copy |
| `GET /chains/<id>/blocks?after=N` | members | `{ head, blocks }`: up to 100 blocks after N (header, raw txs and receipts) |
| `GET /chains/<id>/nodes` | members | `{ head, admin, readOpen, members }`: each member's role, name, block, behind and last seen. Replaces `/nodes/latest` of the cursor design |
| `POST /chains/<id>/join` | anyone signed | `{ claim }`: a `claim` tx for a reader or writer code the admin issued with `inviteTx(…, grants)`. Redeems it and returns `{ head, role }`. A create-chain code is refused (`403`); failed joins count toward the 10-per-IP-per-chain `429` |

**Joining.** The admin issues a code (`inviteTx` with `GRANT_READER` or `GRANT_WRITER`), sends it out of band; the device gets `{ nonce, access }` from `NodeClient.joinInfo` (it can't read the chain yet), signs `claimTx` and calls `join`. The admin can cancel an unused code with `accessTx(…, 'revokeInvite', codeHash(code))`.

**The cursor rule.** Every `blocks` fetch by a member (admin, writer or reader; not a key that reads only because `readOpen` is on) records, for the signing key, the last block it was delivered (not the head: a page is capped at 100). The stored block never goes down, and a write happens only when the block advances or the stored one is a minute old. `behind` is head minus that block. A key removed from the access list gets `403` on all of these and disappears from `nodes`. A device name goes in `x-node-name` (`NodeClient` option `name`), percent-encoded so any characters survive; the worker decodes it, drops control, bidi override/isolate and zero-width characters and keeps 32 code points.

**`Follower`** (`src/follower.ts`): `Follower.open(client, chainId, wasm)` boots a local webevm node from `state` and checks the state root; `sync()` replays `blocks` pages, checking each block's parent, hash and state root; `read(fn)` reads the local node; `status` is `following`, `removed` (a `403`: `FollowerRemoved`) or `mismatch` (a bad block, or an empty page whose head is behind ours or has another hash at our number); `cloudHead` is the cloud's head as last seen. After either stop, `sync` and `read` throw the same error again; `dispose()` frees the node.

`make e2e-node` covers it with two devices: join, follow across blocks, cursors, being 2 blocks behind, removal, and the refused codes.

# evm.fun side: deploy, follow, join, devices (plan 18)

Design: [devices follow](../../docs/superpowers/specs/2026-11-23-devices-follow-design.md); decision: ADR-0024.

- **Deploy makes a follower.** After Deploy, the owner's browser copy is a follower of the cloud chain: pages send through the cloud node and see their result at once, online or offline (a Pending panel and an app-bar count show unsent and conflicted txs). A chain deployed earlier converts when opened: quietly if the cloud block at the deployed head has the same hash, otherwise you choose Export or Convert anyway.
- **Join a chain** (Cloud page): the admin invites a device from the chain's Devices panel (reader with 1 use by default; a writer code with more than one use shows a warning, risk R55). The code is shown once; the join link has no code in it. On the other device pick an account, open the link and paste the code; the chain appears under "Chains you follow".
- **Followers are pointers.** Workspace files hold a follower as a pointer (node URL, chain id, following account) plus its contract and asset records, not the chain. Opening one makes no request; its state is fetched from the cloud's `state` when needed and root-checked.
- **Sync.** Polling is 5 (default), 15, 60 s or Manual (Sync now); it pauses while the tab is hidden and backs off after failures (risk R57). Statuses: following, removed (the admin removed this key), mismatch, needs the account's key, offline (the network failed or timed out once the copy was open: "Offline — last synced …"; with a stored copy, sends still work and wait), unreachable (retrying), check clock (the worker refused the request's timestamp), gone (the cloud chain no longer exists: the worker's 404 "no such chain" stops the follower; any other 404 is retried, refuses its pending txs, "chain deleted in the cloud", and refuses sends).
- **Devices panel** (admin and members): each device's name, role, block, behind and last seen; the admin invites a reader or writer and removes a device in one submit.

## Browser checklist (`make dev-services`, `make dev`)

1. **Deploy.** Deploy a chain from Chains with a root-admin code. The card shows "Block #N · in sync", Sync now, and a Devices panel listing you as admin "(this device)".
2. **Invite.** Devices → Invite a device: writer with Uses 2 shows the multi-use warning. Set it back to reader, 1 use, Invite. The code is shown once with Copy code and a join link without the code.
3. **Join.** In a second browser profile select a different account, open the join link and paste the code. The chain is under Cloud → "Chains you follow" and opens as a follower (it can write if invited as a writer); in the first browser the phone row appears within one sync.
4. **Sync interval.** Set Manual on Cloud: positions update only on Sync now.
5. **Remove.** Remove the phone row and confirm. In the second browser, within one sync, the card shows "Removed from <name>: your copy is no longer updated" with Delete, and the picker badge says "removed".
6. **Acting account.** Change the acting account in the first browser: the Devices panel and admin controls stay the same.
7. **Missing key.** Delete that account (or open the workspace in another browser): the card shows "Needs 0x…'s key" with a link to Accounts, and the Devices panel is hidden.
8. **Join form URL.** On Cloud change the node URL and Use this node: the Join form's Worker URL follows unless you typed in it.
9. **Themes and phone width.** Check all three themes and phone width: the Devices table scrolls sideways inside its panel and the invite form wraps.

# Writing to a deployed chain (plan 20)

**Submit answers per tx.** `POST /chains/<id>/submit` returns `{ head, results }`, one entry per tx in order: `{ hash, result: 'mined', block }` or `{ hash, result: 'refused', code: 'nonce' | 'invalid', reason }`. Resending a tx the chain already mined answers `mined` again (idempotent), so a client that lost the reply can just resend. The body is capped at 512 KiB (`MAX_SUBMIT_BYTES`; `413` over it, before auth) and 256 txs (`400`), so a block's stored row (txs plus receipts) stays well under Durable Object SQLite's 2 MB row limit; a block whose row would still pass 1.5 MB (`MAX_BLOCK_BYTES`, e.g. txs with huge logs) is refused before it is stored with a `400` naming its size, so a `Follower`'s split isolates the tx. `GET /blocks` returns at most 100 blocks and stops before the block that would pass 8 MiB (always at least one); a client loops pages. Changes from the earlier submit: an undecodable tx is refused per tx (`invalid`), not a `400` for the request; an empty submit mines nothing; non-hex input is a `400`. webevm checks nonce and funds only when it mines, so `ChainNode` prechecks them per tx (the funds check counts the block's earlier spend from the sender but not what earlier txs pay in, so a tx short of funds, and its sender's later txs, are retried in a second block of the same request; only what still fails is refused: funds `invalid`, the gap behind it `nonce`). A failure not caused by a tx (any failure after mining: the dump, a missing tx or receipt, the mined-set check, the commit; or a failed rebuild) answers `503`, so a client keeps its txs; a tx-caused rejection of the whole block stays `400`.

**Chain ACL and contract ACLs.** The chain's `ChainAccess` checks the key that signs the request (writer to submit, reader to read). The sender of a tx inside it needs no chain role, so a broker device can submit a tx signed by another key. Who may do what in an app is up to its contracts (ADR-0025).

**`FollowerStore`** (`src/followerStore.ts`): `loadConfirmed`/`saveConfirmed` hold the last confirmed copy (head plus a trimmed dump) and `listPending`/`putPending`/`deletePending` the pending records keyed by `seq`. `MemoryFollowerStore` is the in-memory one; with a store, `Follower.open` boots from the stored copy with no network and re-runs the stored pending txs on top.

**`Follower` writes.** `send(raw)` runs the tx on the local copy and keeps it as pending (stored before it returns); a tx the local node refuses throws and is not kept. `sync()` submits the pending txs in batches of `DEFAULT_BATCH` (25; a whole-batch `400`/`413` splits it in halves, and only a single tx is refused for it), replays the cloud's blocks, and settles each record by comparing the cloud's status and logs with the first local outcome: `confirmed`, `conflicted` (with the cloud's outcome), or `refused` (with the reason). A `nonce` refusal is re-signed with the sender's next nonce when `signer(from)` returns its key. A tx that differs after an earlier conflicted one is marked `dependsOn`. `dismiss(hash)` forgets a settled record; `onPending` gets the whole list after any change. A device that is no longer a writer has its pending txs refused; one that is removed has them refused as `removed from chain`, and a mismatch refuses them as `chain no longer matches: …`.

Known limits:
- A re-signed contract deploy (its address depends on the nonce), or a tx whose logs include a block number or time, always ends `conflicted`: outcomes are compared by status and logs.
- `send` runs in the same queue as `sync`, so it can wait behind a running sync.
- webevm 0.9.1 `loadState` does not reset accounts missing from the dump, so the Follower rebases on a fresh node (upstream, board t-130).

`make e2e-node` also runs the write race: phone and tablet send offline to different keys and both confirm, each seeing the other's; one key imported on both spends one balance, so one is confirmed and one conflicted; a broker submits a tx signed by a key with no role; the phone reopens from its store with its client pointed at an unreachable URL (not a stopped worker), opens at the stored head with its tx pending, and settles once it can reach the worker.
