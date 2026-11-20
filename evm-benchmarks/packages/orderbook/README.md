# @evmb/orderbook

UI-free order-book venues for the playground (skeleton; completed in a later task). No DOM or React; no dependency on `@evmb/core` or any approach package.

## Store

Persistence API for the off-chain venue; one conformance suite runs against both implementations.

- `Store`: `get(table, key)`, `put(table, key, value)`, `del(table, key)`, `scan(table, index, { from?, to?, reverse?, limit? })`. `from`/`to` are inclusive index-key prefixes compared element by element (a shorter key bounds all keys beginning with it). Scans are O(log n + k).
- `memoryStore(schema)`: sorted arrays that clone rows on put/get/scan (like IndexedDB), for tests and benchmarks.
- `idbStore(name, schema, idb = indexedDB)`: one IndexedDB object store per table with explicit keys (needs the global `IDBKeyRange`: native in browsers, `fake-indexeddb/auto` in tests); each index is a compound index over a stored `__ix_<name>` array field.
- `bookSchema`: `orders` (`book`, `owner` indexes), `attempts` (`owner`), `meta` (holds the `seq` counter). `priceKey(side, price)` gives the zero-padded key so both sides scan best first ascending.
