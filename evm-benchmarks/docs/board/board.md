---
version: 1
---
# evm.fun

## To Do

### Cross-chain swap (HTLC)
- id: t-02
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
- id: t-03
- history:
  - To Do @ 2026-11-20T08:47:49.803Z

```md
Create a GBP/USD pool, add and remove liquidity, and swap with a quote and a slippage limit. It’s self-contained, with no matching and no counterparty online, and it gives every later step a reference price. I’d write a minimal pool yourself (about a page of Solidity) rather than vendoring Uniswap’s code. That’s easier to read in a playground and avoids licence questions. Benchmark scenario: amm-swap.
```

### On-chain order book, single chain
- id: t-04
- history:
  - To Do @ 2026-11-20T08:47:58.873Z

```md
Limit orders rest in a contract, a taker’s transaction matches them, and settlement is atomic within that transaction. This is the Trade screen we designed, minus the settlement choices. It reuses step 2’s report and step 4’s pool price as a reference. Benchmark scenarios: book-match, plus book versus pool on the same trade.
```

### Signed orders and off-chain matching
- id: t-05
- history:
  - To Do @ 2026-11-20T08:48:16.886Z

```md
This is the hybrid model. It’s required for step 7, because a single contract can’t hold a book that spans two chains.
```

### Cross-chain order book
- id: t-06
- history:
  - To Do @ 2026-11-20T08:48:39.324Z

```md
Off-chain matching (step 6) with HTLC settlement (step 3): matched pairs whose legs are on different chains settle by hash-lock.

Later: netting, auctions, the vault, and the full market wizard. By then each is an option added to pieces that already work.

Why this order: steps 2 and 3 are the same feature, first on one chain and then across two. That gets you cross-chain settlement by step 3 without first building an order book. The pool is independent, so you could swap it with step 5 if order books matter more to you.
```

## Doing

### Same-chain swap (one offer, settled atomically).
- id: t-01
- history:
  - To Do @ 2026-11-20T08:47:16.453Z
  - Doing @ 2026-11-20T08:48:52.373Z

```md
A small Swap.sol:

the maker creates an offer, “sell 1,000 GBP for 1,270 USD”, and their GBP is held in escrow by the contract;
the taker fills it, and both legs move in one transaction;
the maker can cancel.

This is the smallest possible “trade”. It also introduces the execution report for successes and failures, for example a failure from a missing allowance. Benchmark scenario: offer-fill.
```

## Done
