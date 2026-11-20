# @evmb/orderbook

UI-free order-book venues for the playground. No DOM or React; no dependency on `@evmb/core` or any approach package.

## Layers

1. **Store** (`store.ts`): `get/put/del/scan` over memory or IndexedDB; no chain knowledge.
2. **Core** (pure): `price.ts` (`quoteFor`, tick, `worstPrice`), `match.ts` (price-time matcher, `thin`), `allocate.ts` (per-maker liquidity cap).
3. **Calls and signing**: `calls.ts` (calldata for `OrderBook`/`Settlement`, shared with the benchmark), `eip712.ts` (typed data, `signOrder`), `attempts.ts` (the journal), `report.ts` (replay and fixes).
4. **Venues**: `onchainVenue` and `offchainVenue` implement `Venue` on top of the layers above. The web app and walkthroughs only use `Venue`; the benchmark uses layers 2-3 directly.

Prices are integer quote raw units per one whole base unit; a fill's quote is `amount * price / 10^baseDecimals`, the taker pays it rounded up and receives it rounded down (the resting order's favour).

## Store

Persistence API for the off-chain venue; one conformance suite runs against both implementations.

- `Store`: `get(table, key)`, `put(table, key, value)`, `del(table, key)`, `scan(table, index, { from?, to?, reverse?, limit? })`. `from`/`to` are inclusive index-key prefixes compared element by element (a shorter key bounds all keys beginning with it). Scans are O(log n + k).
- `memoryStore(schema)`: sorted arrays that clone rows on put/get/scan (like IndexedDB), for tests and benchmarks.
- `idbStore(name, schema, idb = indexedDB)`: one IndexedDB object store per table with explicit keys (needs the global `IDBKeyRange`: native in browsers, `fake-indexeddb/auto` in tests); each index is a compound index over a stored `__ix_<name>` array field.
- `bookSchema`: `orders` (`book` = `[scope, venue, base, quote, side | 'closed', priceKey, seq]`, `owner` = `[scope, venue, owner, seq]`), `attempts` (`owner` = `[scope, venue, owner, seq]`), `meta` (the seq counters). `scope` is the app's id for the chain (unique per playground chain and per fork), not the EVM chain id: playground chains all use 31337 and a fresh chain deploys the venues at the same addresses. `priceKey(side, price)` gives the zero-padded key so both sides scan best first ascending.

## EIP-712 (off-chain orders)

Typed data for `Settlement.sol` (`@evmb/contracts`). An off-chain order is a `SignedOrder` `{maker, base, quote, side, price, amount, nonce, expiry}` (`side` 0 = buy, 1 = sell, of the maker; `expiry` unix seconds); its id is its typed-data hash.

- `orderTypes`, `domainOf(chainId, settlement)` (`EVMB Settlement`, version `1`).
- `hashOrder(o, domain)`: equals the contract's `hashOrder`.
- `signOrder(wallet, o, domain)`: signs with `wallet.signTypedData`; the taker passes the order and signature to `settle`.

## Venue

`Venue` (`src/venue.ts`) is what the page talks to: `book(m, depth = 10)`, `place(wallet, input)`, `cancel(wallet, id)`, `orders({ owner, market?, status? })`, `trades(m, limit = 50)` (newest first), `committed(owner, asset)`, `report(id)`.

- `OrderInput`: `{ market, side, type, price?, amount, slippageBps? }`; `slippageBps` (default 100) only applies to market orders on-chain (the off-chain venue ignores it). `place` returns `{ order?, fills, tx?, reverted? }`; `order` is undefined when nothing rests (a market order, or a taker fully filled).
- `orders` **requires an `owner`** (the only consumer is "My orders"); status is `open | partial | filled | cancelled | failed | unfunded`. An expired off-chain order shows as `cancelled`.
- `committed(owner, asset)`: what the owner's other live orders still claim of `asset` from the same balance and allowance. Off-chain: the remaining give of open, partial and unfunded orders; on-chain 0 (escrowed at placement). A new order's allowance need is its own give plus this.
- `scope` is the app's id for a chain (the registry chain id), the first element of every store key. It is not the EVM chain id, which only enters the EIP-712 domain: playground chains are all 31337 and a fresh chain deploys at the same addresses. A fork gets a new scope and starts with an empty book and journal.

