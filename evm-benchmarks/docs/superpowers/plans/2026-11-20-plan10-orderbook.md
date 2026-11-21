# Order book (two venues): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Trade screen with limit and market orders over a UI-free `@evmb/orderbook` package whose one `Venue` API has two implementations — orders resting in `OrderBook.sol`, and signed orders kept in a persistence `Store` (memory / IndexedDB), matched off-chain and settled by `Settlement.sol` — plus a walkthrough and a benchmark scenario per venue.

**Architecture:** Layers in `@evmb/orderbook`: `store` (persistence API) → `core` (pure: types, price maths, matcher, liquidity allocation) → `calls`/`eip712` (calldata and typed data) → two venues (`onchain`, `offchain`) that both journal their attempts in the `Store` and build reports. The web app composes a venue from the chain, the venue contract record and one IndexedDB store; the Trade page, walkthrough bindings and benchmark use only the package.

**Tech Stack:** Bun 1.3.13 workspace, TypeScript, viem, webevm 0.9.1 (tests), solc 0.8.38 + OpenZeppelin 5.6.1 (EIP712, ECDSA, SafeERC20, ReentrancyGuard), React 19 + Tailwind 4, `fake-indexeddb` (dev, for the IndexedDB store test).

**Spec:** `evm-benchmarks/docs/superpowers/specs/2026-11-20-orderbook-design.md` — its "Settled after the builder check" section is binding. ADR-0018. Mockup (git-ignored, never commit): `evm-benchmarks/design/step2/orderbook/Trade.dc.html`; its layout and copy win except where the spec's non-goals remove something (settlement picker, fees, settlement column).

## Global Constraints

