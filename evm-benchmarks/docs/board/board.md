---
version: 1
theme: ledger
---
# evm.fun

## To Do

### Cross-chain swap (HTLC)
- id: t-62
- history:
  - To Do @ 2026-11-20T08:47:27.136Z

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
```

### Liquidity pool (Uniswap v2-style, x·y = k)
- id: t-63
- history:
  - To Do @ 2026-11-20T08:47:49.803Z

```md
Create a GBP/USD pool, add and remove liquidity, and swap with a quote and a slippage limit. It’s self-contained, with no matching and no counterparty online, and it gives every later step a reference price. I’d write a minimal pool yourself (about a page of Solidity) rather than vendoring Uniswap’s code. That’s easier to read in a playground and avoids licence questions. Benchmark scenario: amm-swap.
```

### Signed orders and off-chain matching
- id: t-65
- history:
  - To Do @ 2026-11-20T08:48:16.886Z

```md
Folded into t-64 (ADR-0018): the off-chain venue builds signed orders and off-chain matching on one chain. What remains for step 7 is a book spanning two chains.

This is the hybrid model. It’s required for step 7, because a single contract can’t hold a book that spans two chains.
```

### Cross-chain order book
- id: t-66
- history:
  - To Do @ 2026-11-20T08:48:39.324Z

```md
Off-chain matching (step 6) with HTLC settlement (step 3): matched pairs whose legs are on different chains settle by hash-lock.

Later: netting, auctions, the vault, and the full market wizard. By then each is an option added to pieces that already work.

