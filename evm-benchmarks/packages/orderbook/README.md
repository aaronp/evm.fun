# @evmb/orderbook

UI-free order-book venues for the playground. No DOM or React; no dependency on `@evmb/core` or any approach package.

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

`Venue` (`src/venue.ts`) is what the page talks to: `book(m, depth = 10)`, `place(wallet, input)`, `cancel(wallet, id)`, `orders({ owner, market?, status? })`, `trades(m, limit = 50)` (newest first), `report(id)`.

- `onchainVenue({ request, scope, address, store, fromBlock?, maxLevels = 20 })` drives `OrderBook.sol`. `book` walks `best` → `level.next`; `orders` reads `ordersOf` then `orders(id)` (owner required), plus the owner's failed attempts; `report` narrows `Trade` logs to the order's place..close blocks by its indexed id. `place` reads the opposite side, matches it with `match`, and throws without sending when the book is too thin (market orders: any shortfall; limit: the level cap) or the allowance/balance is short of what it needs (buy: `quoteFor(amount, price, up)` + one raw unit per expected fill; sell: `amount`). Market orders send `worstPrice(fills, side, slippageBps = 100)`; a resting remainder gets the adjacent better level as its `hint`. `trades` reads every `OrderPlaced`/`Trade` since `fromBlock` (the deploy block): O(chain history), flagged.
- `offchainVenue({ request, chainId, scope, address, store, maxLevels = 20 })` drives `Settlement.sol` (`chainId` only for the EIP-712 domain). Makers sign (no gas); rows live in `orders` under `<scope>:<hash>`, `nonce` = the store seq, `expiry` = now + 7 days. Fills and cancels are read from the chain per order; each maker's give-asset `min(balance, allowance to Settlement)` covers their open orders oldest first (`allocate`), and `book` and matching both use that covered size, so an uncovered order is `unfunded` and hidden. `place` matches, never produces a fill whose quote rounds to 0, sends one journalled `settle` when anything crosses, then signs and stores a limit order's remainder (a market order never rests; `order` is undefined when nothing rests). A row the chain says is filled, cancelled or expired (shown as cancelled) is marked `closed` and leaves the book index. `trades` reads every Settlement `Trade` log: O(history), flagged.
- `settleCall` / `settlementCancelCall`, `settlementAbi`.
- `placeCall` / `cancelCall` (`src/calls.ts`): calldata builders shared with the benchmark; `orderBookAbi` is the subset the package uses.
- `journal(store, { scope, venue })` (`src/attempts.ts`): the `attempts` table both venues share. `begin(input, owner)` before sending, `end(seq, { tx, block, status, error })` after; `failed(owner)` lists reverted ones, which show as orders with status `failed` and id `tx:<hash>`.
- `replayError`, `fixFor`, `amountText` (`src/report.ts`): a failed tx is replayed at its parent block (Swap's approach) and the fix names the shortfall ("Approve OrderBook to spend at least 127.00 USD, then place the order again.") or the thinned book.