- **Package boundaries:** `@evmb/orderbook` imports nothing from `packages/web`; no React/DOM. Runtime deps: `viem`, `@evmb/assets` (types, `Request`). Dev deps: `webevm`, `@evmb/contracts`, `@evmb/approach-02-seq-memory` (if needed, as `@evmb/swap`), `fake-indexeddb`. Layout like `packages/swap` (`src/`, `test/`, `README.md`).
- **Price:** integer quote raw units per one whole base unit (`10^baseDecimals`). `quoteFor(amount, price, baseDecimals, round: 'up' | 'down') = amount × price / 10^baseDecimals`; the taker pays rounded **up** and receives rounded **down** (resting order's favour). Tick = `10^max(quoteDecimals − 4, 0)` raw; the form only produces multiples; display 4 dp.
- **Side** is of the base asset: `'buy' | 'sell'` in TS, `enum Side { Buy, Sell }` in Solidity.
- **Status** in TS: `'open' | 'partial' | 'filled' | 'cancelled' | 'failed' | 'unfunded'` (`unfunded`: off-chain order with no covered size). Solidity `Status { None, Open, Filled, Cancelled }`; partial = Open with `filled > 0`.
- **Matching:** price-time priority; market orders carry a worst price = furthest needed level ± slippage (default 100 bps), never rest; `maxLevels` default 20; thin book → caught before sending (no tx), else contract `BookTooThin(filled)`.
- **Off-chain liquidity:** per maker and give-asset, `min(balance, allowance to Settlement)` allocated to their open orders oldest first; shown at covered size; uncovered → `unfunded`, hidden from the book; matching uses the same allocation.
- **Attempts journal:** every tx a venue sends (`place`, `settle`, `cancel`) is written to the store table `attempts` before sending and updated with its outcome; a reverted one is a `failed` order with id `tx:<hash>`; no block scans anywhere.
- **Store keys:** everything keyed by `[chainId, venueAddress, …]` so forks, imports and two deploys never mix.
- **Copy (verbatim where shown in the mockup):** "Order book", "tick 0.0001", "Click a level to load its price", "Depth", "bids", "asks", "Recent trades", "Buy GBP"/"Sell GBP", "Limit", "Market", "Limit price", "Amount", "25%", "50%", "75%", "Max", "You pay", "Available", "Buy 5,000 GBP" (form submit pattern), "My orders", "All", "Open", "Failed", "Order", "Side", "Price", "Filled / size", "Status", "Report →", "Cancel", the allowance note "OrderBook can spend {x} {SYM} of yours; this order needs {y} {SYM}. Approve more or …" (for Off-chain: "Settlement can spend …"). Venue switch labels: "On-chain" / "Off-chain".
- **Web:** tokens only (no raw colours; contrast tests pass), three themes, phone width; no new runtime deps in `packages/web` beyond workspace `@evmb/orderbook`; real data only.
- **Benchmark (ephemeral) chains:** venue deploys and the Trade page are disabled with "Benchmark chains keep no contract records".
- **Data design:** capture at origin (contract stores `filled`, `status`, `closedBlock`, per-owner ids; Settlement stores `filled`/`cancelled` per hash); flag any O(n) read as a risk with a backlog card referencing ADR-0018.
- **Every task end:** `bun test` from `evm-benchmarks` (R11 exit crash may follow passing tests — rerun once and say so), `make build`, tsc on changed files: `bunx --package typescript@5 tsc --noEmit --strict --jsx react-jsx --moduleResolution bundler --module esnext --target es2022 --skipLibCheck --resolveJsonModule <files>` (ignore TS5097 and the known Studio/templates errors). Every test disposes every chain/node it creates.
- **Docs only in `evm-benchmarks/docs/`:** board t-64 (Doing; Done in the last task, real `date -u`), ADR-0018 (extend), risks. Regenerate cards with `node_modules/.bin/{agile,adr,risk-register} card <file> <dir>`.
- **Git:** `git commit --only -m … -- <paths>` (new files `git add -N` first); never commit `design/` or files Aaron has modified; commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; git writes need `dangerouslyDisableSandbox: true`. A task that changes `bun.lock` commits it in its own commit (`bun install` unsandboxed).

## Review Focus

1. **Over-promised off-chain liquidity.** Alice: two 5,000 GBP asks, 6,000 GBP balance → book shows 5,000 + 1,000, second order "partial cover", matching a 7,000 buy fills 6,000 at most and never sends a settle that reverts for balance. Pinned by Task 2 (pure allocation) and Task 6 (real chain) tests.
2. **Rounding across decimals.** GBP 2 dp / USD 6 dp and an 18-dp base: taker pays rounded up, receives rounded down, contract and package agree to the unit. Pinned by Task 2 and Task 3 tests.
3. **Market order on a thin or moving book.** Too thin when read → no tx, form error; thinned between read and send → `BookTooThin`, a `failed` attempt with a report; a market buy refunds unspent escrow in the same tx. Pinned by Tasks 3 and 5.
4. **Fork / second deploy.** A forked chain's off-chain book shows the parent's signed orders only if the same Settlement address and chain id key them — never another chain's; `filled` comes from the fork's chain. Pinned by a Task 6 test with two Settlement deploys and a Task 8 web test with `createFrom`.
5. **Resume a walkthrough mid-book.** Reload after Alice's first order: the second step doesn't re-place it. Pinned by Task 10 (headless resume like Plan 9's).

---

### Task 1: Package and persistence API

**Files:** Create `packages/orderbook/{package.json,README.md,src/index.ts,src/store.ts,test/store.test.ts}`; root workspace picks it up.

**Interfaces — Produces:**
- `type IndexKey = (string | number)[]`; `type Schema = Record<string, { indexes: Record<string, (v: any) => IndexKey> }>`
- `interface Store { get<T>(table, key): Promise<T | undefined>; put(table, key, value): Promise<void>; del(table, key): Promise<void>; scan<T>(table, index, range: { from?: IndexKey; to?: IndexKey; reverse?: boolean; limit?: number }): Promise<T[]> }` — `from`/`to` inclusive prefixes compared element by element (a shorter key is a prefix bound).
- `memoryStore(schema: Schema): Store`; `idbStore(name: string, schema: Schema, idb?: IDBFactory): Store` (object store per table, keyPath-less with explicit keys, compound index per entry via a stored `__ix_<name>` array field).
- `bookSchema: Schema` — `orders` {indexes: `book` = `[chainId, venue, base, quote, side, priceKey, seq]`, `owner` = `[chainId, venue, owner, seq]`}, `attempts` {indexes: `owner` = `[chainId, venue, owner, seq]`}, `meta` {} (holds the `seq` counter). `priceKey`: asks = price as a zero-padded decimal string; bids = `(2^256−1 − price)` zero-padded, so both scan best first ascending.

- [ ] Board: t-64 is already Doing.
- [ ] Failing tests — one conformance suite run against `memoryStore` and `idbStore` (with `fake-indexeddb` passed as `idb`): put/get/del; scan by index ascending, `reverse`, `limit`, prefix `from`/`to`; best-first order for bids and asks via `priceKey` incl. a 78-digit price; two venues' rows never cross a `[chainId, venue]` prefix; overwriting a row moves it in its index.
- [ ] `bun install` (unsandboxed) for `fake-indexeddb`; commit `bun.lock` alone. RED → implement → GREEN. Commit.

### Task 2: Pure core — types, price maths, matcher, allocation

**Files:** Create `packages/orderbook/src/{types.ts,price.ts,match.ts,allocate.ts}`, tests `test/{price,match,allocate}.test.ts`.

**Interfaces — Produces:** the spec's `Side`, `Market`, `OrderInput`, `Order`, `Level`, `Trade`, `PlaceResult`, `Wallet`, `OrderReport` types (Order.status per Global Constraints; `OrderReport = { order: Order; fills: Trade[]; cancelled?: { tx?: Hex; block?: bigint }; failure?: { tx: Hex; error: string; args: unknown[]; fix?: string } }`); `quoteFor(...)`, `tickOf(quoteDecimals)`, `priceText(price, quoteDecimals)` (4 dp), `parsePrice(text, quoteDecimals)` (rejects non-tick values); `type Resting = { id: string; owner: Address; side: Side; price: bigint; remaining: bigint; seq: number }`; `match(taker: { side; price?: bigint; amount: bigint }, resting: Resting[] /* opposite side, best first */, maxLevels: number) → { fills: { id; price; amount }[]; filled: bigint; levels: number; thin: boolean }`; `worstPrice(fills, side, slippageBps)`; `levels(resting, depth) → Level[]`; `allocate(orders: Resting[] /* one maker+asset, any order */, available: bigint, giveOf: (o) => bigint) → Map<id, covered remaining>` (oldest seq first; for buy orders `giveOf` is the quote needed, rounded up).
- [ ] Failing tests: Review Focus 1 (two 5,000 asks, 6,000 available → 5,000 + 1,000) and 2 (2 dp/6 dp and 18 dp; up/down rounding); price-time (same price → lower seq first); limit stops at its price; `maxLevels` cap sets `thin`; market `worstPrice` ± 100 bps; `parsePrice('1.27051', 6)` rejected, `'1.2705'` → `1270500n`; `levels` totals cumulate best first.
- [ ] RED → implement → GREEN. Commit.

### Task 3: `OrderBook.sol`

**Files:** Create `packages/contracts/src/OrderBook.sol`; modify `build.ts` (`names`), `index.ts` (export `OrderBook`); regenerate artifact; extend `contracts.test.ts`.

**Interfaces — Produces** (Solidity, exactly): `enum Side { Buy, Sell }`, `enum Status { None, Open, Filled, Cancelled }`; `struct Order { address owner; address base; address quote; Side side; Status status; uint64 closedBlock; uint256 price; uint256 amount; uint256 filled; }`; `uint256 public nextId` (starts 1); `function orders(uint256) external view returns (Order memory)`; `function ordersOf(address owner) external view returns (uint256[] memory)`; `function place(address base, address quote, Side side, uint256 price, uint256 amount, uint256 maxLevels, uint256 hint, bool rest) external returns (uint256 id)`; `function cancel(uint256 id) external`; views `best(address base, address quote, Side side) returns (uint256 price)` (0 = empty), `level(address base, address quote, Side side, uint256 price) returns (uint256 prev, uint256 next, uint256 size, uint256 count)`, `levelOrders(address base, address quote, Side side, uint256 price) returns (uint256[] memory)`; events `OrderPlaced(uint256 indexed id, address indexed owner, address base, address quote, Side side, uint256 price, uint256 amount)`, `Trade(uint256 indexed makerId, uint256 indexed takerId, address maker, address taker, uint256 price, uint256 amount, uint256 quoteAmount)`, `OrderCancelled(uint256 indexed id)`; errors `OrderNotOpen(uint256 id, Status status)`, `NotOwner(uint256 id)`, `BadOrder()`, `BookTooThin(uint256 filled)`.
- Behaviour: escrow give side on `place` (buy escrows `quoteFor(amount, price, up)`); match opposite side best first, FIFO per level, up to `maxLevels`, each fill pays maker and taker (taker buy pays maker's price, refunds the difference to its own limit); `rest=true` rests the remainder at `price` (insert using `hint`, bounded walk otherwise), `rest=false` (market) requires full fill else `BookTooThin(filled)` and refunds unspent quote; `cancel` returns remaining escrow, sets `closedBlock`. SafeERC20, ReentrancyGuard, checks-effects-interactions.
- [ ] Failing tests (two `AssetToken`s, GBP 2 dp / USD 6 dp): rest + read back via `best`/`level`/`levelOrders`/`ordersOf`; cross two levels with a partial on the second (balances exact, `Trade` events, statuses); price improvement refund for a taker buy above the ask; market buy full fill refunds unspent; market `BookTooThin` reverts and moves nothing; cancel by owner returns escrow, by other `NotOwner`; take of cancelled `OrderNotOpen`; `BadOrder` for zero price/amount, same token, zero address; bad hint still inserts correctly.
- [ ] RED → implement, build, export → GREEN. Commit.

### Task 4: `Settlement.sol` and EIP-712

**Files:** Create `packages/contracts/src/Settlement.sol` (+ build/export/test as Task 3); create `packages/orderbook/src/eip712.ts`, `test/eip712.test.ts`.

**Interfaces — Produces:** Solidity: `struct Order { address maker; address base; address quote; uint8 side; uint256 price; uint256 amount; uint256 nonce; uint256 expiry; }`; EIP-712 domain `{ name: 'EVMB Settlement', version: '1', chainId, verifyingContract }`; `function hashOrder(Order calldata o) external view returns (bytes32)`; `mapping(bytes32 => uint256) public filled`; `mapping(bytes32 => bool) public cancelled`; `function settle(Order[] calldata makers, bytes[] calldata sigs, uint256[] calldata fills) external` (taker = `msg.sender`; all makers same market and side; for each: signature by `maker`, not expired, not cancelled, `filled + fill ≤ amount`; moves base and quote with `transferFrom` between maker and taker at the maker's price, rounding per Global Constraints); `function cancel(Order calldata o) external` (maker only); events `Trade(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 price, uint256 amount, uint256 quoteAmount)`, `OrderCancelled(bytes32 indexed orderHash)`; errors `BadSignature(uint256 i)`, `Expired(uint256 i)`, `Overfill(uint256 i, uint256 remaining)`, `OrderNotOpen(bytes32 hash)`, `NotMaker()`, `BadOrder()`. TS: `orderTypes`, `domainOf(chainId, settlement)`, `hashOrder(o, domain)` (viem `hashTypedData`), `signOrder(wallet, o, domain)`.
- [ ] Failing tests: TS `hashOrder` equals the contract's for the same order; settle one and two makers (partial) moves exact balances and records `filled`; wrong signer `BadSignature(0)`; expired `Expired`; overfill `Overfill`; cancelled `OrderNotOpen`; maker short of balance or allowance reverts with the OZ ERC-20 error and moves nothing; non-maker cancel `NotMaker`.
- [ ] RED → implement → GREEN. Commit.

### Task 5: On-chain venue

**Files:** Create `packages/orderbook/src/{venue.ts,calls.ts,attempts.ts,report.ts,onchain.ts}`, `test/onchain.test.ts` (+ a `test/chain.ts` helper like `packages/swap/test/chain.ts`, deploying GBP, USD, OrderBook, Settlement).

**Interfaces — Produces:** `interface Venue` per spec (`kind`, `book`, `place`, `cancel`, `orders`, `trades`, `report`); `onchainVenue(o: { request: Request; chainId: number; address: Address; store: Store }): Venue`; `calls.ts` calldata builders `placeCall`, `cancelCall` (shared with the benchmark); `attempts.ts` `journal(store, ctx).begin(input, owner) → seq` / `.end(seq, { tx, status, error })` / `.failed(owner)`; `report.ts` builds `OrderReport` from the order's on-chain record and `Trade` logs **narrowed to the blocks the order's txs landed in** (its place tx and the takers' fill blocks are found from `Trade` logs filtered by the indexed order id — a topic-filtered `eth_getLogs`, not a block scan), and for failures replays the call at the parent block (Swap's approach) with fix copy for allowance/balance/thin book.
- `book()` walks `best` → `level.next` up to `depth` (default 10); `orders({owner})` reads `ordersOf` then `orders(id)`; `trades(m, limit)` reads `Trade` logs from the venue's deploy block (taken from its contract record's tx; ponytail-flag as an O(chain) read with a risk); `place` computes `hint` from the book it read and, for market orders, the worst price and pre-checks thinness (no tx).
- [ ] Failing tests on a real chain: place/rest/read book; cross with partial; `orders` statuses incl. `partial`; market buy too thin → no tx, error; thinned between read and send (another order consumes it first) → `failed` attempt `tx:<hash>` whose report says `BookTooThin`; allowance short → failed attempt, report fix "Approve OrderBook to spend at least …"; cancel; `report` for a filled order lists both fills.
- [ ] RED → implement → GREEN. Commit.

### Task 6: Off-chain venue

**Files:** Create `packages/orderbook/src/offchain.ts`, `test/offchain.test.ts`.

**Interfaces — Produces:** `offchainVenue(o: { request: Request; chainId: number; address: Address /* Settlement */; store: Store }): Venue`. `place`: read resting opposite orders from `orders.book`, refresh each one's on-chain `filled`/`cancelled` and its maker's balance/allowance, `allocate`, `match`; if anything crosses, send one `settle` (journalled); sign and store the remainder of a limit order (`expiry` = now + 7 days, `nonce` = store seq); market orders never rest. `cancel`: on-chain `cancel(order)` (journalled) and mark the stored row. `book()` uses the same refresh + allocation (shown at covered size). `orders({owner})` from the `owner` index + attempts, statuses incl. `unfunded`.
- [ ] Failing tests on a real chain: Review Focus 1 (two 5,000 asks, 6,000 balance → book 5,000 + 1,000; a 7,000 buy fills 6,000 via one settle, never reverting for balance); Review Focus 4 (two Settlement deploys on one chain and a second chain id: books never mix); place without crossing sends no tx; crossing two makers settles in one tx with exact balances; a maker who spends their GBP elsewhere drops out of the book (`unfunded`); cancel; failed settle (taker allowance short) → `failed` attempt with report fix "Approve Settlement to spend at least …".
- [ ] RED → implement → GREEN. Commit.

### Task 7: Benchmark scenarios

**Files:** Create `packages/core/src/scenarios/book-match.ts`; modify `packages/core/src/scenarios/index.ts` (ids `book-match-onchain`, `book-match-offchain`), `packages/core/package.json` (dep `@evmb/orderbook`), `packages/core/test/scenarios.test.ts`.
- Shape like `offer-fill`: setup deploys GBP-like/USD-like `MintableToken`s and the venue, funds and approves makers and takers, places N resting asks (on-chain `place` txs; off-chain signed orders built with `signOrder` and matched in setup with the pure `match`); timed: N takes from disjoint takers (on-chain `place` crossing one ask each; off-chain one `settle` each). Verify: every resting order filled and totals exact. The scenario detail text says "off-chain matching runs untimed in setup".
- [ ] Failing test (as `offer-fill`'s): both scenarios run and verify on approach 01 with small n; appear in `scenarios` (CLI and Benchmark page pick them up). `bun install` if the dep changes `bun.lock` (commit it alone). RED → implement → GREEN. Commit.

### Task 8: Web — locate, deploy, Wallet, Trade page shell and book

**Files:** Create `packages/web/src/orderbook/{locate.ts,store.ts,wallet.ts,ui.ts}`, `packages/web/src/pages/Trade.tsx`, `packages/web/src/components/{OrderBookPanel,DepthChart,RecentTrades}.tsx`; modify `App.tsx` (sidebar "Trade" under Markets after Swap, route `/trade`, `TradeIcon`), `pages/Studio.tsx` (Deploy OrderBook.sol / Deploy Settlement.sol, as Deploy Swap.sol), `packages/web/package.json` (dep `@evmb/orderbook`); tests `test/trade.test.ts`.

**Interfaces — Produces:** `venueFor(chain, kind): Promise<Address | undefined>` (newest contract record named `OrderBook` / `Settlement` with a matching ABI, as `swapFor`); `deployVenue(chain, kind, from, onSent?) → Address`; `bookStore` (one `idbStore('evmb-orderbook', bookSchema)` per app, memory fallback when IndexedDB is unavailable); `walletOf(chain, account): Wallet` (uses `signAndSend` and viem `signTypedData` with the account's key); `useVenue(chain, kind)` hook → `Venue | undefined | null`.
- Trade page per the mockup and spec "Web": header (market picker over the chain's ERC-20 pairs with `?base=&quote=`, swap-sides button, last price "last · USD per GBP", spread + bps, chain, venue switch On-chain/Off-chain in `?venue=`), Order book panel (asks red above, mid row with spread, bids green below, price/size/total, depth bars, "tick 0.0001", "Click a level to load its price" — loads the form's price), Depth chart (two step areas + mid marker, tokens `bid`/`ask`), Recent trades (price / size / block). Missing venue → "Deploy OrderBook.sol?" / "Deploy Settlement.sol?"; benchmark chain disabled.
- [ ] Failing tests: `venueFor`/`deployVenue` like `swap-locate.test.ts`; a forked chain (`createFrom`) keeps its own venue record and its off-chain store rows keyed by its own chain id (Review Focus 4); SSR of Trade without a chain → "Select a chain first."; `ui.ts` pure helpers (spread bps, depth points) unit-tested.
- [ ] RED → implement → GREEN. Commit.

### Task 9: Web — order form, My orders, reports

**Files:** Create `packages/web/src/components/{OrderForm,MyOrders}.tsx`; modify `pages/Trade.tsx`; modify `pages/SwapReport.tsx` only to extract its layout into a shared component if needed (`components/ReportView.tsx`), plus route `/trade/report?id=&venue=`; tests extend `test/trade.test.ts`.
- Order form per the mockup: Buy/Sell, Limit/Market, limit price (tick-checked), amount with 25/50/75/Max of available, "You pay" (market: "≈ … , at most …"), "Available", slippage field under Market (default 1%), the allowance warning with "Approve more" (exact shortfall to the venue contract) and the submit button text pattern. Submit → `venue.place`; flash with "View report →". Thin market book → inline error, no tx.
- My orders: All / Open / Failed filters; columns per mockup; `unfunded` badge; Cancel on open/partial own orders; Report → for others.
- [ ] Failing tests: form maths pure helpers (pay/at-most, percent buttons, allowance shortfall) unit-tested; SSR renders the form copy and filters; report view renders a fill and a failure fixture.
- [ ] RED → implement → GREEN. Commit.

### Task 10: Walkthroughs for both venues

**Files:** Modify `packages/web/src/walkthrough/{types,validate,resolve,run,bindings}.ts` and the Trade page/components for bindings; create `packages/web/walkthroughs/{gbp-usd-book-onchain,gbp-usd-book-offchain}.json` and list them in `walkthroughs/index.ts`; extend `test/walkthroughs.test.ts`, `test/walkthrough-format.test.ts`, `test/wizard-pages.test.ts`; update `walkthroughs/README.md`.
- New step types: `deployVenue` (`args: { from, venue: 'onchain' | 'offchain' }`, key kind `venue`), `placeOrder` (`args: { from, venue: $venue, side, type, price?, amount: "N $BASE", quote: $QUOTE }`, key kind `order`), `cancelOrder` (`args: { from, order: $order }`). `approve` gains `before` → a `placeOrder` step (spender = that venue's contract). Outputs: `deployVenue {address, venue}`, `placeOrder {orderId, tx?, filled: string}`, `cancelOrder {tx}`. Checks: `{ order: $order, status, filled?: "N $BASE" }`, `{ trades: $venue, count }`.
- Bindings on Trade: path `/trade?venue=&base=&quote=`; fields `order.side|type|price|amount`; actions `trade.deploy`, `order.approve`, `order.submit`, `order.cancel` (with field `cancel.order`); report on success (and on a failed attempt as an error).
- Both files: Alice and Bob, GBP/USD; Alice places two asks; Bob buys across both with one order (partial on the second); checks fills, the remaining order and balances. Review Focus 5 (resume mid-book) test.
- [ ] RED → implement → GREEN. Commit.

### Task 11: Docs and checklist

**Files:** `packages/orderbook/README.md` (layers, `Venue` API, `Store` API, both venues, liquidity rule, attempts, reports, how the benchmark compares them); board t-64 Done; ADR-0018 consequences; risks for: `trades()` log read from deploy block (O(chain)), off-chain book read O(makers) balance/allowance calls, `idbStore` only tested with `fake-indexeddb`; backlog cards referencing ADR-0018. Browser checklist in the task report (both venues by hand and by walkthrough, thin market order, unfunded maker, fork, phone width, three themes).
- [ ] Write, regenerate cards, full test + build. Commit.
