# Step 2 · Same-chain swap — design

Board card: t-61 "Same-chain swap (one offer, settled atomically)". Roadmap step 2 of 7.

## Intent

The smallest possible trade. A maker offers "sell 1,000 GBP for 1,270 USD"; their GBP is held in escrow by a
`Swap` contract. A taker fills the whole offer and both legs move in one transaction, or neither does. The maker
can cancel and get the escrow back. Every take (success or failure) gets an execution report that explains what
happened in plain words. Step 3 (cross-chain HTLC) reuses the offer model and the report; step 5 (on-chain order
book) reuses the book view and the report.

## Goals

- `Swap.sol` with the agreed interface (below), deployed once per chain.
- `@evmb/swap`: a UI-free package (documented, tested) holding the ABI helpers, calls, offer reads, the book view and
  the execution report builder.
- A Swap page and an execution-report page that follow `evm-benchmarks/design/step2/Swap-offers--same-chain` and
  `.../Swap-execution-report-html` faithfully (layout, copy, behaviour). Real chain data only.
- Studio action "Deploy Swap.sol".
- Benchmark scenario `offer-fill`.
- Board (t-61), ADR (new format) and risks kept current in `evm-benchmarks/docs/`.

## Non-goals

- Partial fills, matching, fees, expiry. Each offer fills whole ("each fills whole").
- The Trade / order-book page (`design/step2/orderbook`) — that is step 5.
- "New market" and named markets. A market is just a (base, quote) pair of the chain's assets.
- Cross-chain anything (step 3).
- Native ETH in offers (ERC-20s only; ETH can't be escrowed with `transferFrom`).

## Anti-goals

- A UI that ever shows an offer as open when the chain says it isn't (no cached book).
- Invented numbers from the mockup (e.g. the `[gas]`, `[#]` placeholders become real values).

## Contract: `packages/contracts/src/Swap.sol`

```solidity
enum Status { None, Open, Filled, Cancelled }
struct Offer { address maker; address giveToken; uint256 giveAmt; address getToken; uint256 getAmt; Status status; }

uint256 public nextId;                    // starts at 1; ids are 1..nextId-1
mapping(uint256 => Offer) public offers;  // the book is read from here (approach A)

function makeOffer(address giveToken, uint256 giveAmt, address getToken, uint256 getAmt) returns (uint256 id); // escrows giveAmt
function take(uint256 id);    // getAmt taker→maker, giveAmt escrow→taker, atomically
function cancel(uint256 id);  // maker only; returns escrow
event OfferMade(uint256 indexed id, address indexed maker, address giveToken, uint256 giveAmt, address getToken, uint256 getAmt);
event OfferTaken(uint256 indexed id, address indexed taker);
event OfferCancelled(uint256 indexed id);
error OfferNotOpen(uint256 id, Status status);
error NotMaker(uint256 id);
error BadOffer();                         // zero amount, same token, or zero address
```

- `take` and `cancel` check `status == Open` first (`OfferNotOpen`), set the new status, then move tokens
  (checks-effects-interactions). OpenZeppelin `SafeERC20`; `ReentrancyGuard` on all three.
- The status name is `Filled` (the report mockup shows `OfferNotOpen(4, Filled)`).
- A taker may take their own offer (harmless; no special case).
- Built with the existing `build.ts` (solc 0.8.38, OZ 5.6.1), exported from `@evmb/contracts` like `AssetToken`.

## Package: `@evmb/swap` (`packages/swap`)

Same shape as `@evmb/assets`: depends on viem, `@evmb/assets` (types, `Request`, `formatAmount`-free); dev deps
webevm and `@evmb/contracts` for tests against a real in-process chain.

- **Identity:** `isSwapAbi(abi)`; `findSwap(records)` picks the chain's Swap from contract records (name `Swap` and a
  matching ABI; newest wins).
- **Calls:** `makeOfferCall`, `takeCall`, `cancelCall` (to/data pairs, like `transferCall`).
- **Reads (approach A):** `readOffers(request, swap)` reads `nextId` then `offers(1..nextId-1)`; returns
  `Offer & {id}` for all statuses. Never cached.
