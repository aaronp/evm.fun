---
version: 1
theme: ledger
ledger.grid: true
effects.create: random
effects.delete: random
effects.complete: random
---
# evm.fun

## Backlog

### Chain workspace: an app for people, not developers
- id: t-151
- tags: outcome, chains, web, size-L
- history:
  - Backlog @ 2026-11-24T20:43:30Z

```md
A separate app (not evm.fun; evm.fun stays the developer playground) where people create chains, deploy them, give people, groups and devices read/write/deploy access, add contracts from a marketplace, and read their data over REST: a programmable database with easy reads. Design: [Chain workspace](https://claude.ai/code/artifact/76120764-ecd9-4317-a5ee-f6fde6920bdf) (chains list, chain dashboard, contract studio, chain settings, deploy with a one-time code, access picker, contacts & groups). Aaron, 2026-11-24.

Order: deploy role (t-152) → followers by subscription (t-144) → governance allow-lists and contacts (t-147, t-143) → indexer (t-153) → the app (t-154). SpacetimeDB: the spike (t-155) says viable; not built until per-database cost is measured on a paid account (Aaron, 2026-11-25). Where it lives (e.g. mychain.dev) to settle with t-142.
```

```dod
- [ ] t-152, t-147, t-143, t-153 and t-154 done
- [ ] Someone who isn't a developer creates, deploys and shares a chain and reads a contract's data over REST, unaided
```

### Indexer: REST reads with their own access
- id: t-153
- parent: t-151
- tags: chains, views, size-M
- history:
  - Backlog @ 2026-11-24T20:43:30Z

```md
Serve chain data as plain REST JSON at named routes (`/chains/:id/<alias>/…`), each with its own read rules, separate from chain reads. Port the views spike (`docs/spikes/cf-views.md`: aliases, recipes, `access-controls/latest`) into `packages/node`; recipes for the self-describing contract, ERC20 and the key/value store. t-139 (the key/value contract and its view) is its first use.
```

```dod
- [ ] Aliases and their routes served by the worker; a key without access is refused, open reads make it a plain GET
- [ ] Recipes: self-describing, ERC20, key/value
- [ ] Docs (t-137)
```

### Chain workspace screens
- id: t-154
- parent: t-151
- tags: web, size-L
- history:
  - Backlog @ 2026-11-24T20:43:30Z

```md
Build the [Chain workspace design](https://claude.ai/code/artifact/76120764-ecd9-4317-a5ee-f6fde6920bdf) as its own app on `packages/node` and `packages/contracts` (shared parts of `packages/web` where they fit): chains list, chain dashboard, contract studio (marketplace + create your own), chain settings (chain access, contract permissions, devices, deployment), deploy with a one-time code, access picker, contacts & groups. Follow the mockups faithfully.
```

```dod
- [ ] Every board in the design works against a local worker
- [ ] Tokens only, three themes (or the design's), phone width, contrast tests
```

### Followers: streaming instead of polling
- id: t-144
- parent: t-112
- tags: chains, cloudflare, size-M
- history:
  - Backlog @ 2026-11-23T20:46:23Z

```md
Followers pull new blocks on demand: the cloud node pushes each new head over a hibernating WebSocket (proved in the t-128 spike), so devices stop polling. Until then polling is configurable per browser (5 s / 15 s / 60 s / Manual, plus Sync now) — plan 18. Cuts the per-poll nonce write and read check (risk R57). Aaron, 2026-11-23.

**Next (Aaron, 2026-11-25):** after the SpacetimeDB spike (t-155) showed subscription followers working, adopt the subscription model on Cloudflare now: the same push-a-block shape a SpacetimeDB destination would use later.
```

### Device bookkeeping contract
- id: t-143
- parent: t-151
- tags: chains, access, size-M
- history:
  - Backlog @ 2026-11-23T19:08:02Z

```md
Users record what and where each device key is ("my work computer", "the family tablet") in a contract on the chain itself, so every device and view sees the same names. Until then a device's name is the `x-node-name` its follower sends, kept with its cursor on the cloud node (devices design). Idea from Aaron, 2026-11-23.

**Chain workspace (t-151):** this becomes the design's **Contacts** contract: people and devices with their public keys (added by hand or fetched from a URL), which the access picker resolves.
```

### Move evm.fun to mychain.dev
- id: t-142
- parent: t-108
- tags: infra, web, size-S
- history:
  - Backlog @ 2026-11-23T18:00:00Z

```md
evm.fun is served at `aaronp.github.io/evm.fun/`. Serve it at `mychain.dev` (the worker's CORS already allows `https://mychain.dev`). **Open (2026-11-24):** the Chain workspace app (t-151) is separate from evm.fun and may be the better fit for mychain.dev; decide which goes where before doing this.

Aaron's DNS steps: in Cloudflare (once `mychain.dev` is a zone, t-134), add a `CNAME` record `mychain.dev` (or `www`) → `aaronp.github.io` (DNS only), then repo Settings → Pages → Custom domain `mychain.dev`, and tick Enforce HTTPS once the certificate is issued. The Pages build adds a `CNAME` file containing `mychain.dev` to the published folder (e.g. `packages/web/public/CNAME`) so each deploy keeps the setting.

Check: the app's HashRouter and relative assets still work at the root path; `cloud.mychain.dev` and `mychain.dev` share the zone, so nothing changes for the worker.
```

```dod
- [ ] Aaron: DNS `CNAME` and the Pages custom domain set
- [ ] A `CNAME` file in the Pages build output
- [ ] https://mychain.dev loads the playground and reaches the worker (CORS)
```

### Invites: single-use or multi-use within a TTL
- id: t-133
- parent: t-112
- tags: chains, access, size-S
- history:
  - Backlog @ 2026-11-22T22:32:43Z

```md
One invite mechanism `{hash, expiry, usesLeft, grants}`: the creator commits hash(code); a claimer reveals the code. Single-use (usesLeft = 1, a captured code is worthless after the claim) or multi-use until expiry (a group joins with one code). Grants a role: a device/key on a chain's access contract, or a slot to create a new chain in the root registry.

Spiked (views spike, [docs/spikes/cf-views.md](../spikes/cf-views.md)): single-use refused on the second claim; one multi-use code let 3 keys join then was refused after expiry; a 2-use code refused the third claim. The chain-creation grant is sketched only; deploy codes (t-134) reuse this mechanism.

Part 1 done (worker + Follower): `POST /chains/:id/join` redeems a reader/writer code; a create-chain code is refused (403). Part 2 done: Cloud → Join a chain (a join link without the code), and the admin invites a reader (default, single use) or writer from the Devices panel, with the R55 warning on a multi-use writer code. Not yet checked by hand in two browsers (checklist in packages/node/README.md).
```

### Views: readable current state per contract (aliases + recipes)
- id: t-135
- parent: t-112
- tags: chains, views, size-M
- history:
  - Backlog @ 2026-11-22T22:32:43Z

```md
`GET /<chain>/<alias>/latest` → the contract's current state as JSON, under the alias's own read rules (separate from raw chain access; e.g. `GET /<chain>/access-controls/latest` → {read, write}). Aliases live in an on-chain registry (name → address, recipe, access contract). Recipes: contracts we design expose state via read functions (e.g. readers(), writers()); standard contracts get a recipe too (e.g. ERC-20 → balances by address, holders found from Transfer events, balances read now). A full event-folding indexer is later.

Spiked ([docs/spikes/cf-views.md](../spikes/cf-views.md)): `Aliases.sol` in genesis; recipes `self-describing` (view functions listed in the alias) and `erc20`; per-alias access contract (a view-only key gets its alias, 403 elsewhere; open reads make it a plain GET). Cost: 4 calls ~1 ms (access-controls), GBP 10 holders 15 calls + 1 log scan ~1.3 ms, 200 holders ~4.4 ms; the holder scan grows with history.
```

### webevm: per-block timestamp and history-free dump
- id: t-130
- parent: t-112
- tags: chains, upstream, size-S
- history:
  - Backlog @ 2026-11-22T21:41:18Z

```md
From t-128: the block timestamp is the only nondeterminism between the DO and replicas, pinned today through a webevm internal. Upstream `mine({timestamp})` and a dump without state history.

Also found in the access spike (129e7fd): webevm 0.9.1 `loadState` keeps accounts absent from the snapshot, so rolling back a refused block left the new sender's nonce behind (DO/replica drift). The spike rebuilds the node on rollback (~10 ms); fix upstream. The `Follower` (t-132) rebases on a fresh node for the same reason.
```

### Governance.sol: a self-governed allow-list as ChainAccess admin
- id: t-147
- parent: t-151
- tags: chains, contracts, size-M
- history:
  - Backlog @ 2026-11-24T12:00:00Z

```md
The chain ACL checks only the submitting key; what a tx's sender may do is up to the contracts (ADR-0025). A `Governance.sol` that holds an allow-list and votes members in and out, and is itself the `ChainAccess` admin, so the owner key is no longer the single authority.

