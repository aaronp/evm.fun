# Liquidity pool (x·y = k) — design

Board: t-63 "Liquidity pool (Uniswap v2-style, x·y = k)", roadmap step 4, taken next (before t-62 cross-chain swap).
Mockup: Aaron's screenshot, saved git-ignored as `evm-benchmarks/design/step4/Pool.png` (no HTML export; the
screenshot is the reference for layout and copy).

## Intent

A GBP/USD pool anyone can add liquidity to, remove it from, and swap against with a quote and a slippage limit.
Self-contained: no matching, no counterparty online. It gives every later step a reference price (the order book
shows it in its header; the Pool page shows the Swap offers' best bid/ask beside it).

## Goals

- `Pool.sol`: one pool per (base, quote) pair, and itself the ERC-20 LP token (Uniswap v2 shape, written from
  scratch, about a page).
- `@evmb/pool` (`packages/pool`, UI-free, documented, tested against a real webevm chain): reads, quotes (amount out,
  price, price impact, fee, minimum received), add/remove maths, calls, activity, errors.
- A Pool page (`/pool`, sidebar under Markets between Swap and Trade) following the screenshot.
- Studio action "Deploy Pool.sol" (pair picker) and the page's "Deploy Pool.sol?" prompt.
- The pool's price as a reference in the Trade page header.
- Benchmark scenario `amm-swap`; a walkthrough `gbp-usd-pool`.
- ADR-0019, board (t-63), risks.

## Non-goals

- Multi-hop routing, a factory/registry contract, flash swaps, TWAP oracles, protocol fees, fee tiers.
- Concentrated liquidity (v3) or any curve other than x·y = k.
- Native ETH (ERC-20s only).

## Anti-goals

- A quote that differs from what the contract does (same integer maths, same rounding, to the unit).
- Invented numbers from the screenshot.

## Contract: `Pool.sol`

```solidity
constructor(address base, address quote)          // the pair; base != quote, neither zero
// ERC-20 LP token: name "Pool LP <BASE>/<QUOTE>", symbol "PLP", 18 decimals (OZ ERC20)
address public immutable base; address public immutable quote
function reserves() view returns (uint256 base, uint256 quote)
function addLiquidity(uint256 baseIn, uint256 quoteIn, uint256 minShares) returns (uint256 shares)
function removeLiquidity(uint256 shares, uint256 minBase, uint256 minQuote) returns (uint256 baseOut, uint256 quoteOut)
function swap(address tokenIn, uint256 amountIn, uint256 minOut) returns (uint256 amountOut)
event LiquidityAdded(address indexed provider, uint256 base, uint256 quote, uint256 shares)
event LiquidityRemoved(address indexed provider, uint256 base, uint256 quote, uint256 shares)
event Swapped(address indexed trader, address tokenIn, uint256 amountIn, uint256 amountOut, uint256 reserveBase, uint256 reserveQuote)
error BadAmount(); error BadToken(); error Slippage(uint256 out, uint256 min); error NoLiquidity();
```

- Reserves are tracked in storage (not read from balances), updated in every call; tokens move with SafeERC20;
  `nonReentrant`; checks-effects-interactions.
- **First deposit:** shares = √(base·quote) − 1,000; the 1,000 are minted to `address(0xdead)` (locked forever,
  v2's guard against share-price manipulation). Later deposits: shares = min(baseIn·S/Rb, quoteIn·S/Rq); the excess of
  the side that's over the current ratio is **not** taken (only the proportional amounts are pulled), so a deposit
  never donates.
- **Swap:** fee 30 bps on the input: `inWithFee = amountIn·9970`; `out = inWithFee·Rout / (Rin·10000 + inWithFee)`
  (rounded down); `out ≥ minOut` else `Slippage(out, minOut)`; k never decreases.
- **Remove:** base = shares·Rb/S, quote = shares·Rq/S (rounded down), burn shares, checks against the minimums.
- Captured at origin: `Swapped` carries the reserves after the swap, so activity and "price after" need no extra reads.

## Package: `@evmb/pool`

Same shape as `@evmb/swap`: deps viem and `@evmb/assets`; dev deps webevm and `@evmb/contracts`; no dependency on
`@evmb/core` or approach packages.

- `isPoolAbi`, `findPool(records, base, quote)` (newest record named `Pool` for that pair).
- `readPool(request, pool) → { base, quote, reserveBase, reserveQuote, totalShares, k }`; `position(request, pool,
  owner) → { shares, share (bps), base, quote }`.
- Pure maths, mirroring the contract exactly: `amountOut(amountIn, rIn, rOut)`, `quoteSwap(pool, tokenIn, amountIn,
  slippageBps) → { out, price, priceAfter, impactBps (execution price excluding the fee vs the current price), fee, minOut }`, `quoteAdd(pool, baseIn, quoteIn) → { shares,
  baseUsed, quoteUsed }`, `quoteRemove(pool, shares) → { base, quote }`, `poolPrice(pool)` (quote per base, in the
  order-book price units: quote raw per whole base).
- Calls: `addLiquidityCall`, `removeLiquidityCall`, `swapCall`. Errors: `decodePoolError`.
- `activity(request, pool, fromBlock)` → adds, removes, swaps (newest first) from the events.

## Web

- **Pool page** per the screenshot:
  - App bar "Pool · GBP/USD", `Pool.sol <address>` chip, "Your wallet: … GBP · … USD" for the acting account.
  - Pair pickers as Swap (`?base=&quote=`); no pool for the pair → "Deploy Pool.sol?"; benchmark chain disabled.
  - Stat cards: Pool price (USD per GBP = USD ÷ GBP), Reserve x · GBP, Reserve y · USD, k = x · y ("only grows
    (fees)"), Swap fee 0.30% ("paid to liquidity providers").
  - Tabs Swap / Add liquidity / Remove.
    - Swap: You pay (amount + token), Balance, flip button, You receive (estimate), Your price, Price impact,
      Fee (0.30%), Slippage tolerance 0.1% / 0.5% / 1% (default 0.5%), Minimum received, "1 · Approve …",
      "2 · Swap …", and "Reverts if you would get less than the minimum — e.g. if someone else trades first and
      moves the price."
    - Add liquidity: amounts of both (typing one fills the other at the pool ratio once the pool has liquidity;
      both free for the first deposit with the initial price shown), shares you'd get, your new share %, approvals,
      "Add liquidity".
    - Remove: shares by percent (25/50/75/Max) or amount, You receive GBP + USD, minimums at the slippage tolerance,
      "Remove liquidity".
  - The curve x · y = k (axes "x · GBP in pool", "y · USD in pool"), points "now" and "after this swap", cards
    Price now / Price after / "Swap offers (step 2)" with the Swap page's best bid · ask for the pair (or "none").
  - Your position: share %, LP amount, bar, Your GBP / USD in the pool, Worth at pool price.
  - Pool activity: add / remove / swap rows with who and amounts, LP delta for adds/removes; "Explorer →".
- **Trade page header:** "pool 1.2700" reference beside the last price when a pool exists for the pair.
- Reuses: chain switcher, Acting as, `signAndSend`, `parseAmount`/`formatAmount`, the shared deploy helper.

## Walkthrough `gbp-usd-pool`

Alice and Bob; GBP/USD; deploy Pool; Alice sends Bob GBP (`transfer`); Alice adds 100,000 GBP + 127,000 USD; Bob swaps 1,000 GBP with 0.5% slippage;
checks: Bob received ≥ the minimum, k grew. Only k and balances are checked; the position's worth is not asserted. New step types `deployPool`, `addLiquidity`, `removeLiquidity`,
`poolSwap`; checks `{ pool: $pool, kGrew: true }` and balances. Runs headless and in the ribbon.

## Benchmark `amm-swap`

Setup deploys two MintableTokens and a Pool, seeds liquidity, funds and approves N traders; timed: N swaps from
disjoint traders, each one direction, split across both directions (so the price stays near the start), each with `minOut = 0`; verify (order-
independent, since approaches may reorder): per token, reserves + every trader's balance equal the starting totals,
every trader's paid token is accounted for exactly (one direction per trader), and the final k ≥ the starting k. The slippage revert is covered by the
contract and page tests, not the walkthrough or the benchmark.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | One `Pool.sol` per pair that is its own LP ERC-20 (v2 shape, from scratch) | Familiar, readable, LP transferable; one deploy per pair |
| B | One contract holding every pair, LP balances internal | Fewer deploys; LP not transferable; less familiar |
| C | Vendor Uniswap v2 | Battle-tested, but harder to read in a playground and licence questions (ruled out on the card) |

Decided with Aaron: the pool goes next (before t-62); approach A; the screenshot is the layout reference.

## Constraints

As earlier steps: tokens only, three themes, contrast tests, phone width; real data only; the screenshot wins on
layout and copy where readable; never commit `design/`; commit with `git commit --only`; capture data at origin and
flag O(n) reads (activity's log read) as risks with backlog cards.

## Left to the builder

- Integer square root implementation; exact LP token name formatting.
- The Remove tab's layout details (not in the screenshot) within the stated content.
- Curve rendering (range, sampling).

## Settled after the builder check (Claude's calls)

1. **LP shares are in whole-unit terms.** The constructor reads both tokens' decimals (refusing > 18 with `BadToken`)
   and stores scale factors; the first deposit mints `floor(√(baseIn·10^(18−db) · quoteIn·10^(18−dq))) − 1,000`
   (18-decimal LP, so 50,000 GBP + 63,500 USD → 56,347.14 LP as in the screenshot whatever the token decimals). Later
   deposits and removals stay proportional (`min(baseIn·S/Rb, quoteIn·S/Rq)`, `shares·R/S`, floored). The package
   mirrors this to the unit. The 1,000 locked raw units are 1e-15 LP: negligible on screen, still v2's guard.
2. **`amm-swap` verifies invariants, not a replay** (see Benchmark): approaches may reorder, so verify checks token
   conservation, exact paid-token accounting per trader and final k ≥ starting k; timed swaps carry `minOut = 0`.
3. **A pool belongs to an unordered pair.** `base()`/`quote()` are public immutables; `findPool(request, records, a,
   b)` reads them and matches either order (newest wins); deploying refuses when a pool for the pair exists in either
   order. The page and the Trade header show the price in the page's orientation (inverting when the pool's base is
   the page's quote), and Reserve x / y follow the page's base / quote.

## Amendments (from the build)

- Price impact is the execution price excluding the fee against the current price (Uniswap's definition; gives the screenshot's 0.99%), not the pool-price move (about 1.97% for the same trade).
- The slippage revert is covered by the contract and page tests, not the walkthrough (the walkthrough has no failing step).
- `amm-swap` gives each trader one direction, so verify checks the paid token exactly (every missing swap is detected without a price assumption) instead of a 90% output floor.
- The walkthrough gained a `transfer` step (Alice sends Bob GBP): a launched token's supply goes to its issuer, so Bob had no way to get GBP.
- The add's `k` is read at the add's block (capture at origin), so there is no latest-block caveat.
