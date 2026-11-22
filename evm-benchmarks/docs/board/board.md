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

### Add Governance.sol
- id: t-110
- history:
  - Backlog @ 2026-11-22T11:44:29.041Z
  - Next @ 2026-11-22T11:44:43.189Z
  - Backlog @ 2026-11-22T11:44:47.610Z

```md
We have a Governancel.sol in another project which white-lists (allow-lists) addresses, and can be added to an e.g. ERC20 which checks it with 'canTransfer'. This lets us onboard (KYC) people in some process, so we know who holds what addresses.

We'll want to show this on one chain, in the Uniswap example too (we'd have to ensure KYC's addresses are taken into account in the liquidity pool), and also cover our cross-chain transfers
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

### Cross-chain order book
- id: t-66
- tags: outcome, markets
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

### web: static deploy (GitHub Pages)
- id: t-16
- parent: t-108
- tags: web, infra
- history:
  - To Do @ 2026-11-19T09:38:00Z

```md
Publish the playground (Vite build, `base: './'`) to GitHub Pages from CI on every push to master. Done when the deployed site loads, runs a walkthrough, and compiles in Studio (solc worker and revm wasm served from the static path).
```

## Next

### Marketplace app: Launch Site
- id: t-104
- tags: outcome, marketplace
- history:
  - To Do @ 2026-11-22T11:40:00Z
  - Next @ 2026-11-22T11:50:41Z

```md
A friendly app on top of the playground for issuers and traders. "Launch Site" takes a name (advanced: on its own chain or an existing one). The owner uploads inventory as digital assets (e.g. "chairs", 10 for the shop owner) and can launch currencies (a stablecoin is just a currency asset). Buyers pay a price in a currency, or swap another asset ("2 hours sweeping for 1 chair"). Underneath: assets, balances and an order book or swap, on chain. Examples to model: a flight booker, an Airbnb or eBay clone, a local coin.
```

```dod
- [ ] Launch Site with only a name
- [ ] Upload inventory as assets; launch a currency
- [ ] List items for a currency price or for a swap; a buyer completes a purchase
- [ ] Issuer and trader personas; calls the trading packages directly (the client API, t-103, is on hold)
```

## Doing

## Done

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
