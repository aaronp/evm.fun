# Order book (two venues) — design

Board: t-64 "On-chain order book, single chain", moved ahead of t-62 (cross-chain swap) and t-63 (pool), and widened
with t-65's off-chain matching. Mockup: `evm-benchmarks/design/step2/orderbook/Trade.dc.html` (git-ignored).

## Intent

A Trade screen with limit and market orders, partial fills and a live book, on top of a UI-free order-book package
with a realistic API. The book is a design choice, so the playground builds **both** and lets you switch:

- **On-chain venue.** Orders rest in `OrderBook.sol`; a taker's transaction matches and settles them atomically.
- **Off-chain venue.** Makers sign orders; the book lives behind a lower-level persistence API (memory for tests,
  IndexedDB in the browser); matching happens in the package; one transaction to `Settlement.sol` checks the
  signatures and moves both legs.

Both sit behind one `Venue` API. The Trade screen, the walkthroughs and the benchmark only talk to that API, so the
two designs are always exercised the same way and can be compared.

## Goals

- `@evmb/orderbook` (`packages/orderbook`, UI-free, documented, tested against real webevm chains): the `Venue` API,
  the two venues, the persistence API with memory and IndexedDB implementations, order reports.
- `OrderBook.sol` and `Settlement.sol`, built and exported like `Swap`.
- A Trade page (`/trade`, sidebar under Markets after Swap) following the mockup's layout and behaviour, with a venue
  switch in the header.
- Studio actions "Deploy OrderBook.sol" and "Deploy Settlement.sol"; the Trade page offers "Deploy …?" for the
  selected venue when it's missing (as Swap does).
- Two walkthroughs, one per venue, telling the same story; new walkthrough step types for orders.
- Benchmark scenarios `book-match-onchain` and `book-match-offchain`.
- ADR-0018, board (t-64 Doing → Done, t-65 folded in), risks.

## Non-goals