**Chain workspace (t-151):** allow-lists are reusable: other contracts (key/value store, ERC20, escrow) point at a governance allow-list for who may act, instead of keeping their own; the design's "groups" are these allow-lists.
```

```dod
- [ ] A governance contract is the chain's admin; adding or removing a member goes through it
- [ ] A `Follower` write to it settles confirmed or conflicted like any other
```

### Re-point contract records after a re-signed deploy
- id: t-148
- parent: t-136
- tags: chains, web, size-S
- history:
  - Backlog @ 2026-11-24T14:00:00Z

```md
When a deploy is re-signed after a nonce refusal it lands at another address. The Pending panel shows conflicted ("Deployed at <cloud>, not <local>"), but the page saved the local address, so the contract and asset records still point there. Rewrite them to the cloud address when the tx settles conflicted. Found in plan 21 (t-132).
```

### Followers remember their last known role
- id: t-149
- parent: t-136
- tags: chains, web, size-S
- history:
  - Backlog @ 2026-11-24T14:00:00Z

```md
The role (writer or reader) is known only after the first good sync and is not saved. A reader that opens offline can queue sends, and the cloud later refuses them as "not a writer". Save the last known role with the follower's store so a reader is refused at once, offline too. Found in plan 21 (t-132).
```

### Show the revert reason for a locally reverted send
- id: t-150
- parent: t-136
- tags: chains, web, size-S
- history:
  - Backlog @ 2026-11-24T14:00:00Z

```md
A send that reverts in the device's local copy shows "reverted" with no reason, because the RPC receipt carries none. Re-run the call (`eth_call` at the block before) to decode and show the reason. Found in plan 21 (t-132).
```

### Remote chain: device enrolment and auth hardening
- id: t-131
- parent: t-112
- tags: chains, cloudflare, size-M
- history:
  - Backlog @ 2026-11-22T21:41:18Z

```md
From t-128: real device enrolment (pairing / owner-signed invites — see the access-control brainstorm), owner key rotation, multiple owners or thresholds, tx-sender ↔ device binding, rate limits.

Access spike (branch spike-cf-chain, 129e7fd, `bun spike/cf-chain/access.ts` → ALL PASS, 49 checks; report [docs/spikes/cf-access.md](../spikes/cf-access.md)): `ChainAccess.sol` in genesis at 0xacce55… (admin, readOpen, reader/writer sets); the DO checks canRead/canWrite from its own state on every request (~15–20 µs); tx senders must be writers; changes apply next block and close revoked sockets; plain GET when reads are open, self-signed short-TTL bearer tokens otherwise (~1 ms verify); gas-free chains; `invite(hash, ttl)` + `claim(code)`.
```

### Later: multi-node cluster (phone, laptop, worker)
- id: t-119
- parent: t-112
- tags: chains, later, size-L
- history:
  - Backlog @ 2026-11-22T17:12:28Z

```md
A chain's nodes run on several devices and agree on its state and policy. Relates to t-111 (device-local chain settling with a deployed one) and approach 04 (durable, replayable log).
```

### Cross-chain transactions (orchestration)
- id: t-113
- tags: outcome, crosschain, size-L
- history:
  - Backlog @ 2026-11-22T17:12:28Z

```md
A general **distributed transaction** across chains: e.g. an inventory chain, a sales/tickets chain and stablecoin chains in one business. HTLC is the first strategy (step 3, ADR-0021); explore others. A coordination layer runs each party's part automatically so a trade is one action, not four manual steps.