- `onchainVenue({ request, scope, address, store, fromBlock?, maxLevels = 20 })` drives `OrderBook.sol`. `book` walks `best` → `level.next`; `orders` reads `ordersOf` then `orders(id)` (owner required), plus the owner's failed attempts; `report` narrows `Trade` logs to the order's place..close blocks by its indexed id. `place` reads the opposite side, matches it with `match`, and throws without sending when the book is too thin (market orders: any shortfall; limit: the level cap) or the allowance/balance is short of what it needs (buy: `quoteFor(amount, price, up)` + one raw unit per expected fill; sell: `amount`). Market orders send `worstPrice(fills, side, slippageBps = 100)`; a resting remainder gets the adjacent better level as its `hint`. `trades` reads every `OrderPlaced`/`Trade` since `fromBlock` (the deploy block): O(chain history), flagged.
- `offchainVenue({ request, chainId, scope, address, store, maxLevels = 20 })` drives `Settlement.sol` (`chainId` only for the EIP-712 domain). Makers sign (no gas); rows live in `orders` under `<scope>:<hash>`, `nonce` = the store seq, `expiry` = now + 7 days. Fills and cancels are read from the chain per order; each maker's give-asset `min(balance, allowance to Settlement)` covers their open orders oldest first (`allocate`), and `book` and matching both use that covered size, so an uncovered order is `unfunded` and hidden. `place` matches, never produces a fill whose quote rounds to 0, sends one journalled `settle` when anything crosses, then signs and stores a limit order's remainder (a market order never rests; `order` is undefined when nothing rests). A row the chain says is filled, cancelled or expired (shown as cancelled) is marked `closed` and leaves the book index. `trades` reads every Settlement `Trade` log: O(history), flagged.
- `settleCall` / `settlementCancelCall`, `settlementAbi`.
- `placeCall` / `cancelCall` (`src/calls.ts`): calldata builders shared with the benchmark; `orderBookAbi` is the subset the package uses.
- `journal(store, { scope, venue })` (`src/attempts.ts`): the `attempts` table both venues share. `begin(input, owner)` before sending, `end(seq, { tx, block, status, error })` after; `failed(owner)` lists reverted ones, which show as orders with status `failed` and id `tx:<hash>`. When `place` replays a revert it stores the decoded error name on the attempt, and the failed order carries it as `reason` (e.g. `ERC20InsufficientAllowance`); attempts without one have no `reason`.
- `replayError`, `fixFor`, `amountText` (`src/report.ts`): a failed tx is replayed at its parent block (Swap's approach) and the fix names the shortfall ("Approve OrderBook to spend at least 127.00 USD, then place the order again.") or the thinned book.

## Both venues, side by side

| | On-chain (`OrderBook.sol`) | Off-chain (`Settlement.sol`) |
|---|---|---|
| Where orders live | the contract (escrowed) | signed, in the `Store`; makers keep custody |
| Placing | one `place` tx | signing is free; one `settle` tx only when something crosses |
| Payment | the taker pays each maker per fill (ceil per fill) and escrows only its resting part | `transferFrom` maker and taker in `settle` |
| Fill / cancel truth | contract state | chain state (`filled`, `cancelled` per hash), read per order |
| Liquidity shown | remaining size | remaining, capped per maker: `min(balance, allowance to Settlement)` allocated to their open orders oldest first; uncovered orders are `unfunded` and hidden |
| Expiry | none | chain time (latest block timestamp), shown as `cancelled` |
| Zero-quote fills | favour the resting order (as the contract) | never produced off-chain |

A buy's allowance need is `quoteFor(amount, price, up)` plus one raw unit per fill (each fill rounds up). Limits and caveats are logged as risks R26-R33 (`docs/risks/risks.md`).

## Attempts and failed orders

Every tx a venue sends (`place`, `settle`, `cancel`) is journalled before sending and updated with its outcome. A reverted attempt is a `failed` order (`tx:<hash>`) whose `reason` is the decoded error name; failures survive reload and an Acting-as switch and nothing scans blocks. A broadcast whose wait throws is journalled without a hash (R32).

## Reports

`report(id)` returns plain data: the order, its fills (tx, block, counterparty, price, amount), the cancellation, and for a failed attempt the replayed error with a fix. A fully filled off-chain taker order has no id of its own, so it links to its tx instead of a report.

## How the benchmark compares the venues

`book-match-onchain` and `book-match-offchain` pre-build raw txs from `calls.ts` and `eip712.ts`. Only the transactions are timed: on-chain `place` against off-chain `settle`. Off-chain matching, signing and store reads run in setup and are not timed. That is the point of the comparison: the off-chain venue moves matching out of the transaction, and the reports say the timings exclude it.