- **Book view (pure):** `book(offers, base, quote)` → `asks` (open offers giving base for quote, price ascending),
  `bids` (open offers giving quote for base, price descending), `bestBid`, `bestAsk`, `spread`, and `escrowed`
  totals per token. Price = quote per base, computed with each token's decimals. Offers in other pairs are ignored.
- **Errors:** `decodeSwapError(data)` → `{name, args}` for `OfferNotOpen`, `NotMaker`, `BadOffer` and OZ ERC-20
  errors (`ERC20InsufficientAllowance`, `ERC20InsufficientBalance`).
- **Report:** `takeReport(request, swap, txHash)` → a plain data object (the "Download JSON" content):
  outcome (taken / reverted), offer, taker, maker, price, gas used, block, the steps of "What happened" with their
  evidence (`OfferMade`, block, `transferFrom`, `transfer`, `OfferTaken`), balance changes from `Transfer` logs,
  raw log lines. For a reverted tx: the revert reason is recovered by re-running the call (`eth_call` at the tx's
  parent block with the same from/to/data), decoded with `decodeSwapError`, and turned into the failed step plus a
  fix suggestion (e.g. allowance too low → "Approve Swap to spend at least 635.00 USD from tester, then take the
  offer again. It is still open at the same price.").
- **Activity:** `activity(request, swap)` → made / taken / cancelled from `OfferMade`/`OfferTaken`/`OfferCancelled`
  logs, plus reverted `take`s found by scanning blocks for txs to the Swap address with status 0. Also
  `approve`s to the Swap from `Approval` logs (the mockup's "approved" badge). Newest first.

## Web

- **Studio:** a "Deploy Swap.sol" action. It deploys `Swap` from the acting account and saves a normal contract
  record named `Swap` (so it travels with snapshots, forks and export/import like any contract). Disabled on
  benchmark chains (same reason text as assets) and when a Swap already exists (title says so).
- **Swap page** (`/swap`, sidebar "Swap" under Markets, after Assets):
  - Chain selector as on the Assets page; app-bar title `Swap · GBP/USD` with `Swap.sol <address>` chip;
    "Acting as" uses the app's existing account selector.
  - No Swap on this chain → the page body is disabled and shows a "Deploy Swap.sol?" button (same action as Studio).
    Benchmark chain → disabled with the benchmark reason.
  - Pair: base and quote pickers over the chain's ERC-20 assets (default: the first two); URL `?base=&quote=`.
  - Stat cards: best bid, best ask, escrowed in Swap (base, quote), acting account's wallet (base, quote), and
    "Swap may spend" (the acting account's allowances to Swap).
  - Open offers: asks (red) above, spread row, bids (green) below, columns price / base / quote / maker
    ("you" for the acting account); "each fills whole"; "Click an offer to take it."
  - Take panel for the selected offer: you pay / you receive / price / maker · escrowed ✓; checks
    "Balance … covers it" and "Swap may spend … — needs …"; the two-step buttons "1 · Approve …" and
    "2 · Take #n · pay …"; the one-transaction sentence. Your own offer can't be taken here (shows Cancel instead).
  - Make an offer: Sell/Buy base toggle, amount (base) and price (quote per base), "You escrow now" /
    "You get when taken", approve step when the allowance is short, then "Create offer & escrow".
  - "<account>'s offers" with status and Cancel; Activity list with badges (taken, reverted, cancelled, offered,
    approved) and "Report" links.
  - Every take, success or revert, navigates to (or offers) its report.
- **Report page** (`/swap/report?tx=<hash>`): built only from `takeReport`; success and failure layouts per the
  mockup; "Download JSON"; Explorer link; works after reload (everything is derived from the chain).
- Amount inputs use the existing `parseAmount`; amounts shown with `formatAmount`.

## Benchmark: `offer-fill`

New scenario in `packages/core/src/scenarios`, shaped like `atomic-swap`: setup deploys two tokens and `Swap`,
funds makers and takers, and makers create N offers (untimed); the N timed txs are `take`s, one per offer, from
disjoint takers. Verify: every offer `Filled` and balances moved exactly. Added to the CLI/Benchmark page lists
like the other scenarios.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Offers in a mapping with a public getter and `nextId`; the package reads them directly. Events only for Activity and reports | Simplest, can't go stale, nothing new to store or carry through snapshots. Reads every offer ever made (fine at playground scale; risk logged) |
| B | Rebuild the book from `OfferMade`/`Taken`/`Cancelled` logs | No getter needed, but another from-block-0 scan (like R16) plus state reconstruction |
| C | Index offers in the app's key-value store | Fast reads, but goes stale on restore, fork and import |

Also decided with Aaron: one Swap per chain, deployed explicitly (Studio, or the Swap page's "Deploy Swap.sol?"
button), found from contract records.

## Constraints

As earlier steps: tokens only (no raw colours), three themes, contrast tests, phone width; the mockup wins over this
text where they disagree; never commit `design/`; commit only named paths (`git commit --only`), never the user's
staged files.

## Left to the builder

- Exact component split of the Swap page; how the report page lays out on narrow screens.
- Whether `activity` paginates.
- Test structure, as long as contract behaviour (escrow, atomic take, cancel, all three errors, reentrancy-safe
  ordering), book maths (decimals, ordering, other pairs ignored) and both report outcomes are covered against a
  real webevm chain.

## Settled after the builder check (Claude's calls unless marked)

1. **Failure reports.** Specific copy and fix for the four common failures: allowance too low
   (`ERC20InsufficientAllowance`), balance too low (`ERC20InsufficientBalance`), `OfferNotOpen(Filled)` ("someone
   else took #n first") and `OfferNotOpen(Cancelled)` ("the maker cancelled #n"). Anything else (out of gas, empty
   revert, undecodable data) gets one generic failed step showing the decoded error name or the raw revert data,
   with no fix suggestion. Same layout as the mockup's failure case.
2. **Finding the revert reason.** Offer status at the time of the tx comes from logs, not a replay: if an
   `OfferTaken`/`OfferCancelled` for that id precedes the tx (earlier block, or same block with a lower tx index),
   the reason is `OfferNotOpen`, and the report names who took it and in which block ("earlier in block N" when
   it's the same block). Otherwise the call is replayed with `eth_call` at the parent block to get the revert data.
   Known limit: an approve or transfer earlier in the same block isn't seen by the replay (logged as a risk). If
   webevm can't `eth_call` at a past block, the replay falls back to `latest` and the report says the reason was
   reconstructed now.
3. **Crossing offers.** Advisory only, as in the mockup: the amber note "Someone is already buying at X or
   better — take their offer instead. Swap doesn't match offers for you." (or the selling version); "Create
   offer & escrow" stays enabled. Amounts are checked per token by `parseAmount` (extra decimals refused).
4. **Price and rounding.** The form computes the quote amount as amount × price, rounded half-up to the quote
   token's decimals; "You escrow now" / "You get when taken" show the exact amounts that will be sent, and the
   book always shows the price derived from the stored amounts. `book` compares prices exactly (BigInt cross
   multiplication, decimals-adjusted), displays 4 decimal places, and breaks ties by lowest id first.
5. **Names in reports.** `takeReport` returns addresses only. The page maps them to account names ("me",
   "tester", "Swap" for the contract, short address otherwise). The downloaded JSON is the report plus a `labels`
   map of the names the page used.
6. **Which Swap a report uses.** The report page takes the Swap address from the tx's `to`, not `findSwap`, so old
   reports keep working after forks or a second deploy. Reports exist for takes only (success or revert);
   Activity shows "Report" only on taken and reverted rows.
7. **"approved" in Activity.** Only `Approval` logs for the two tokens of the selected pair, with spender = Swap
   (topic-filtered `eth_getLogs`).
8. **Benchmark.** `offer-fill` follows `atomic-swap`'s shape and sizing (senders as makers and as disjoint takers,
   N offers); verify reads `offers(id)` directly in a loop and checks totals.
