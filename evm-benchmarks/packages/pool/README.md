# @evmb/pool

UI-free helpers for `Pool.sol` (x · y = k liquidity pool for one unordered pair, ADR-0019). Runtime deps: `viem` and `@evmb/assets` (types only: `Request`). No DOM, React or IndexedDB; nothing cached, everything read from the chain.

- **Identity:** `poolAbi` (embedded copy; a test pins it to `@evmb/contracts`), `isPoolAbi(abi)`, `findPool(request, records, a, b)`: records in deploy order (newest last); the newest `Pool` record whose on-chain `base()`/`quote()` are {a, b} in either order wins; records with no code, undecodable data or a revert are skipped, transport/RPC errors propagate.
- **Reads:** `readPool(request, pool)` → `PoolState` (tokens, decimals, reserves, LP supply incl. the 1000 locked shares). `position(request, state, owner)` → `{ shares, shareBps, base, quote }` (what removing all would pay).
- **Maths (mirrors the contract to the raw unit, integer floors):** `amountOut`, `quoteSwap(state, tokenIn, amountIn, slippageBps)` → `{ out, fee, price, priceNow, priceAfter, impactBps, minOut }`, `quoteAdd(state, baseIn, quoteIn)` → `{ shares, baseUsed, quoteUsed }` (first deposit `√(scaled product) − 1000`; later `min` floor with ceil pulls; `shares` 0 means the contract reverts `BadAmount`), `quoteRemove(state, shares)`, `poolPrice(state)`, `isqrt` (= OZ `Math.sqrt`).
- **Units:** prices are quote raw units per one whole base (as `@evmb/orderbook`), floored; format them 4 dp half-up (`priceText` in `@evmb/swap`). `impactBps` (number, 0.01 bp precision) is the move excluding the fee: `amountIn / (rIn + amountIn)`. `fee` is 30 bps of the input, in the input token.
- **Orientation:** `orient(state, base, quote)` returns the state seen from the page's pair (reserves, decimals and so prices flip when reversed); every quote above works on an oriented state. Calls take the pool's on-chain order: keep the unoriented state for `addLiquidityCall` / `removeLiquidityCall`.
- **Calls:** `addLiquidityCall(pool, baseIn, quoteIn, minShares)`, `removeLiquidityCall(pool, shares, minBase, minQuote)`, `swapCall(pool, tokenIn, amountIn, minOut)` return `{to, data}`.
- **Errors:** `decodePoolError(data)` decodes `BadAmount`, `BadToken`, `Slippage(out, min)`, `NoLiquidity`, OpenZeppelin ERC-20 errors, `Error(string)`, `Panic(uint256)`, else `undefined`.
- **Activity:** `activity(request, pool, fromBlock)` lists `add` / `remove` / `swap` events newest first; a swap's `base`/`quote` are the post-swap reserves. It reads every event since `fromBlock` (the deploy block) per call, so its cost grows with the pool's history (ADR-0019).

```ts
import { findPool, readPool, orient, quoteSwap, swapCall } from '@evmb/pool'

const pool = await findPool(request, records, gbp, usd)
const state = await readPool(request, pool!)
const q = quoteSwap(orient(state, gbp, usd), gbp, 100_000n, 50) // 1,000.00 GBP in, 0.5% slippage
await send(trader, swapCall(pool!, gbp, 100_000n, q.minOut))     // approve the pool for GBP first
```

Limits: fee-on-transfer and rebasing tokens unsupported; quotes assume no uint256 overflow (the contract would revert).

Tests: `bun test packages/pool`.