- Settlement choices (the mockup's "Atomic DvP / Batch netting" picker, the Settlement page, "settling · batch").
  Both venues settle atomically in the matching transaction.
- Fees (the mockup's "Taker fee 0.05%" row is left out; no invented numbers).
- Cross-chain books (step 7), the pool (t-63), named markets ("New market", t-71).
- Native ETH (ERC-20 only, as Swap).

## Anti-goals

- A book that shows liquidity the chain won't honour: an off-chain order whose maker has since spent their funds or
  whose fill is recorded on-chain must not show as available.
- Invented data from the mockup.

## The API: `Venue`

```ts
type Side = 'buy' | 'sell'                       // of the base asset
type Market = { base: Address; quote: Address }  // ERC-20s on one chain
type OrderInput = { market: Market; side: Side; type: 'limit' | 'market'; price?: bigint; amount: bigint }
type Order = { id: string; venue: 'onchain' | 'offchain'; owner: Address; market: Market; side: Side; price: bigint;
               amount: bigint; filled: bigint; status: 'open' | 'partial' | 'filled' | 'cancelled' | 'failed';
               placedAt: { block?: bigint; time: string } }
type Level = { price: bigint; size: bigint; total: bigint; orders: number }
type Trade = { price: bigint; amount: bigint; maker: Address; taker: Address; takerSide: Side; tx: Hex; block: bigint }

interface Venue {
  kind: 'onchain' | 'offchain'
  book(m: Market, depth?: number): Promise<{ bids: Level[]; asks: Level[] }>   // best first
  place(wallet: Wallet, o: OrderInput): Promise<PlaceResult>                     // fills now + rests the remainder (limit)
  cancel(wallet: Wallet, id: string): Promise<void>
  orders(q: { owner?: Address; market?: Market; status?: Order['status'][] }): Promise<Order[]>
  trades(m: Market, limit?: number): Promise<Trade[]>                            // newest first
  report(id: string): Promise<OrderReport>                                       // what happened to one order
}
type PlaceResult = { order?: Order; fills: Trade[]; tx?: Hex; reverted?: { error: string; args: unknown[] } }
type Wallet = { address: Address; sendTransaction(tx: { to?: Address; data: Hex }): Promise<Receipt>;
                signTypedData(td: TypedData): Promise<Hex> }
```

- **Price** is quote raw units per one whole base unit (`10^baseDecimals`), an integer; the screen shows it with the
  quote's decimals trimmed to the market's tick (4 dp, as the mockup's `tick 0.0001`). Quote amount of a fill =
  `amount × price / 10^baseDecimals`, rounded in the resting order's favour. Tested both ways round.
- **Matching:** price-time priority; a taker crosses levels best first until filled or its limit price stops it; a
  market order has no limit but a max-levels cap (default 20) and fails rather than half-crossing silently if the
  book is too thin (reported). Self-match: allowed (playground), reported as a trade with maker = taker.
- **Reports:** `OrderReport` is plain data like the Swap report: the order, its fills (tx, block, counterparty,
  price, amount), cancellation, and for failures the decoded error and a fix ("Approve OrderBook to spend at least
  6,352.50 USD …"). The report page reuses the Swap report's layout.

## On-chain venue: `OrderBook.sol`

- `place(base, quote, side, price, amount, maxLevels) returns (id)` escrows the order's give side (sell: base;
  buy: `amount × price` of quote), matches against the opposite side up to `maxLevels`, pays both legs, and rests the
  remainder (limit) or refunds it (market). `cancel(id)` returns the remaining escrow; owner only.
- Book storage: per market and side, a sorted doubly linked list of price levels, each a FIFO queue of order ids.
  Insert takes a `hint` (a neighbouring price) so it's O(1) with a good hint and falls back to a bounded walk.
- Captured at origin: each order stores `filled`, `status`, `closedBlock`; `ordersOf(owner)` is an on-chain per-owner
  id list (O(1) "my orders", as Swap's t-72 lesson); `Trade` events carry maker, taker, price, amount, order ids.
- Errors: `OrderNotOpen(id, status)`, `NotOwner(id)`, `BadOrder()`, `BookTooThin(filled)` (market order).

## Off-chain venue: signed orders + `Settlement.sol`

- An order is EIP-712 typed data `{maker, base, quote, side, price, amount, nonce, expiry}` signed by the maker's
  key; its id is the typed-data hash. Placing an off-chain order costs no gas.
- `Settlement.sol`: `filled(hash)` and `cancelled(hash)` on-chain; `settle(Order[] makers, bytes[] sigs, uint[]
  fills, Side takerSide)` — sent by the taker — checks each signature, expiry, remaining amount, then moves both
  legs with `transferFrom` from maker and taker (no escrow: makers keep custody until a fill). `cancel(Order)` by the
  maker marks it cancelled on-chain. Errors as the on-chain venue plus `BadSignature(i)`, `Expired(i)`.
- The book's truth: the store holds the signed orders; **fill and cancel state come from the chain** (`filled`,
  `cancelled`, read per order). Liquidity shown = remaining amount, capped by the maker's current balance and
  allowance to Settlement (read live); an order that can't be honoured is shown as such and skipped by matching.
- Placing a limit order that crosses: the package matches it against resting orders and sends `settle` from the
  taker; the remainder is signed and stored.

## Persistence API (lower level)

```ts
interface Store {
  get<T>(table: string, key: string): Promise<T | undefined>
  put(table: string, key: string, value: unknown): Promise<void>
  del(table: string, key: string): Promise<void>
  scan<T>(table: string, index: string, range: { from?: IndexKey; to?: IndexKey; reverse?: boolean; limit?: number }): Promise<T[]>
}
type IndexKey = (string | number)[]          // tuple order, compared element by element
type Schema = Record<string, { indexes: Record<string, (v: any) => IndexKey> }>
```

- `memoryStore(schema)` (sorted arrays, for tests and benchmarks) and `idbStore(name, schema)` (IndexedDB object
  stores with compound indexes). One shared conformance test runs against both (IndexedDB via `fake-indexeddb` as a
  dev dependency, or skipped with a reason if unavailable — builder's call).
- The off-chain venue's schema: `orders` keyed by hash, indexes `book` = `[chainId, base, quote, side, priceKey,
  seq]` (priceKey sorts bids descending and asks ascending), `owner` = `[chainId, owner, seq]`. Scans are O(log n +
  k); no full reads.
- In the web app the store is per browser; it's keyed by chain id and Settlement address, so snapshots/forks/imports
  never confuse books; on a fork the chain's `filled`/`cancelled` state stays authoritative.

## Web

- **Trade page** (`/trade`), faithful to the mockup's layout and behaviour:
  - Header: market picker (the chain's ERC-20 pairs, `?base=&quote=` as Swap), swap-sides button, last price
    ("last · USD per GBP"), spread with bps, chain name, and the **venue switch** (On-chain / Off-chain) in place of
    the settlement chip; venue kept in `?venue=`.
  - Order book panel: asks above (red), mid/last row with spread, bids below (green), price / size / total columns,
    depth bars, "tick 0.0001", "Click a level to load its price".
  - Depth chart (bids/asks step areas, mid marker), Recent trades (price / size / block; the mockup's settlement
    column is dropped with the settlement choices).
  - Order form: Buy/Sell, Limit/Market, limit price, amount with 25/50/75/Max (of available), "You pay", "Available",
    the allowance warning with "Approve more" (exact amount), and the submit button ("Buy 5,000 GBP").
  - My orders: All / Open / Failed filter; order, side, price, filled / size, status badge; Report or Cancel.
  - No venue contract on this chain → body disabled with "Deploy OrderBook.sol?" / "Deploy Settlement.sol?".
    Benchmark chains disabled as for Swap.
- Reuses: chain switcher, Acting as, `signAndSend`, `parseAmount`/`formatAmount`, the Swap report layout.
- `Wallet` in the app wraps the acting account (private key in the accounts store) for `sendTransaction` and
  `signTypedData`.

## Walkthroughs

- New step types: `deployVenue` (`venue: onchain|offchain`), `placeOrder` (`from, venue, side, type, price, amount`,
  key kind `order`), `cancelOrder`. New checks: `order` status and filled amount, `trade` count. Bindings on the Trade
  page (venue switch, form fields, submit, cancel).
- `gbp-usd-book-onchain.json` and `gbp-usd-book-offchain.json`: Alice and Bob, GBP/USD; Alice places two resting
  asks; Bob buys across both with one order (a partial fill on the second); checks the fills, the remaining order
  and balances. Both run headless in `bun test` and in the ribbon.

## Benchmark

`book-match-onchain` and `book-match-offchain`, shaped like `offer-fill`: setup places N resting orders (untimed);
the N timed txs are takers each crossing one resting order (on-chain `place` vs off-chain `settle`). Verify fills
and balances.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **Both (chosen)** | One `Venue` API, two venues, a header switch | Compares two real designs on the same screen, walkthroughs and benchmark; more to build |
| On-chain only | t-64 as written | Simplest; every place/cancel costs gas; no use for the persistence API |
| Off-chain only | t-65 hybrid | Realistic and cheap to place; needs signing and a store; no on-chain baseline |

Decided with Aaron: build both behind one API; a realistic API over a lower-level persistence API that IndexedDB can
back; a venue switch in the header (not side by side); a walkthrough per venue.

## Constraints

As earlier steps: tokens only, three themes, contrast tests, phone width; real chain data only; mockup wins on layout
and copy except where a non-goal removes something; `@evmb/orderbook` imports nothing from `packages/web`; commit
with `git commit --only`; never commit `design/`; capture data at its origin and flag O(n) scans as risks with
backlog cards.

## Left to the builder

- Contract internals beyond the stated interface (list layout, hint walk bound), gas tuning.
- Exact `OrderReport` fields beyond the stated content; depth chart rendering.
- Whether `idbStore` is tested with `fake-indexeddb` or only in the browser (say which).

## Settled after the builder check (Claude's calls)

1. **Failed orders are recorded where they happen: by the sender.** The package keeps an `attempts` table in the
   `Store` for **both** venues: every `place`/`settle`/`cancel` it sends is written (input, owner, venue, tx hash)
   before sending and updated with the outcome. A reverted attempt is a `failed` order with id `tx:<hash>`; its
   report replays the call at the parent block like Swap's. So `Store` is shared by both venues (memory in tests,
   IndexedDB in the browser), there's no block scan, and failures survive reload and an Acting-as switch. Keyed by
   chain id and venue address, so a fork starts with no attempts of its own (the parent's stay with the parent).
2. **Benchmark uses the package's lower layers.** `@evmb/orderbook` exports its calldata builders, the EIP-712
   signer and the pure matcher; `@evmb/core` depends on it, and the scenarios pre-build signed raw txs like
   `offer-fill`. Timed: only the transactions (on-chain `place` vs off-chain `settle`). Off-chain matching and store
   reads run in setup, untimed — that difference is the point of comparing the two designs, and the report says so.
3. **Off-chain liquidity is capped per maker, summed, oldest first.** For each maker and asset, available = min(balance,
   allowance to Settlement), allocated to their orders oldest first (time priority). An order is shown at its covered
   size; uncovered orders are hidden from the book and shown as "unfunded" in My orders. Matching uses the same rule,
   so the book never shows more than a settle would honour. Tested with two 5,000 GBP asks against 6,000 GBP
   (shows 5,000 + 1,000).
4. **Market orders carry a worst price.** The package walks the book it just read and sends a limit price = the
   worst level it needs ± a slippage bound (default 1%, editable under Market). On-chain, a buy escrows `amount ×
   worst price` and the unspent quote is refunded in the same tx. The form shows "You pay ≈ …, at most …" and the
   allowance check uses "at most". A book too thin to fill is caught before sending (form error, no tx); if it
   thinned in between, the contract reverts `BookTooThin(filled)` and that's a failed attempt with a report.

## Amendments after the build

- `Settlement.settle(Order[], bytes[], uint[])` has no `takerSide` parameter: the taker's side is the opposite of the makers' (the plan's interface won over the sketch).
- The hint walk is unbounded, not "bounded" (a bad hint costs gas proportional to the levels walked; logged as R28).
- Taker buys pay each maker per fill (ceil per fill) and escrow only the resting part: escrow-then-refund at one ceil can't cover the sum of per-fill ceils (the "buy escrows `amount × worst price`, unspent refunded" sentence in item 4 no longer applies).
- Store keys use `scope` (the registry chain id), not the EVM chain id: all playground chains are 31337 and fresh chains deploy at the same addresses. The EVM chain id is only used for the EIP-712 domain.
- A buy's allowance need = `quoteFor(amount, price, up)` + 1 raw unit per fill (per-fill ceils), so the form's "at most" and the pre-check use that.
- `Venue.committed(owner, asset)` was added (off-chain: sum of the maker's open remaining give; on-chain: 0) so the form's need counts the maker's other open orders. `orders()` requires an `owner`, and `OrderInput` has an optional `slippageBps`.
- Non-goals unchanged: no settlement choices, no fees.