**Seam:** a **settlement strategy** interface — a trade is a set of legs (chain, asset, from, to, amount) → a plan of steps → status/outcome. Strategies (HTLC, …) implement it; consumers (payments, barter, the cross-chain order book) only call it.
```

```dod
- [ ] A strategy interface with HTLC as the first implementation
- [ ] An orchestrator completes a two-chain trade end to end without manual steps
- [ ] At least one other strategy explored and compared
```

### Settlement strategy interface + HTLC strategy
- id: t-120
- parent: t-113
- tags: crosschain, size-M
- history:
  - Backlog @ 2026-11-22T17:12:28Z

```md
Define legs → steps → status/outcome; wrap `@evmb/htlc` as the first strategy. Done when a two-leg trade runs through the interface on two chains with today's report.
```

### Orchestrator: act for each party automatically
- id: t-121
- parent: t-113
- tags: crosschain, size-M
- history:
  - Backlog @ 2026-11-22T17:12:28Z

```md
Watches both chains and performs each party's next step (lock, answer, claim, refund) for accounts in this browser, so a trade completes in one action. Done when a trade completes and a stalled one refunds without clicks.
```

### Explore other strategies (escrow agent, two-phase commit)
- id: t-122
- parent: t-113
- tags: crosschain, size-M
- history:
  - Backlog @ 2026-11-22T17:12:28Z

```md
Compare HTLC with e.g. a trusted escrow agent or a coordinator-driven two-phase commit: latency, failure cases, trust. Done when one more strategy runs behind the interface and an ADR compares them.
```

### Cross-chain order book
- id: t-66
- parent: t-113
- tags: outcome, markets, size-L
- history:
  - To Do @ 2026-11-20T08:48:39.324Z

```md
Next on the roadmap: steps 3 (t-62, ADR-0021) and 6 (t-64's off-chain venue) are done. Off-chain matching (step 6) with HTLC settlement (step 3): matched pairs whose legs are on different chains settle by hash-lock.

Later: netting, auctions, the vault, and the full market wizard. By then each is an option added to pieces that already work.

Why this order: steps 2 and 3 are the same feature, first on one chain and then across two. That gets you cross-chain settlement by step 3 without first building an order book. The pool is independent, so you could swap it with step 5 if order books matter more to you.
```

```dod
- [ ] An off-chain-matched order whose legs are on two chains settles by hash lock
- [ ] Report and walkthrough for a cross-chain fill
```

### Per-contract permissions (governance)
- id: t-114
- tags: outcome, permissions, size-M
- history:
  - Backlog @ 2026-11-22T17:12:28Z

```md
Who may hold or move an asset, decided by a governance contract the asset consults (allow-lists, KYC onboarding). Independent of chain-level policy (t-112): a chain may be open while an asset on it is restricted.

**Seam:** an asset's transfer hook `canTransfer(from, to)` answered by a governance contract; launching an asset optionally names one. Contracts that hold assets (pool, order book, HTLC) must be allowed holders.
```

```dod
- [ ] A governed asset refuses transfers to non-allowed addresses
- [ ] Pool, order book and HTLC work with governed assets
```

### Add Governance.sol
- id: t-110
- parent: t-114
- history:
  - Backlog @ 2026-11-22T11:44:29.041Z
  - Next @ 2026-11-22T11:44:43.189Z
  - Backlog @ 2026-11-22T11:44:47.610Z

```md
We have a Governancel.sol in another project which white-lists (allow-lists) addresses, and can be added to an e.g. ERC20 which checks it with 'canTransfer'. This lets us onboard (KYC) people in some process, so we know who holds what addresses.

We'll want to show this on one chain, in the Uniswap example too (we'd have to ensure KYC's addresses are taken into account in the liquidity pool), and also cover our cross-chain transfers
```

### Governed assets in pool, order book and HTLC
- id: t-123
- parent: t-114
- tags: permissions, size-M
- history:
  - Backlog @ 2026-11-22T17:12:28Z

```md
Contracts that escrow or pool assets must be allowed holders; the pages explain a refusal. Done when each venue works with a governed asset and refuses a non-allowed trader clearly.
```

### Application layer: assets, payments, barter
- id: t-115
- tags: outcome, app, size-L
- history:
  - Backlog @ 2026-11-22T17:12:28Z

```md
The abstractions a shop (or a flight booker, a local coin…) needs, built on the three workstreams below: **inventory** and **currency** assets, **payments** (pay with a currency, possibly on another chain), **barter** (item for item, make an offer), and later auctions. UI-free; the Shop (t-104) is one veneer over it.

**Seam:** application primitives — Asset (inventory | currency), Listing (for a price or a barter), Offer, Purchase — each mapped onto chains (t-112), settlement (t-113) and permissions (t-114).
```

```dod
- [ ] Inventory and currency assets with a catalogue (Site)
- [ ] Pay for a listing with a currency on the same or another chain
- [ ] Barter: offer one item for another and accept
```

### Site: a catalogue of inventory and currencies
- id: t-124
- parent: t-115
- tags: app, size-S
- history:
  - Backlog @ 2026-11-22T17:12:28Z

```md
`Site.sol`: name, owner, inventory and currency entries (possibly on other chains). Spec draft: docs/superpowers/specs/2026-11-22-shop-design.md (to revise for multiple chains).
```

### Payments: buy now with a currency
- id: t-125
- parent: t-115
- tags: app, size-M
- history:
  - Backlog @ 2026-11-22T17:12:28Z

```md
A purchase settles item and payment, on one chain via the order book or across chains via t-113.
```

### Barter: item-for-item offers
- id: t-126
- parent: t-115
- tags: app, size-M
- history:
  - Backlog @ 2026-11-22T17:12:28Z

```md
Offer k of one asset for another; the other side accepts or counters. Same chain or across chains.
```

### Later: auctions
- id: t-127
- parent: t-115
- tags: app, later, size-M
- history:
  - Backlog @ 2026-11-22T17:12:28Z

```md
An auction model for listings (e.g. timed, highest bid), as another Listing kind.
```

### Shop: the friendly veneer
- id: t-104
- tags: outcome, shop, size-L
- history:
  - To Do @ 2026-11-22T11:40:00Z
  - Next @ 2026-11-22T11:50:41Z
  - Backlog @ 2026-11-22T17:12:28Z

```md
The user-facing layer over the application layer (t-115): owners see "Launch Site" and "Add inventory"; buyers see "Buy now", pay with a stablecoin, or make a barter offer — the Trade page's machinery shown in a familiar way. Built after t-112, t-113, t-114 and t-115.

A friendly app on top of the playground for issuers and traders. "Launch Site" takes a name (advanced: on its own chain or an existing one). The owner uploads inventory as digital assets (e.g. "chairs", 10 for the shop owner) and can launch currencies (a stablecoin is just a currency asset). Buyers pay a price in a currency, or swap another asset ("2 hours sweeping for 1 chair"). Underneath: assets, balances and an order book or swap, on chain. Examples to model: a flight booker, an Airbnb or eBay clone, a local coin.
```

```dod
- [ ] Launch Site with only a name
- [ ] Upload inventory as assets; launch a currency
- [ ] List items for a currency price or for a swap; a buyer completes a purchase
- [ ] Issuer and trader personas; calls the trading packages directly (the client API, t-103, is on hold)
```

### Client API & private chains
- id: t-103
- tags: outcome, api
- history:
  - To Do @ 2026-11-22T11:40:00Z
  - Next @ 2026-11-22T11:41:31.076Z
  - Backlog @ 2026-11-22T11:50:41Z

```md
On hold (2026-11-22): the deployment model is undecided — a chain behind a REST API, or a device-local chain that settles with a deployed one (t-111). An operations API designed for REST may not fit the second, so wait until that is clearer.

Every user operation (accounts, issue assets, transfer, approve, swap offers, orders, pool, cross-chain locks) behind one typed TypeScript client, so pages, walkthroughs and bots call the client instead of building transactions. A minimal wrapper: the point is that the same client could later talk to a chain deployed behind a REST API (a "private chain").
```

```dod
- [ ] One client interface covering the user operations, with an in-browser implementation over today's chains
- [ ] Pages, walkthroughs and Install use it (no page builds a tx itself)
- [ ] An Elysia REST server + Eden client implementation exists and passes the same tests (see child)
```

### Private chain behind REST ("deploy")
- id: t-109
- parent: t-103
- tags: api, deploy
- history:
  - To Do @ 2026-11-22T11:40:00Z
  - Next @ 2026-11-22T11:41:34.413Z
  - Backlog @ 2026-11-22T11:50:41Z

```md
After using the playground, "deploy" a chain: run it behind a REST API (Bun server) that implements the client API, so the same client works against it. Done when the client test suite passes against the REST implementation.

Doing this with an Elysia service which can 'front' the same revm machinery would be idea.

That is, we're taking the exact (or near enough) same code / packages we run in the playground and put them behind REST routes with Elysia CORS/Swagger and an Eden client we can call
```

### Device-local chain that settles with a deployed chain
- id: t-111
- tags: idea, deploy
- history:
  - Backlog @ 2026-11-22T11:50:41Z

```md
An alternative to t-103/t-109: each user runs their own private chain on their device (laptop, phone), and an ETL pipeline or integration settles it with a shared deployed chain. Open questions: what is reconciled (balances, trades), what counts as final, and how conflicts are resolved. Decide this before designing a client or REST API.
```

### Bots & live markets
- id: t-86
- tags: outcome, bots
- history:
  - To Do @ 2026-11-20T22:37:53Z

```md
ADR-0017, ADR-0018. Extend walkthroughs with personas: a setup that deploys assets, then market-maker and trader bots that place bids/asks on a venue according to a strategy (e.g. a spread around a reference price, random takers), so a book fills with realistic activity.
```

```dod
- [ ] Bots install from Get started like walkthroughs (market maker, random taker at least)
- [ ] A running bot trades on a venue through the client API, and trades appear live on the Trade/Pool pages
- [ ] Bots can be started, paused and stopped; their activity is visible
```

### Markets: scale & robustness
- id: t-105
- tags: outcome, markets
- history:
  - To Do @ 2026-11-22T11:40:00Z

```md
Follow-ups from the swap, order book, pool and cross-chain swap steps: reads that grow with history, indexes, non-standard tokens, and edge cases. Children are independent; pick them up when a page gets slow or a case bites.
```

### Swap: index offers when the book gets large
- id: t-67
- parent: t-105
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T09:28:19Z

```md
ADR-0016 reads every offer ever made (offers(1..nextId-1)). When a chain's history makes the Swap page slow, add an incremental indexer keyed by block (ADR-0016 solution C/B upgrade path) without changing Swap.sol.
```

### Swap: exact revert reasons for same-block failures
- id: t-68
- parent: t-105
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T09:28:19Z

```md
ADR-0016: non-status failures are replayed with eth_call at the parent block, so an approve or transfer earlier in the same block is missed. Replay with the block's preceding txs applied (or trace the tx) to report the true reason.
```

### Swap: Activity without a block scan
- id: t-69
- parent: t-105
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T09:28:19Z

```md
ADR-0016: reverted takes are found by scanning every block for txs to the Swap with status 0. Index failed attempts (or the explorer's tx index) so Activity's cost doesn't grow with chain length.
```

### Swap: native ETH in offers
- id: t-70
- parent: t-105
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T09:28:19Z

```md
ADR-0016: step 2 is ERC-20 only because ETH can't be escrowed with transferFrom. Add a payable make/take path or wrap to WETH.
```

### Swap: named markets ("New market")
- id: t-71
- parent: t-105
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T09:28:19Z

```md
ADR-0016: a market is any (base, quote) pair of the chain's assets. The mockup's "New market" screen (named pairs, defaults, tick size) is deferred; revisit with the order book (t-64).
```

### Swap: per-maker on-chain offer index
- id: t-72
- parent: t-105
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T12:39:29Z

```md
ADR-0016, R20: makeOffer records offer ids per maker so "your offers" reads the maker's ids in O(1) instead of filtering every offer.
```

### Swap: fee-on-transfer and rebasing tokens
- id: t-74
- parent: t-105
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T12:39:29Z

```md
ADR-0016, R22: measure the balance delta on deposit, or refuse such tokens, so escrow can't be left short.
```

### Order book: contract list growth and push payments
- id: t-82
- parent: t-105
- tags: orderbook, backlog
- history:
  - To Do @ 2026-11-20T20:08:20Z

```md
ADR-0018, R28, R29: compact dead ids out of level queues, bound the hint walk and ordersOf, and skip a failing maker (or pull payments) so one token can't block a level.
```

### Order book: reads that grow with history
- id: t-83
- parent: t-105
- tags: orderbook, backlog
- history:
  - To Do @ 2026-11-20T20:08:20Z

```md
ADR-0018, R26, R27: index trades instead of reading the log from the deploy block; batch and cache the off-chain book's balance/allowance reads; poll the Trade page less.
```

### Order book: signatures, nonces and journal gaps
- id: t-84
- parent: t-105
- tags: orderbook, backlog
- history:
  - To Do @ 2026-11-20T20:08:20Z

```md
ADR-0018, R31, R32, R33: ERC-1271 and a per-maker nonce floor in Settlement; record the tx hash at broadcast and reconcile pending attempts; warn when an off-chain order loses coverage.
```

### Order book: idbStore in a real browser
- id: t-85
- parent: t-105
- tags: orderbook, backlog
- history:
  - To Do @ 2026-11-20T20:08:20Z

```md
ADR-0018, R30: run the store conformance suite in a real browser; keep rows with undefined/NaN index keys consistent with memoryStore; handle versionchange and blocked opens.
```

### Pool: bound the activity read (R36)
- id: t-87
- parent: t-105
- tags: pool, backlog
- history:
  - To Do @ 2026-11-21T12:40:00Z

```md
ADR-0019, R36: `activity` reads every event from the deploy block on each call. Use a bounded window with "load more", or an incremental read that keeps the last block seen.
```

### Pool: discovery and dust-liquidity guards (R37, R38)
- id: t-88
- parent: t-105
- tags: pool, backlog
- history:
  - To Do @ 2026-11-21T12:40:00Z

```md
ADR-0019, R37, R38: no factory, so pools are found via contract records. Add a registry (or factory) so pools deployed elsewhere are found and duplicates refused chain-wide; warn on or refuse adds into dust reserves.
```

### Pool: mulDiv and non-standard tokens (R39, R40)
- id: t-89
- parent: t-105
- tags: pool, backlog
- history:
  - To Do @ 2026-11-21T12:40:00Z

```md
ADR-0019, R39, R40: use full-precision mulDiv in Pool.sol to remove the theoretical uint256 overflow ceiling; support or explicitly reject fee-on-transfer and rebasing tokens (measure received balances).
```

### Cross-chain swap: locksFor log scan
- id: t-93
- parent: t-105
- tags: htlc, backlog
- history:
  - To Do @ 2026-11-22T10:34:06Z

```md
ADR-0021, R48: `locksFor` reads every `Locked` log from the HashLock's deploy block; bound the window or index locks so page loads don't grow with the chain.
```

### Cross-chain swap: older HashLocks on chain A
- id: t-94
- parent: t-105
- tags: htlc, backlog
- history:
  - To Do @ 2026-11-22T10:34:06Z

```md
ADR-0021, R50: `sidesFor` reads only chain A's newest HashLock, so an opening lock on an earlier one isn't found after a redeploy; search every HashLock record on A.
```

### Walkthroughs
- id: t-106
- tags: outcome, walkthrough
- history:
  - To Do @ 2026-11-22T11:40:00Z

```md
Follow-ups to the guided walkthroughs (ADR-0017): more step types, running on an existing chain, ribbon robustness and a DOM test harness.
```

### Walkthroughs: more step types (transfer, cancel, snapshot, fork)
- id: t-77
- parent: t-106
- tags: walkthrough, backlog
- history:
  - To Do @ 2026-11-20T15:00:00Z

```md
ADR-0017: the first slice has only the steps the two bundled walkthroughs use. `transfer` now exists (ADR-0019, gbp-usd-pool). Still to add: cancel, and snapshot / fork / restore so long scenarios can branch from a saved state.
```

### Walkthroughs: run on an existing chain
- id: t-78
- parent: t-106
- tags: walkthrough, backlog
- history:
  - To Do @ 2026-11-20T15:00:00Z

```md
ADR-0017: each run creates a fresh chain because chains only prefund at creation. Allow choosing an existing chain, funding traders' gas from a funded account.
```

### Walkthroughs: ribbon robustness (switch errors, concurrent rendering)
- id: t-79
- parent: t-106
- tags: walkthrough, web, backlog
- history:
  - To Do @ 2026-11-20T16:32:38Z

```md
ADR-0017, R23, R24: surface selectChain failures in the ribbon instead of waiting 5 s for the generic message, and move the render-time writes in useWizardField / useWizardAction into effects (or useSyncExternalStore) so they hold under concurrent rendering.
```

### Walkthroughs: DOM test harness for the ribbon
- id: t-80
- parent: t-106
- tags: walkthrough, web, backlog
- history:
  - To Do @ 2026-11-20T16:32:38Z

```md
ADR-0017, R25: add a DOM harness so ribbon effects, Next's chain/account switch wait and field refill are tested, not only checked in the browser.
```

### Chain engines & benchmarks
- id: t-107
- tags: outcome, approach
- history:
  - To Do @ 2026-11-22T11:40:00Z

```md
The benchmark side: further execution approaches (state roots, durable log, revm, external RPC nodes, later parallel and non-EVM), their fixes, and new scenarios. Measured in the report against approaches 01 and 02.
```

### Approach 02: a tx whose sender can't pay gas×fee+value stops the executor for good; reject at admission
- id: t-91
- parent: t-107
- owner: Claude
- tags: approach
- history:
  - To Do @ 2026-11-21T16:19:09.000Z

```md
On an approach-02-seq-memory chain, a tx whose sender can't pay gas × fee + value makes webevm's mine() throw, and approach-02 marks that fatal: the chain's executor stops permanently. The web app's signAndSend pre-checks the balance (partial control, see R41); fix it where all clients meet: reject such a tx at admission in approach-02 so it never reaches the executor.
```

### Approach 03: seq-stateroot
- id: t-09
- parent: t-107
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

```md
Per-block and deferred state root. Closes ADR "State root per block, deferred, or none".
```

### Approach 04: seq-durable
- id: t-10
- parent: t-107
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

```md
Append-only replayable log: file (Bun), IndexedDB (browser).
```

### Approach 05: seq-revm
- id: t-11
- parent: t-107
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

```md
Approach 02's pipeline on the revm-wasm engine (`createRevmEngine`) instead of webevm's default. Plan 1 found `mine()` dominates, especially for fresh accounts; this tells us whether the engine or the pipeline is the limit. Done when it runs every scenario and the report compares it with 02.
```

### Approach 06: rpc (anvil / Besu)
- id: t-12
- parent: t-107
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

```md
A JSON-RPC approach: the harness sends the same signed transactions to an external node (anvil or Besu) over RPC. Keeps "compare any implementation on identical input" honest. Done when the harness runs every scenario against anvil, with a recipe for Besu.
```

### Benchmark: order book versus pool on the same trade
- id: t-95
- parent: t-107
- tags: benchmark, backlog
- history:
  - To Do @ 2026-11-22T11:10:41Z

```md
Roadmap step 5 named two scenarios: book-match (done as book-match-onchain / book-match-offchain) and "book versus pool on the same trade" (not built). Run the same GBP/USD trade through OrderBook.sol and Pool.sol and compare gas, throughput and price.
```

### Later: parallel execution approaches
- id: t-17
- parent: t-107
- tags: approach, later
- history:
  - To Do @ 2026-11-19T09:38:00Z

```md
Later: approaches that execute non-conflicting transactions in parallel (e.g. optimistic execution with conflict detection), to see how far one machine goes past a single execution loop.
```

### Later: native-erc20 approach (evm: false)
- id: t-18
- parent: t-107
- tags: approach, later
- history:
  - To Do @ 2026-11-19T09:38:00Z

```md
Later: a non-EVM ledger approach for the erc20 scenario (balances in a native map, `evm: false`), to show what the EVM itself costs compared with plain state updates.
```

### Delivery
- id: t-108
- tags: outcome, infra
- history:
  - To Do @ 2026-11-22T11:40:00Z

```md
Getting the playground in front of people.

Currently the playground is served via GH pages.

Having a real means to deploy their chains would be awesome
```

## Next

### Documentation
- id: t-137
- history:
  - Next @ 2026-11-23T08:20:40.001Z

```md
We want clear TypeDoc documentation we can build/serve for each area we build
```

```dod
- 'make doc' builds the documentation
- we can include 'docs' as part of our built Github Pages
```

### Roadmap
- id: t-136
- history:
  - Next @ 2026-11-23T08:16:30.318Z

```md
I think we want:

1. To have a 'deploy button to deploy a chain to CF from our playground. This respects our chain permissions: the user needs to supply an auth code which permits them to do this, which will require an answer for how we 'bootstrap' the first chain (admin chain), which could be "the chain deployed is allowed"

2. We can control 'node' permissions -- that is, which devices/instances are allowed to read and write from the chain. This is how we allow our laptops/phones/tablets/browsers to create keys and "sync" via the CF node.

3. We can view and edit our 'indexer' when deploying new contracts on the chain: the means to control read/write permissions for a smart contract on our chain, as well as view the materialised data for the contract

4. We can use the same code/hash permission exchange to expose a 'write' URL for a contract: i.e. swap the token for a key, and use it to save our 'tools' (including a new interactive draw tool as a PoC), and our 'relay' ACL for a relay topic.

**End-to-end demo (Aaron, 2026-11-23): an N-node revm cluster per chain.** The CF node runs on demand; browsers and other permitted devices join as nodes.

a. A user creates a chain in their browser (evm.fun).
b. They deploy a contract on it (a wizard, an ERC-20, …).
c. They ask to deploy it to CF; Aaron gives them a deploy code.
d. They click Deploy: their CF node comes up with the same state (a 2-node cluster). — t-134, then t-132 (the browser node follows)
e. On another device/browser they create a key, choose their deployed chain, and enter a code they issued for their own chain, sending it with their public key. — t-131, t-133
f. That browser starts a revm node that joins the cluster and syncs.
g. They deploy/update contracts on their chain from either device.

**Demo cut (Aaron, 2026-11-23):** local `make dev-services` → root chain → issue a code and deploy chains (t-134) → browser follows (t-132) → add/remove a device in the UI (t-138) → key/value contract + its views (t-139) → each node's cursor (t-140) → the whole run as a walkthrough (t-141).
```

### Chain store: incremental state storage
- id: t-129
- parent: t-136
- tags: chains, cloudflare, size-M
- history:
  - Backlog @ 2026-11-22T21:41:18Z
  - Next @ 2026-11-23T12:50:38Z

```md
Before t-134. A `ChainStore` (`packages/node`) that persists only what each block changed, and a node lifecycle that boots from current state and rebuilds every N blocks, so per-block work and memory stay flat. Design: [chain store](../superpowers/specs/2026-11-23-chain-store-design.md).

Why (cost spike, [docs/spikes/cf-cost.md](../spikes/cf-cost.md)): the spike rewrites a full dump with all history every block (170 ms, 39.5 MB per 1-tx block at 10,000 blocks) and webevm keeps all history in memory (228 MB at 10,000 vs the DO's 128 MB). With diffs: 2.5–4.5 ms, ~3 KB per 1-tx block; boot 56 ms at any height. Cost is $0 beyond the $5/month minimum in every scenario either way. webevm has no pruning/change-set API; `loadState` accepts a trimmed dump.

Soak results, 2026-11-23, `make soak-node` exit 0 (commit = SQL write only; rows = diff keys + 1 block row; bytes = JSON of diff + block): commit 0.53-0.72 ms, 8 rows, about 9.9 KB per block, memory (JS heap + external) 70-85 MB (JS heap 46-55 MB), sampled just before the every-1,000 rebuild (the node's most history; the earlier post-rebuild sampling read 44-58 MB), flat from 1,000 to 10,000 blocks. `external` only partly reflects wasm linear memory (one revm node: external +2.4 MB, rss +15.6 MB), so `memMB` is a lower bound; the real Durable Object figure is measured under workerd in t-134.

    {"height":1000,"commitMsAvg":0.596,"rowsWrittenAvg":8,"bytesWrittenAvg":9833,"heapMB":35.4,"memMB":47.9}
    {"height":2000,"commitMsAvg":0.557,"rowsWrittenAvg":8,"bytesWrittenAvg":9871,"heapMB":33.2,"memMB":43.9}
    {"height":3000,"commitMsAvg":0.582,"rowsWrittenAvg":8,"bytesWrittenAvg":9866,"heapMB":40.5,"memMB":56.7}
    {"height":4000,"commitMsAvg":0.572,"rowsWrittenAvg":8,"bytesWrittenAvg":9872,"heapMB":40.4,"memMB":56.5}
    {"height":5000,"commitMsAvg":0.584,"rowsWrittenAvg":8,"bytesWrittenAvg":9872,"heapMB":40.9,"memMB":57.5}
    {"height":6000,"commitMsAvg":0.569,"rowsWrittenAvg":8,"bytesWrittenAvg":9867,"heapMB":40.5,"memMB":56.6}
    {"height":7000,"commitMsAvg":0.653,"rowsWrittenAvg":8,"bytesWrittenAvg":9872,"heapMB":40.8,"memMB":57.4}
    {"height":8000,"commitMsAvg":0.538,"rowsWrittenAvg":8,"bytesWrittenAvg":9838,"heapMB":40.5,"memMB":56.7}
    {"height":9000,"commitMsAvg":0.578,"rowsWrittenAvg":8,"bytesWrittenAvg":9871,"heapMB":40.9,"memMB":57.4}
    {"height":10000,"commitMsAvg":0.576,"rowsWrittenAvg":8,"bytesWrittenAvg":9875,"heapMB":40.6,"memMB":56.9}
    OK: roots and next blocks match at 2500, 5000, 10000; memory and commit time flat


```

```dod
- [x] `ChainStore` on DO SQLite and `bun:sqlite`; `node.ts` boot / apply / rebuild every N blocks (`Sql` interface; tested on `bun:sqlite`, the DO side is untested until t-134)
- [x] 10,000-block soak (`make soak-node`, a script rather than a Bun test): same root and next block after a fresh boot at 2,500, 5,000 and 10,000; flat per-block time and writes; memory (JS heap + external) under 128 MB
- [x] Docs (t-137): [how a node stores its chain](../../packages/node/README.md), ADR-0022, risk R51
```

### Deploy to Cloudflare: `make deploy` and deploy codes
- id: t-134
- parent: t-136
- tags: chains, cloudflare, access, size-L
- history:
  - Backlog @ 2026-11-22T22:32:43Z
  - Next @ 2026-11-23T11:32:10Z

```md
Roadmap item 1: turn the CF spike (`spike/cf-chain`, [docs/spikes](../spikes/)) into a real worker, and gate who may create chains on it. Was "Chain registry: who may create chains".

**Decided (Aaron, 2026-11-23):**
- **First chain = the root chain.** `make deploy` (your own Cloudflare login) deploys the worker and creates the **root chain**, with your key as its admin; locally, the same happens on the worker `make dev-services` starts. No code is needed for the root chain: the worker's config names the admin address (public, not a secret), and only that key may create it.
- **Root chain holds an `Accounts` contract** (admin = you). It stores deploy codes as `{hash(code), expiry}`, never the code itself.
- **Issuing a code:** in evm.fun you type a code you choose or generate (e.g. `my-first-friend`) and a TTL (e.g. 5 min); you sign the tx that writes `hash(code)` and `now + TTL` to `Accounts`.
- **Sharing:** you send the code to a friend out of band (text, email, in person).
- **Redeeming:** the friend opens evm.fun, picks one of their chains, chooses **Deploy chain** and enters the code. The create request carries the code; the worker hashes it and checks `Accounts` on the root chain: (1) the hash matches, (2) it is before expiry. Then it creates their chain (one Durable Object), with the friend's key as that chain's admin. Otherwise it refuses, saying which check failed.
- **The code alone is enough (option A):** no per-use approval. The TTL bounds the risk.
- **Local first, then live.** Everything above, including the deploy UI in evm.fun, works against a local worker before anything goes live. Makefile targets:
  - `make dev-services`: start the CF worker locally (`wrangler dev`) in the background
  - `make dev-services-status`: show what local services are running (pid, port, URL)
  - `make dev-services-stop`: stop them
  - `make deploy`: put the worker live on your Cloudflare account and create the root chain (last step, run by you)

**Claude's calls (correct any):**
- Codes use the invites mechanism from t-133 (`usesLeft`): single-use by default, multi-use optional, always within the TTL. The redeem is recorded on the root chain (who used it, which chain), so you see who deployed what.
- "Deploy chain" uploads the chosen playground chain's current state as the new chain's genesis. Afterwards the browser copy follows the remote chain (t-132).
- A typed code like `my-first-friend` is guessable. The UI offers a generated code, and the worker limits failed attempts per IP and per code.

**From t-129's reviews (do in t-134):** the worker passes an imported `WebAssembly.Module` and drives the chain only through `ChainNode.apply`/`read` (they serialise; never call the node from inside a `read` callback — it deadlocks); a failed lazy rebuild leaves a disposed node until the next `apply` (build the new node before disposing the old); add `dispose()` to the README; a `tx_hash → block` index for receipt lookups after a rebuild; measure real memory under workerd (`memMB` 70–85 MB in Bun is a lower bound); a small DO SQLite adapter (`toArray()`, `transactionSync`).

**Builds on:** t-129 chain store (first), t-133 invites, t-130 webevm fixes (timestamps, loadState), t-131 device auth. Design: [deploy to CF](../superpowers/specs/2026-11-23-deploy-to-cf-design.md). Cost spike: [docs/spikes/cf-cost.md](../spikes/cf-cost.md).
```

```dod
- [x] `make dev-services` / `dev-services-status` / `dev-services-stop` start, report and stop the local worker
- [x] Locally: the root chain with `Accounts` is created by the configured admin key; evm.fun (dev) points at the local worker
- [x] As the root admin, issue a code with a TTL from evm.fun (only `hash` + `expiry` on chain)
- [x] A second key deploys one of its chains from evm.fun with that code; that key is the new chain's admin
- [x] Refused: wrong code, expired code, used-up code, and a root-chain create by anyone but the configured admin
- [x] End-to-end test against the local worker; nothing deploys from CI
- [ ] Then live: `make deploy` puts the worker on your Cloudflare account and creates the root chain; prints the worker URL and root chain id; evm.fun can target it. Ready; run by Aaron (one-time steps in [packages/node/README.md](../../packages/node/README.md))
- [x] Docs updated (t-137): [how to deploy, issue and redeem a code](../../packages/node/README.md), ADR-0023, risks R52-R54
```

### Chain access list in evm.fun
- id: t-138
- parent: t-136
- tags: chains, web, access, size-M
- history:
  - Next @ 2026-11-23T15:00:21Z

```md
Design: [devices on a deployed chain](../superpowers/specs/2026-11-23-devices-follow-design.md) (A: follow and show). Demo step d. For a deployed chain, see and edit its access list (`ChainAccess`): readers, writers, open reads; add or remove a device key. Builds on the access spike (`docs/spikes/cf-access.md`) and t-134; device invites by code are t-133.
```

```dod
- [x] The chain admin sees readers/writers and open-reads for a deployed chain (Devices panel)
- [x] Add and remove a device key from evm.fun; the change applies from the next block (a removed key's reads/writes are refused)
- [x] Docs updated (t-137)
- [ ] Aaron's browser run of the checklist in packages/node/README.md
```

### Key/value contract and its views in evm.fun
- id: t-139
- parent: t-136
- tags: chains, web, views, size-M
- history:
  - Next @ 2026-11-23T15:00:21Z

```md
Demo steps e–f, the indexer demo. **From t-134:** `POST /chains/:id/submit` is capped at 64 KiB (`MAX_BODY_BYTES`, packages/node router) — raise it (~1 MiB) here, since a large contract deploy is ~100 KB of hex. A simple key/value contract that describes its own views (self-describing recipe), deployed and updated from evm.fun on a deployed chain, registered as an alias, and its JSON view (`/chains/:id/<alias>/latest`) shown in evm.fun under the alias's own access rules. Builds on t-135 views (`docs/spikes/cf-views.md`).
```

```dod
- [ ] Deploy and update the key/value contract from evm.fun; register its alias
- [ ] Its view shows the current keys/values; a key without access is refused, open reads make it a plain GET
- [ ] Docs updated (t-137)
```

### Node cursors: where each node is
- id: t-140
- parent: t-136
- tags: chains, cloudflare, web, size-S
- history:
  - Next @ 2026-11-23T15:00:21Z

```md
Finished by the devices work: `GET /chains/:id/nodes` replaces `/nodes/latest`. Design: [devices on a deployed chain](../superpowers/specs/2026-11-23-devices-follow-design.md) (A: follow and show). Demo step g. The cloud node records the block it last delivered to each device key and serves `GET /chains/:id/nodes/latest`; evm.fun shows a Nodes panel ("phone: block 412, 6 behind, 2 min ago"). Show only, for now. Design: [node cursors](../superpowers/specs/2026-11-23-node-cursors-design.md). Needs t-132.

Part 1 done (worker + Follower): `GET /chains/:id/nodes` serves each member's block, behind and last seen. Part 2 built: the Devices panel shows each member's name, role, block, behind and last seen. Left: Aaron's run with two real browsers (first DoD item).
```

```dod
- [ ] Two device keys following a deployed chain show their blocks and last-seen times in the view and the panel
- [x] A device that stops fetching falls behind as the chain advances; a key without read access gets 403 (worker side, `make e2e-node`)
- [x] Docs updated (t-137)
```

### Demo walkthrough: deploy, permission, publish, observe
- id: t-141
- parent: t-136
- tags: chains, walkthroughs, size-S
- history:
  - Next @ 2026-11-23T15:00:21Z

```md
The end-to-end demo as a guided run: (a) `make dev-services`, (b) the root chain, (c) issue a code (single or multi-use, TTL) and deploy chains with it, (d) add/remove a device, (e) deploy/update the key/value contract, (f) see its published values per the access list, (g) see each node's cursor. Steps a–b are commands; c–g run in evm.fun.

Its walkthrough is tagged `deployment`, `access`, `cloud` (Get started filter, t-146).
```

```dod
- [ ] A walkthrough (or scripted checklist) runs a–g against the local worker
- [ ] Docs (t-137): the demo, start to finish
```

### Permissioned chains (ad-hoc, gas-free)
- id: t-112
- tags: outcome, chains, size-L
- history:
  - Next @ 2026-11-22T17:12:28Z

```md
Anyone can create an ad-hoc chain they own: in the browser, or on our Cloudflare worker with a deploy code (t-134). Options: **gas-free** (no ETH needed to transact) and **owner-controlled deploys** (only allowed addresses may deploy contracts). Later a chain is a cluster whose nodes run on several devices (phone, laptop, Cloudflare Worker).

**Seam:** a chain is `ChainHandle` + a **chain policy** (owner, gas mode, allowed deployers) held in chain state, so every node enforces the same rules. Workstreams above never care where the nodes run.
```

```dod
- [ ] Create a chain as its owner, gas-free or not
- [ ] Only allowed addresses can deploy; the owner manages the list
- [ ] Policy survives snapshots, forks and workspace files
```

### Gas-free chains
- id: t-116
- parent: t-112
- tags: chains, size-S
- history:
  - Next @ 2026-11-22T17:12:28Z

```md
A chain option where transactions cost nothing (zero gas price, no prefund needed). Done when a fresh account with 0 ETH can transact on a gas-free chain, on both approaches.

Proven in the CF spike: base fee 0, a 0-ETH key transacts ([docs/spikes/cf-access.md](../spikes/cf-access.md)). Still to do on the playground's approaches.
```

### Owner-controlled deploy allow-list
- id: t-117
- parent: t-112
- tags: chains, size-M
- history:
  - Next @ 2026-11-22T17:12:28Z

```md
Contract creation is refused unless the sender is on the chain's deployer list (held in chain state, enforced at admission on approaches 01 and 02). Done when a non-listed account's deploy is refused with a clear error and a listed one succeeds.

Superseded by t-152 (ADR-0025): there is no deployer list in chain state; the deploy role is checked on the submitter.
```

### Chain owner admin view
- id: t-118
- parent: t-112
- tags: chains, web, size-S
- history:
  - Next @ 2026-11-22T17:12:28Z

```md
The owner sees and edits the chain's policy: gas mode, deployers. Done when the owner can add/remove a deployer from the Chains page and the change applies immediately.

See t-152 (ADR-0025): no deployer list; the deploy role is checked on the submitter, and the Devices panel grants and removes it.
```

## Doing

### Deploy role: read, write and deploy
- id: t-152
- parent: t-151
- tags: chains, access, size-S
- history:
  - Backlog @ 2026-11-24T20:43:30Z
  - Doing @ 2026-11-24T21:39:34Z

```md
The chain ACL gains a third role: **deploy** = may create contracts (a tx with no `to`). Read = read chain data; write = submit txs; deploy = submit contract creations. `ChainAccess` gets `deployers()`/`canDeploy`, invites grant it (`GRANT_DEPLOY`), the worker refuses a creation tx from a submitter without it, the Follower refuses it locally, and the `ACL` interface reports it.
```

```dod
- [x] A writer without deploy is refused a contract creation (cloud and locally); with deploy it is mined
- [x] Invites and the Devices panel can grant deploy
- [x] ADR-0025 updated
- [x] Tests pass (packages/node 149, follower-chain 44, cloud-devices 14; web:build ok)
- [ ] Checked in a browser: invite as Writer shows "Can deploy contracts" (hidden for Reader); join and deploy a contract works; a writer invited without it sees the local refusal while a normal send works; the Devices table shows the deploy badge; Remove deploy drops the badge and the device still writes; three themes and phone width (actions cell wraps)
```

### Get started: filter walkthroughs by text and tag
- id: t-146
- parent: t-106
- tags: walkthroughs, web, size-S
- history:
  - Doing @ 2026-11-24T09:55:50Z

```md
The Get started page gets a text filter (title, summary, tag) and tag chips (several selected = all must match), with "Showing N of M" and Clear. Walkthroughs carry optional `tags` (validated: 1-8, at most 24 chars, no repeats); the bundled ones are tagged. Aaron, 2026-11-24.
```

```dod
- [x] Tests pass
- [ ] Checked in a browser (phone width, all three themes)
```

### Invite a device: wizard, optional single join link, QR
- id: t-145
- parent: t-112
- tags: chains, access, size-S
- history:
  - Backlog @ 2026-11-24T09:36:55Z
  - Doing @ 2026-11-24T09:36:55Z

```md
The Devices panel's invite form becomes a 2-step wizard: create an access code, then open the link on the other device, as a QR code, a link and (by default) a separate code. The owner can instead tick "Create a single join link (includes the code)", off by default and with a warning; the code is then in the link's fragment, which the Join form reads and removes from the address bar. Design: `docs/superpowers/specs/2026-11-24-invite-wizard-design.md`; risk R58. Done when (checklist run by Aaron, not yet) the wizard issues both kinds of invite, the QR scans on a phone, an unticked invite never puts the code in the link or QR, and the Join form prefills and strips the code. Aaron, 2026-11-24.

Built and tested (915 tests); not yet run in a browser. Left to check: both modes in all three themes, phone width, scanning the QR on a phone, back button after a coded link.
```

### Playground ChainHandle over a remote (Durable Object) chain
- id: t-132
- parent: t-136
- tags: chains, web, size-M
- history:
  - Backlog @ 2026-11-22T21:41:18Z
  - Next @ 2026-11-23T15:00:21Z
  - Doing @ 2026-11-24T17:17:13Z

```md
Design: [devices on a deployed chain](../superpowers/specs/2026-11-23-devices-follow-design.md) (A: follow and show). From t-128: a chain type whose handle submits to the DO and reads from a local replica, so existing pages work against it; run the replica in a real browser.

Demo (t-136): after Deploy (t-134), the browser chain follows the cloud node, so they form a 2-node cluster; needed for node cursors (t-140). Uses t-129's `ChainNode` for replay.

Part 1 done (worker + Follower): `Follower` in `packages/node` boots from `GET /state` and replays `GET /blocks` with root and hash checks. A (follow and show) done: Deploy converts the owner's copy to a read-only follower, earlier deploys convert on open, and followers are saved as pointers in workspace files (ADR-0024). B (follow and use) came next: submitting from the browser through the cloud node, so pages can write to a deployed chain (below).

B part 1 done (worker + Follower writes): per-tx submit answers, idempotent resends, a 512 KiB cap, a chain ACL on the submitting key, `FollowerStore` and `Follower.send`/`sync` with pending, conflicted and refused txs; proven by a two-device race in `make e2e-node` (ADR-0025, risks R59-R60). B part 2 done in code (plan 21, tested; not yet run in a browser): every page writes to a deployed chain through `Follower.send` and sees its result at once, online or offline. Pending txs are kept in IndexedDB and settle as confirmed, conflicted or refused. One writing tab per chain (Web Lock). A chain with a stored copy opens from it at once, without waiting on the network; offline (including a network that hangs until a timeout) it shows "Offline — last synced …". A chain deleted in the cloud refuses its pending txs and further sends. The Pending panel and an app-bar count show what is waiting. Followers with stored pending txs open at startup. A re-signed deploy shows conflicted ("Deployed at <cloud>, not <local>"). Spec: [follow and use](../superpowers/specs/2026-11-24-follow-and-use-design.md).

Browser checklist (Aaron; also in `.superpowers/sdd/2026-11-24-plan21-follow-and-use-web/task-3-report.md`):
1. `make dev-services`; two browsers or profiles ("phone", "tablet"), both joined as writers to one deployed chain.
2. Offline on both, send a transfer from a page on each. The page shows its result at once; the app bar shows "1 pending"; the Pending panel lists it; the status line says "Offline — last synced … 1 pending.".
3. Online again: within a sync interval both records are confirmed, the count goes, and each device sees the other's change.
4. Import the same key on both, spend one balance on each while offline, go online. One record ends conflicted: app bar "1 conflicted", panel "Here: success, 1 log · Cloud: reverted, 0 logs"; Dismiss clears both.
5. Send offline, reload the tab still offline: the chain opens from storage with the record pending; online, it settles.
6. A second tab on the same chain shows "Open in another tab: changes are made there." and refuses a send with that text.
7. Tab A writes offline, then close A: on B's next sync it takes the lock, A's pending records show in B's panel and settle online.
8. A device joined as a reader: a send is refused with "This device can only read <chain>." and the status line says the same.
9. A writer removed by the admin: its next send is refused ("… is not a writer on this chain"), then the device shows the reader message.
10. Pending panel, app-bar badges (incl. "open <chain> to send") and status line in the three themes and at 375 px: the table scrolls inside the panel, no page-level horizontal scroll.
11. New and Open warn about unsent changes on followers (R59).
12. Send offline on a follower, then Delete that chain (Chains list, and the status line's Delete): the confirm says "1 unsent changes on <chain> will be lost".
13. A hanging network: devtools Network throttling set to a custom profile with no response (or offline after the page loads), reload. The chain opens from storage at once, pages read and send, the status line shows "Offline — last synced … Changes are kept and sent when you're back." after the timeout (about 30 s), and the tx settles once the network is back.
14. Delete the cloud chain (admin) while a device has a pending tx: on its next sync the status says "This chain no longer exists", the record is refused ("chain deleted in the cloud …") and can be dismissed, and a send is refused.
```

```dod
- [x] A deployed chain in evm.fun submits to the cloud node and follows its blocks; existing pages work against it
  - A done: follows its blocks. B done in code: pages write through the cloud node (plan 21)
- [ ] Same state root as the cloud node after each block, in a real browser (checked in a browser)
  - Checked on every block in code and tests; the real-browser run is Aaron's checklist (packages/node/README.md)
- [x] Docs updated (t-137)
  - A: README, ADR-0024, R55, R57; B: ADR-0025, R59, R60, packages/node README
```

## Done

### Spike: SpacetimeDB as a deploy destination
- id: t-155
- parent: t-151
- tags: chains, spike, size-S
- history:
  - Backlog @ 2026-11-24T20:43:30Z
  - Done @ 2026-11-25T12:00:00Z

```md
Can a chain deploy to SpacetimeDB as well as Cloudflare? Find out whether revm can run inside a SpacetimeDB module (wasm) or whether SpacetimeDB only stores chain data with execution elsewhere; cost, limits, auth model, and how followers would sync. Throwaway, local only.

**Result (2026-11-25, branch `spike-spacetimedb` b427bb4, report `docs/spikes/stdb.md` there):** viable. revm runs in a reducer (TS module on revm-wasm 0.3.1, or Rust on revm 43); block hashes and state roots match `nodeOptions` over 83 blocks; a subscribed client gets blocks pushed and verifies them, no polling. webevm itself (async) can't run in a reducer, so `ChainNode` isn't reused as is. Access: EIP-191 checks work in a reducer; device identity linked to its address once, roles from `ChainAccess`; closed reads need private tables + views. ~5 ms/tx, ~20–29 ms per 25-tx block locally. **Decision (Aaron):** not built yet — finish the Cloudflare path (t-152…t-154), adopt the subscription model now (t-144), revisit after measuring per-database cost on a paid maincloud account. Found R61 (block hash doesn't commit to txs/state).
```

```dod
- [x] Spike report in `docs/spikes/` with a recommendation
```

### web: static deploy (GitHub Pages)
- id: t-16
- parent: t-108
- tags: web, infra
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Done @ 2026-11-23T11:35:25Z

```md
Publish the playground (Vite build, `base: './'`) to GitHub Pages from CI on every push to master. Done when the deployed site loads, runs a walkthrough, and compiles in Studio (solc worker and revm wasm served from the static path).

The workflow is in place (`.github/workflows/pages.yml`, retries Bun's exit crash, R11). Live at evm.fun after the PR #5–#7 merges (confirmed by Aaron, 2026-11-23).
```

### Cloudflare evm worker
- id: t-128
- history:
  - Doing @ 2026-11-22T20:12:04.505Z
  - Done @ 2026-11-22T21:41:18Z

```md
Spike. I'd like "my personal blockchain", where I can add devices I approve, i.e.:

1. laptop (i.e. via the evm playground/browser tab, or a bun app, etc)
2. add another device (phone, ipad, etc)
3. Have one Cloudflare Durable Object per ad-hoc chain

The terse POC would be:
Piece	Responsibility
Worker	Route /chains/:id to the corresponding Durable Object
Durable Object	Authorise requests, sequence transactions, own the canonical head
revm compiled to WASM	Execute transactions
Durable Object SQLite	Persist EVM state, blocks, receipts and membership
Device replica	Execute locally; push proposals and fetch accepted blocks


Durable Objects support WASM; building a working revm WASM module and storage adapter is the first technical spike, rather than something I’d assume already works unchanged.

[durable objects](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/?cf_page=deno-joins-cloudflare%2F&utm_source=chatgpt.com)

Minimal API:
create(genesis, accessPolicy) → chainId
submit(chainId, expectedHead, signedTransactions) → block
fetch(chainId, afterBlock) → blocks
subscribe(chainId) → updates

For each submission: verify authorisation → check expected head → execute → atomically persist state and block → notify devices. Explicitly serialise submissions across asynchronous work.


Related: We could have the chain access / allowance governed by an initial 'identity' or 'permission' contract where existing admin keys and signing thresholds can determine which nodes can contribute to the revm chain
```

```dod
Spike result (branch spike-cf-chain, commit 1c24e48, `bun spike/cf-chain/demo.ts` → ALL PASS, 26 checks; report [docs/spikes/cf-chain.md](../spikes/cf-chain.md)):
- [x] webevm + revm runs unchanged in a Durable Object under wrangler dev (bundle 2.5 MB / 711 KiB gz; cold request ~30 ms)
- [x] create / submit(expectedHead → 409 when stale) / fetch / hibernating WebSocket subscribe; submissions serialised
- [x] snapshot + block + receipts persisted in one SQLite transaction; a new DO instance continues at the same head
- [x] EIP-191 signed requests with single-use nonce; non-members 403, owner adds/removes devices
- [x] device replicas (Bun) replay accepted blocks: same state root and block hash every block; fresh replay of 24 blocks matches in 45 ms
- [ ] replica in a real browser (bundles, not run); playground ChainHandle over the remote chain (not attempted)
Findings: snapshot holds full history (~2.8 KB per small block, rewritten every block); block/genesis timestamp is the only nondeterminism and is pinned via a webevm internal.
```

## Archive <!-- archive -->

### Signed orders and off-chain matching
- id: t-65
- history:
  - To Do @ 2026-11-20T08:48:16.886Z
  - Done @ 2026-11-22T11:10:41Z
  - Archive @ 2026-11-22T11:12:24.319Z

```md
Folded into t-64 (ADR-0018): the off-chain venue builds signed orders and off-chain matching on one chain. What remains (a book spanning two chains) is t-66.

This is the hybrid model. It’s required for step 7, because a single contract can’t hold a book that spans two chains.
```

### Cross-chain swap (HTLC)
- id: t-62
- tags: web, htlc
- history:
  - To Do @ 2026-11-20T08:47:27.136Z
  - Doing @ 2026-11-21T20:46:44Z
  - Done @ 2026-11-22T10:34:06Z
  - Archive @ 2026-11-22T11:12:24.319Z

```md
The same offer, but GBP on dave and USD on sue, using your AtomicSwap.sol:

the maker locks GBP under a hash;
the taker locks USD under the same hash;
the maker claims the USD, which reveals the secret;
the taker uses the secret to claim the GBP.

Two new playground pieces are needed:

A watcher. Something has to see events on one chain and act on the other. In the playground, the UI can play both parties.
A way to make blocks pass. Timeouts are measured in blocks, and a plain chain only makes blocks when there are transactions. You’d need an “advance N blocks” control to test refunds.

This gives you cross-chain settlement early and with little machinery. Done when both the claim path and the refund path work and each produces a report.

Built as ADR-0021: HashLock.sol, `@evmb/htlc`, the /xswap page and three walkthroughs (claim, refund, unsafe). Spec: docs/superpowers/specs/2026-11-22-cross-chain-swap-design.md.
```

### Top app bar, profile menu and workspace files (File: New / Open / Save)
- id: t-92
- tags: web
- history:
  - Doing @ 2026-11-21T18:27:03Z
  - Done @ 2026-11-21T19:45:51Z
  - Archive @ 2026-11-22T11:12:24.319Z

```md
ADR-0020. One permanent top bar (File menu, breadcrumb, page actions, chain picker, profile menu); a workspace file holds every account, chain, snapshot, record, walkthrough and order-book row. Spec: docs/superpowers/specs/2026-11-21-workspace-appbar-design.md.
```

### Links and fix-it actions
- id: t-90
- tags: web, walkthrough
- history:
  - Done @ 2026-11-21T13:52:32Z
  - Archive @ 2026-11-22T11:12:24.319Z

```md
Spec: docs/superpowers/specs/2026-11-21-links-and-fixes-design.md (plan 12). Every page carries ?chain=&as= (synced both ways); balance shortfalls on Swap, Trade and Pool offer "Request {amount} {SYM} from {issuer}" (Send as the issuer, prefilled, then back with a notice); a send the account can't pay fees for offers "Request {amount} ETH from {account}" (the richest other local account) wherever the error shows; the walkthrough ribbon shows the same fix under a step's error. Web README: "Links and fix-it actions".
```

### Liquidity pool (Uniswap v2-style, x·y = k)
- id: t-63
- history:
  - To Do @ 2026-11-20T08:47:49.803Z
  - Doing @ 2026-11-21T10:08:25Z
  - Done @ 2026-11-21T12:32:06Z
  - Archive @ 2026-11-22T11:12:24.319Z

```md
ADR-0019. Taken next, before t-62. Spec: docs/superpowers/specs/2026-11-21-pool-design.md.

Create a GBP/USD pool, add and remove liquidity, and swap with a quote and a slippage limit. It’s self-contained, with no matching and no counterparty online, and it gives every later step a reference price. I’d write a minimal pool yourself (about a page of Solidity) rather than vendoring Uniswap’s code. That’s easier to read in a playground and avoids licence questions. Benchmark scenario: amm-swap.
```

### Order book: on-chain and off-chain venues, single chain
- id: t-64
- history:
  - To Do @ 2026-11-20T08:47:58.873Z
  - Doing @ 2026-11-20T17:21:04Z
  - Done @ 2026-11-20T20:08:20Z
  - Archive @ 2026-11-22T11:12:24.319Z

```md
ADR-0018 (moved ahead of t-62/t-63; includes t-65's signed orders and off-chain matching). Spec: docs/superpowers/specs/2026-11-20-orderbook-design.md. Two venues behind one Venue API with a header switch.

Limit orders rest in a contract, a taker’s transaction matches them, and settlement is atomic within that transaction. This is the Trade screen we designed, minus the settlement choices. It reuses step 2’s report and step 4’s pool price as a reference. Benchmark scenarios: book-match, plus book versus pool on the same trade.
```

### Walkthroughs: auto-advance (?auto=5s)
- id: t-81
- tags: walkthrough, web
- history:
  - Done @ 2026-11-20T16:54:00Z
  - Archive @ 2026-11-22T11:12:24.319Z

```md
ADR-0017. `?auto=5s` makes the ribbon's Next press itself after a delay, shown as a ring draining around the button, with a pause/resume countdown. Waits while busy or behind a dialog; typing restarts it; stops on error or at the end.
```

### Walkthroughs: wizard ribbon and Get started
- id: t-76
- tags: walkthrough, web
- history:
  - Doing @ 2026-11-20T15:00:00Z
  - Done @ 2026-11-20T16:32:38Z
  - Archive @ 2026-11-22T11:12:24.319Z

```md
ADR-0017. A walkthrough is a JSON file (keys with initial values, steps, checks) run headless by bun test and in the app by a wizard ribbon that fills and presses the real pages, with focus mode. Bundled: gbp-usd and take-without-approval. Spec: docs/superpowers/specs/2026-11-20-walkthroughs-design.md.
```

### web: one chain switcher in the sidebar
- id: t-75
- tags: web
- history:
  - Done @ 2026-11-20T14:00:00Z
  - Archive @ 2026-11-22T11:12:24.319Z

```md
The Active context card (and the phone strip) picks chain and account on every page, Studio included. Assets and Swap lose their own pickers; switching drops chain-specific URL detail and is disabled while Swap has a tx in flight.
```

### Swap: store the cancel block
- id: t-73
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T12:39:29Z
  - Done @ 2026-11-20T13:06:16Z
  - Archive @ 2026-11-22T11:12:24.319Z

```md
ADR-0016, R21: cancel records its block in the offer so takeReport reads it directly instead of scanning logs from block 0 for cancelled offers.
```

### Same-chain swap (one offer, settled atomically).
- id: t-61
- history:
  - To Do @ 2026-11-20T08:47:16.453Z
  - Doing @ 2026-11-20T08:48:52.373Z
  - Done @ 2026-11-20T12:39:29Z
  - Archive @ 2026-11-22T11:12:24.319Z

```md
A small Swap.sol:

the maker creates an offer, “sell 1,000 GBP for 1,270 USD”, and their GBP is held in escrow by the contract;
the taker fills it, and both legs move in one transaction;
the maker can cancel.

This is the smallest possible “trade”. It also introduces the execution report for successes and failures, for example a failure from a missing allowance. Benchmark scenario: offer-fill.
```

### assets: README, ADR, risks, browser checklist
- id: t-60
- owner: Claude
- tags: web, plan7
- history:
  - To Do @ 2026-11-19T22:03:42Z
  - Doing @ 2026-11-19T23:57:45Z by Claude
  - Done @ 2026-11-19T23:58:19Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### assets: allowances, import token, launch asset
- id: t-59
- owner: Claude
- tags: web, plan7
- history:
  - To Do @ 2026-11-19T22:03:42Z
  - Doing @ 2026-11-19T22:43:41Z by Claude
  - Done @ 2026-11-19T22:46:30Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### assets: Assets page list, header, balances, Send
- id: t-58
- owner: Claude
- tags: web, plan7
- history:
  - To Do @ 2026-11-19T22:03:42Z
  - Doing @ 2026-11-19T22:36:00Z by Claude
  - Done @ 2026-11-19T22:37:28Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### assets: travel with snapshots, forks and files
- id: t-57
- owner: Claude
- tags: web, plan7
- history:
  - To Do @ 2026-11-19T22:03:42Z
  - Doing @ 2026-11-19T22:22:54Z by Claude
  - Done @ 2026-11-19T22:25:39Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### assets: live reads (token info, balances, allowances)
- id: t-56
- owner: Claude
- tags: web, plan7
- history:
  - To Do @ 2026-11-19T22:03:42Z
  - Doing @ 2026-11-19T22:16:45Z by Claude
  - Done @ 2026-11-19T22:17:57Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### assets: package registry, identity, detection, calldata
- id: t-55
- owner: Claude
- tags: web, plan7
- history:
  - To Do @ 2026-11-19T22:03:42Z
  - Doing @ 2026-11-19T22:11:07Z by Claude
  - Done @ 2026-11-19T22:15:18Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### assets: AssetToken contract
- id: t-54
- owner: Claude
- tags: web, plan7
- history:
  - To Do @ 2026-11-19T22:03:42Z
  - Doing @ 2026-11-19T22:08:38Z by Claude
  - Done @ 2026-11-19T22:09:24Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### snapshots: README, ADR and the browser checklist
- id: t-53
- owner: Claude
- tags: web, plan6
- history:
  - To Do @ 2026-11-19T18:21:54Z
  - Doing @ 2026-11-19T19:00:00Z by Claude
  - Done @ 2026-11-19T19:01:07Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### snapshots: snapshot, restore, import and export UI
- id: t-52
- owner: Claude
- tags: web, plan6
- history:
  - To Do @ 2026-11-19T18:21:54Z
  - Doing @ 2026-11-19T18:46:56Z by Claude
  - Done @ 2026-11-19T18:55:14Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### snapshots: snapshot store and registry createFrom / restoreTo
- id: t-51
- owner: Claude
- tags: web, plan6
- history:
  - To Do @ 2026-11-19T18:21:54Z
  - Doing @ 2026-11-19T18:40:06Z by Claude
  - Done @ 2026-11-19T18:41:38Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### snapshots: chain file format (pure)
- id: t-50
- owner: Claude
- tags: web, plan6
- history:
  - To Do @ 2026-11-19T18:21:54Z
  - Doing @ 2026-11-19T18:33:54Z by Claude
  - Done @ 2026-11-19T18:34:46Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### snapshots: approach snapshot/restore and setup from a dump
- id: t-49
- owner: Claude
- tags: web, plan6
- history:
  - To Do @ 2026-11-19T18:21:54Z
  - Doing @ 2026-11-19T18:26:47Z by Claude
  - Done @ 2026-11-19T18:29:09Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### snapshots: spike: webevm dump/load fidelity
- id: t-48
- owner: Claude
- tags: web, plan6
- history:
  - To Do @ 2026-11-19T18:21:54Z
  - Doing @ 2026-11-19T18:22:01Z by Claude
  - Done @ 2026-11-19T18:24:49Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: Timeline spreads clustered blocks
- id: t-47
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T17:55:00Z
  - Doing @ 2026-11-19T17:55:30Z by Claude
  - Done @ 2026-11-19T17:57:00Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: view toggle in viewer header
- id: t-46
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T17:45:00Z
  - Doing @ 2026-11-19T17:45:30Z by Claude
  - Done @ 2026-11-19T17:53:30Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: Fisheye matches mockup
- id: t-45
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T17:37:08Z
  - Doing @ 2026-11-19T17:37:08Z by Claude
  - Done @ 2026-11-19T17:41:25Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: explorer phone-width and browser check
- id: t-44
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T17:18:38Z by Claude
  - Done @ 2026-11-19T17:22:11Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: explorer fisheye view
- id: t-43
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T17:16:31Z by Claude
  - Done @ 2026-11-19T17:17:14Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: explorer timeline view
- id: t-42
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T17:10:51Z by Claude
  - Done @ 2026-11-19T17:11:26Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: explorer chain view
- id: t-41
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T17:01:11Z by Claude
  - Done @ 2026-11-19T17:02:00Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: explorer table view, filter and block panel
- id: t-40
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T16:53:48Z by Claude
  - Done @ 2026-11-19T16:57:28Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: combined Chains page and /chains routes
- id: t-39
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T16:44:28Z by Claude
  - Done @ 2026-11-19T16:47:15Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: app bar with per-page actions and breadcrumbs
- id: t-38
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T16:41:07Z by Claude
  - Done @ 2026-11-19T16:42:36Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: latency distribution chart
- id: t-36
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T16:20:05Z
  - Doing @ 2026-11-19T16:20:05Z by Claude
  - Done @ 2026-11-19T16:23:11Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: allowlist empty, smoke check, docs
- id: t-35
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T16:09:05Z by Claude
  - Done @ 2026-11-19T16:09:50Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: Benchmark restyle
- id: t-34
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T16:04:00Z by Claude
  - Done @ 2026-11-19T16:05:57Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: Explorer restyle
- id: t-33
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T16:01:00Z by Claude
  - Done @ 2026-11-19T16:02:17Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: Transact restyle
- id: t-32
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T15:40:53Z by Claude
  - Done @ 2026-11-19T15:57:03Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: Studio restyle
- id: t-31
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T15:36:00Z by Claude
  - Done @ 2026-11-19T15:39:25Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: Accounts and Chains restyle
- id: t-30
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T15:31:21Z by Claude
  - Done @ 2026-11-19T15:34:51Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: UI primitives, icons, app shell
- id: t-29
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T15:26:35Z by Claude
  - Done @ 2026-11-19T15:29:35Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: tokens, themes, theme store, guard tests
- id: t-28
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T15:23:22Z by Claude
  - Done @ 2026-11-19T15:23:24Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: browser smoke test and docs
- id: t-27
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T14:34:05Z by Claude
  - Done @ 2026-11-19T14:34:06Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: in-browser Benchmark
- id: t-15
- owner: Claude
- tags: web
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T13:40:22Z by Claude
  - Done @ 2026-11-19T13:40:22Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: Benchmark page
- id: t-26
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T13:40:22Z by Claude
  - Done @ 2026-11-19T13:40:22Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: Explorer page
- id: t-25
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T13:20:24Z by Claude
  - Done @ 2026-11-19T13:26:59Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: Transact page
- id: t-24
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T13:16:12Z by Claude
  - Done @ 2026-11-19T13:17:32Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: solc worker and Studio
- id: t-23
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T13:11:10Z by Claude
  - Done @ 2026-11-19T13:11:12Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: Studio (solc-js compile, deploy, call)
- id: t-14
- owner: Claude
- tags: web
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T13:11:10Z by Claude
  - Done @ 2026-11-19T13:11:12Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: chains and accounts pages
- id: t-22
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T13:01:32Z by Claude
  - Done @ 2026-11-19T13:01:34Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### web: scaffold and stores
- id: t-21
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T12:42:18Z by Claude
  - Done @ 2026-11-19T12:47:18Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### Playground core and approach extensions
- id: t-20
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T12:35:51Z by Claude
  - Done @ 2026-11-19T12:37:23Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### Playground spike: persistence and revm
- id: t-19
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T12:34:25Z by Claude
  - Done @ 2026-11-19T12:34:25Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### cli: report command generating REPORT.md
- id: t-13
- owner: Claude
- tags: cli, report
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T11:15:34Z by Claude
  - Done @ 2026-11-19T11:24:34Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### Approach 02: seq-memory
- id: t-08
- owner: Claude
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T10:41:43Z by Claude
  - Done @ 2026-11-19T11:15:34Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

```md
Parallel sig pre-verify, single-writer sequencer, ring buffer, batched blocks, no state root, in-memory log.
```

### cli: bench command writing results JSON
- id: t-06
- owner: Claude
- tags: cli
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T10:30:28Z by Claude
  - Done @ 2026-11-19T10:41:43Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### core: Approach interface, trade-off schema, metrics
- id: t-04
- owner: Claude
- tags: core
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T10:04:27Z by Claude
  - Done @ 2026-11-19T10:30:28Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### core: five scenarios (generator + verifier each)
- id: t-05
- owner: Claude
- tags: core
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T10:17:10Z by Claude
  - Done @ 2026-11-19T10:21:13Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

```md
eth-transfer, erc20-disjoint, erc20-hot, erc20-mint, atomic-swap
```

### Approach 01: webevm-baseline
- id: t-07
- owner: Claude
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T10:04:27Z by Claude
  - Done @ 2026-11-19T10:17:10Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### contracts: MintableToken + AtomicSwap compiled with solc-js
- id: t-03
- owner: Claude
- tags: contracts
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T09:59:31Z by Claude
  - Done @ 2026-11-19T10:04:27Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

### Design evm-benchmarks
- id: t-00
- owner: Claude
- tags: design
- history:
  - Doing @ 2026-11-19T08:30:00Z by Claude
  - Done @ 2026-11-19T09:38:00Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

```md
evm-benchmarks/docs/superpowers/specs/2026-11-19-evm-benchmarks-design.md
```

### Spike: confirm webevm trusted sender, manual mining, revm
- id: t-01
- owner: Claude
- tags: spike, engine
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T09:50:45Z by Claude
  - Done @ 2026-11-19T09:59:31Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude

```md
Confirm the features approaches 02-05 rely on. Record outcome in ADR "Which EVM engine backs the sequencer" and risk R01.
```

### Scaffold evm-benchmarks Bun workspace
- id: t-02
- owner: Claude
- tags: infra
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T09:50:45Z by Claude
  - Done @ 2026-11-19T09:59:31Z by Claude
  - Archive @ 2026-11-22T11:12:24.319Z by Claude