Why this order: steps 2 and 3 are the same feature, first on one chain and then across two. That gets you cross-chain settlement by step 3 without first building an order book. The pool is independent, so you could swap it with step 5 if order books matter more to you.
```

### Approach 03: seq-stateroot
- id: t-09
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

```md
Per-block and deferred state root. Closes ADR "State root per block, deferred, or none".
```

### Approach 04: seq-durable
- id: t-10
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

```md
Append-only replayable log: file (Bun), IndexedDB (browser).
```

### Approach 05: seq-revm
- id: t-11
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

### Approach 06: rpc (anvil / Besu)
- id: t-12
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

### web: static deploy (GitHub Pages)
- id: t-16
- tags: web, infra
- history:
  - To Do @ 2026-11-19T09:38:00Z

### Later: parallel execution approaches
- id: t-17
- tags: approach, later
- history:
  - To Do @ 2026-11-19T09:38:00Z

### Later: native-erc20 approach (evm: false)
- id: t-18
- tags: approach, later
- history:
  - To Do @ 2026-11-19T09:38:00Z

### Swap: index offers when the book gets large
- id: t-67
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T09:28:19Z

```md
ADR-0016 reads every offer ever made (offers(1..nextId-1)). When a chain's history makes the Swap page slow, add an incremental indexer keyed by block (ADR-0016 solution C/B upgrade path) without changing Swap.sol.
```

### Swap: exact revert reasons for same-block failures
- id: t-68
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T09:28:19Z

```md
ADR-0016: non-status failures are replayed with eth_call at the parent block, so an approve or transfer earlier in the same block is missed. Replay with the block's preceding txs applied (or trace the tx) to report the true reason.
```

### Walkthroughs: more step types (transfer, cancel, snapshot, fork)
- id: t-77
- tags: walkthrough, backlog
- history:
  - To Do @ 2026-11-20T15:00:00Z

```md
ADR-0017: the first slice has only the steps the two bundled walkthroughs use. Add transfer, cancel, and snapshot / fork / restore so long scenarios can branch from a saved state.
```

### Walkthroughs: run on an existing chain
- id: t-78
- tags: walkthrough, backlog
- history:
  - To Do @ 2026-11-20T15:00:00Z

```md
ADR-0017: each run creates a fresh chain because chains only prefund at creation. Allow choosing an existing chain, funding traders' gas from a funded account.
```

### Walkthroughs: ribbon robustness (switch errors, concurrent rendering)
- id: t-79
- tags: walkthrough, web, backlog
- history:
  - To Do @ 2026-11-20T16:32:38Z

```md
ADR-0017, R23, R24: surface selectChain failures in the ribbon instead of waiting 5 s for the generic message, and move the render-time writes in useWizardField / useWizardAction into effects (or useSyncExternalStore) so they hold under concurrent rendering.
```

### Walkthroughs: DOM test harness for the ribbon
- id: t-80
- tags: walkthrough, web, backlog
- history:
  - To Do @ 2026-11-20T16:32:38Z

```md
ADR-0017, R25: add a DOM harness so ribbon effects, Next's chain/account switch wait and field refill are tested, not only checked in the browser.
```

### Swap: Activity without a block scan
- id: t-69
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T09:28:19Z

```md
ADR-0016: reverted takes are found by scanning every block for txs to the Swap with status 0. Index failed attempts (or the explorer's tx index) so Activity's cost doesn't grow with chain length.
```

### Swap: native ETH in offers
- id: t-70
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T09:28:19Z

```md
ADR-0016: step 2 is ERC-20 only because ETH can't be escrowed with transferFrom. Add a payable make/take path or wrap to WETH.
```

### Swap: named markets ("New market")
- id: t-71
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T09:28:19Z

```md
ADR-0016: a market is any (base, quote) pair of the chain's assets. The mockup's "New market" screen (named pairs, defaults, tick size) is deferred; revisit with the order book (t-64).
```

### Swap: per-maker on-chain offer index
- id: t-72
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T12:39:29Z

```md
ADR-0016, R20: makeOffer records offer ids per maker so "your offers" reads the maker's ids in O(1) instead of filtering every offer.
```

### Swap: fee-on-transfer and rebasing tokens
- id: t-74
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T12:39:29Z

```md
ADR-0016, R22: measure the balance delta on deposit, or refuse such tokens, so escrow can't be left short.
```

## Doing

### Order book: on-chain and off-chain venues, single chain
- id: t-64
- history:
  - To Do @ 2026-11-20T08:47:58.873Z
  - Doing @ 2026-11-20T17:21:04Z

```md
ADR-0018 (moved ahead of t-62/t-63; includes t-65's signed orders and off-chain matching). Spec: docs/superpowers/specs/2026-11-20-orderbook-design.md. Two venues behind one Venue API with a header switch.

Limit orders rest in a contract, a taker’s transaction matches them, and settlement is atomic within that transaction. This is the Trade screen we designed, minus the settlement choices. It reuses step 2’s report and step 4’s pool price as a reference. Benchmark scenarios: book-match, plus book versus pool on the same trade.
```

## Done

### Walkthroughs: auto-advance (?auto=5s)
- id: t-81
- tags: walkthrough, web
- history:
  - Done @ 2026-11-20T16:54:00Z

```md
ADR-0017. `?auto=5s` makes the ribbon's Next press itself after a delay, shown as a ring draining around the button, with a pause/resume countdown. Waits while busy or behind a dialog; typing restarts it; stops on error or at the end.
```

### Walkthroughs: wizard ribbon and Get started
- id: t-76
- tags: walkthrough, web
- history:
  - Doing @ 2026-11-20T15:00:00Z
  - Done @ 2026-11-20T16:32:38Z

```md
ADR-0017. A walkthrough is a JSON file (keys with initial values, steps, checks) run headless by bun test and in the app by a wizard ribbon that fills and presses the real pages, with focus mode. Bundled: gbp-usd and take-without-approval. Spec: docs/superpowers/specs/2026-11-20-walkthroughs-design.md.
```

### web: one chain switcher in the sidebar
- id: t-75
- tags: web
- history:
  - Done @ 2026-11-20T14:00:00Z

```md
The Active context card (and the phone strip) picks chain and account on every page, Studio included. Assets and Swap lose their own pickers; switching drops chain-specific URL detail and is disabled while Swap has a tx in flight.
```

### Swap: store the cancel block
- id: t-73
- tags: swap, backlog
- history:
  - To Do @ 2026-11-20T12:39:29Z
  - Done @ 2026-11-20T13:06:16Z

```md
ADR-0016, R21: cancel records its block in the offer so takeReport reads it directly instead of scanning logs from block 0 for cancelled offers.
```

### Same-chain swap (one offer, settled atomically).
- id: t-61
- history:
  - To Do @ 2026-11-20T08:47:16.453Z
  - Doing @ 2026-11-20T08:48:52.373Z
  - Done @ 2026-11-20T12:39:29Z

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

### assets: allowances, import token, launch asset
- id: t-59
- owner: Claude
- tags: web, plan7
- history:
  - To Do @ 2026-11-19T22:03:42Z
  - Doing @ 2026-11-19T22:43:41Z by Claude
  - Done @ 2026-11-19T22:46:30Z by Claude

### assets: Assets page list, header, balances, Send
- id: t-58
- owner: Claude
- tags: web, plan7
- history:
  - To Do @ 2026-11-19T22:03:42Z
  - Doing @ 2026-11-19T22:36:00Z by Claude
  - Done @ 2026-11-19T22:37:28Z by Claude

### assets: travel with snapshots, forks and files
- id: t-57
- owner: Claude
- tags: web, plan7
- history:
  - To Do @ 2026-11-19T22:03:42Z
  - Doing @ 2026-11-19T22:22:54Z by Claude
  - Done @ 2026-11-19T22:25:39Z by Claude

### assets: live reads (token info, balances, allowances)
- id: t-56
- owner: Claude
- tags: web, plan7
- history:
  - To Do @ 2026-11-19T22:03:42Z
  - Doing @ 2026-11-19T22:16:45Z by Claude
  - Done @ 2026-11-19T22:17:57Z by Claude

### assets: package registry, identity, detection, calldata
- id: t-55
- owner: Claude
- tags: web, plan7
- history:
  - To Do @ 2026-11-19T22:03:42Z
  - Doing @ 2026-11-19T22:11:07Z by Claude
  - Done @ 2026-11-19T22:15:18Z by Claude

### assets: AssetToken contract
- id: t-54
- owner: Claude
- tags: web, plan7
- history:
  - To Do @ 2026-11-19T22:03:42Z
  - Doing @ 2026-11-19T22:08:38Z by Claude
  - Done @ 2026-11-19T22:09:24Z by Claude

### snapshots: README, ADR and the browser checklist
- id: t-53
- owner: Claude
- tags: web, plan6
- history:
  - To Do @ 2026-11-19T18:21:54Z
  - Doing @ 2026-11-19T19:00:00Z by Claude
  - Done @ 2026-11-19T19:01:07Z by Claude

### snapshots: snapshot, restore, import and export UI
- id: t-52
- owner: Claude
- tags: web, plan6
- history:
  - To Do @ 2026-11-19T18:21:54Z
  - Doing @ 2026-11-19T18:46:56Z by Claude
  - Done @ 2026-11-19T18:55:14Z by Claude

### snapshots: snapshot store and registry createFrom / restoreTo
- id: t-51
- owner: Claude
- tags: web, plan6
- history:
  - To Do @ 2026-11-19T18:21:54Z
  - Doing @ 2026-11-19T18:40:06Z by Claude
  - Done @ 2026-11-19T18:41:38Z by Claude

### snapshots: chain file format (pure)
- id: t-50
- owner: Claude
- tags: web, plan6
- history:
  - To Do @ 2026-11-19T18:21:54Z
  - Doing @ 2026-11-19T18:33:54Z by Claude
  - Done @ 2026-11-19T18:34:46Z by Claude

### snapshots: approach snapshot/restore and setup from a dump
- id: t-49
- owner: Claude
- tags: web, plan6
- history:
  - To Do @ 2026-11-19T18:21:54Z
  - Doing @ 2026-11-19T18:26:47Z by Claude
  - Done @ 2026-11-19T18:29:09Z by Claude

### snapshots: spike: webevm dump/load fidelity
- id: t-48
- owner: Claude
- tags: web, plan6
- history:
  - To Do @ 2026-11-19T18:21:54Z
  - Doing @ 2026-11-19T18:22:01Z by Claude
  - Done @ 2026-11-19T18:24:49Z by Claude

### web: Timeline spreads clustered blocks
- id: t-47
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T17:55:00Z
  - Doing @ 2026-11-19T17:55:30Z by Claude
  - Done @ 2026-11-19T17:57:00Z by Claude

### web: view toggle in viewer header
- id: t-46
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T17:45:00Z
  - Doing @ 2026-11-19T17:45:30Z by Claude
  - Done @ 2026-11-19T17:53:30Z by Claude

### web: Fisheye matches mockup
- id: t-45
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T17:37:08Z
  - Doing @ 2026-11-19T17:37:08Z by Claude
  - Done @ 2026-11-19T17:41:25Z by Claude

### web: explorer phone-width and browser check
- id: t-44
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T17:18:38Z by Claude
  - Done @ 2026-11-19T17:22:11Z by Claude

### web: explorer fisheye view
- id: t-43
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T17:16:31Z by Claude
  - Done @ 2026-11-19T17:17:14Z by Claude

### web: explorer timeline view
- id: t-42
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T17:10:51Z by Claude
  - Done @ 2026-11-19T17:11:26Z by Claude

### web: explorer chain view
- id: t-41
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T17:01:11Z by Claude
  - Done @ 2026-11-19T17:02:00Z by Claude

### web: explorer table view, filter and block panel
- id: t-40
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T16:53:48Z by Claude
  - Done @ 2026-11-19T16:57:28Z by Claude

### web: combined Chains page and /chains routes
- id: t-39
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T16:44:28Z by Claude
  - Done @ 2026-11-19T16:47:15Z by Claude

### web: app bar with per-page actions and breadcrumbs
- id: t-38
- owner: Claude
- tags: web, plan5
- history:
  - To Do @ 2026-11-19T16:41:07Z
  - Doing @ 2026-11-19T16:41:07Z by Claude
  - Done @ 2026-11-19T16:42:36Z by Claude

### web: latency distribution chart
- id: t-36
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T16:20:05Z
  - Doing @ 2026-11-19T16:20:05Z by Claude
  - Done @ 2026-11-19T16:23:11Z by Claude

### web: allowlist empty, smoke check, docs
- id: t-35
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T16:09:05Z by Claude
  - Done @ 2026-11-19T16:09:50Z by Claude

### web: Benchmark restyle
- id: t-34
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T16:04:00Z by Claude
  - Done @ 2026-11-19T16:05:57Z by Claude

### web: Explorer restyle
- id: t-33
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T16:01:00Z by Claude
  - Done @ 2026-11-19T16:02:17Z by Claude

### web: Transact restyle
- id: t-32
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T15:40:53Z by Claude
  - Done @ 2026-11-19T15:57:03Z by Claude

### web: Studio restyle
- id: t-31
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T15:36:00Z by Claude
  - Done @ 2026-11-19T15:39:25Z by Claude

### web: Accounts and Chains restyle
- id: t-30
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T15:31:21Z by Claude
  - Done @ 2026-11-19T15:34:51Z by Claude

### web: UI primitives, icons, app shell
- id: t-29
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T15:26:35Z by Claude
  - Done @ 2026-11-19T15:29:35Z by Claude

### web: tokens, themes, theme store, guard tests
- id: t-28
- owner: Claude
- tags: web, plan4
- history:
  - To Do @ 2026-11-19T15:16:20Z
  - Doing @ 2026-11-19T15:23:22Z by Claude
  - Done @ 2026-11-19T15:23:24Z by Claude

### web: browser smoke test and docs
- id: t-27
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T14:34:05Z by Claude
  - Done @ 2026-11-19T14:34:06Z by Claude

### web: in-browser Benchmark
- id: t-15
- owner: Claude
- tags: web
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T13:40:22Z by Claude
  - Done @ 2026-11-19T13:40:22Z by Claude

### web: Benchmark page
- id: t-26
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T13:40:22Z by Claude
  - Done @ 2026-11-19T13:40:22Z by Claude

### web: Explorer page
- id: t-25
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T13:20:24Z by Claude
  - Done @ 2026-11-19T13:26:59Z by Claude

### web: Transact page
- id: t-24
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T13:16:12Z by Claude
  - Done @ 2026-11-19T13:17:32Z by Claude

### web: solc worker and Studio
- id: t-23
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T13:11:10Z by Claude
  - Done @ 2026-11-19T13:11:12Z by Claude

### web: Studio (solc-js compile, deploy, call)
- id: t-14
- owner: Claude
- tags: web
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T13:11:10Z by Claude
  - Done @ 2026-11-19T13:11:12Z by Claude

### web: chains and accounts pages
- id: t-22
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T13:01:32Z by Claude
  - Done @ 2026-11-19T13:01:34Z by Claude

### web: scaffold and stores
- id: t-21
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T12:42:18Z by Claude
  - Done @ 2026-11-19T12:47:18Z by Claude

### Playground core and approach extensions
- id: t-20
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T12:35:51Z by Claude
  - Done @ 2026-11-19T12:37:23Z by Claude

### Playground spike: persistence and revm
- id: t-19
- owner: Claude
- tags: web, plan3
- history:
  - To Do @ 2026-11-19T12:33:12Z
  - Doing @ 2026-11-19T12:34:25Z by Claude
  - Done @ 2026-11-19T12:34:25Z by Claude

### cli: report command generating REPORT.md
- id: t-13
- owner: Claude
- tags: cli, report
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T11:15:34Z by Claude
  - Done @ 2026-11-19T11:24:34Z by Claude

### Approach 02: seq-memory
- id: t-08
- owner: Claude
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T10:41:43Z by Claude
  - Done @ 2026-11-19T11:15:34Z by Claude

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

### core: Approach interface, trade-off schema, metrics
- id: t-04
- owner: Claude
- tags: core
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T10:04:27Z by Claude
  - Done @ 2026-11-19T10:30:28Z by Claude

### core: five scenarios (generator + verifier each)
- id: t-05
- owner: Claude
- tags: core
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T10:17:10Z by Claude
  - Done @ 2026-11-19T10:21:13Z by Claude

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

### contracts: MintableToken + AtomicSwap compiled with solc-js
- id: t-03
- owner: Claude
- tags: contracts
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T09:59:31Z by Claude
  - Done @ 2026-11-19T10:04:27Z by Claude

### Design evm-benchmarks
- id: t-00
- owner: Claude
- tags: design
- history:
  - Doing @ 2026-11-19T08:30:00Z by Claude
  - Done @ 2026-11-19T09:38:00Z by Claude

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
