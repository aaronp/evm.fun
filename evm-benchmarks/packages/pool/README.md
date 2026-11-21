# @evmb/pool

UI-free helpers for `Pool.sol`, an x · y = k liquidity pool for one unordered pair (ADR-0019). Runtime deps: `viem` and `@evmb/assets` (types only: `Request`). No DOM, React or IndexedDB; nothing cached, everything read from the chain.

## The contract

`Pool.sol` is one contract per pair and is its own LP token (ERC-20 "PLP", name built from the two tokens). Constructor `(base, quote)`; `BadToken` for decimals above 18 and for a zero or identical token address.

```solidity
function reserves() view returns (uint256, uint256)
function addLiquidity(uint256 baseIn, uint256 quoteIn, uint256 minShares) returns (uint256 shares)
function removeLiquidity(uint256 shares, uint256 minBase, uint256 minQuote) returns (uint256 base, uint256 quote)
function swap(address tokenIn, uint256 amountIn, uint256 minOut) returns (uint256 amountOut)
event LiquidityAdded(provider, base, quote, shares)  event LiquidityRemoved(provider, base, quote, shares)
event Swapped(trader, tokenIn, amountIn, amountOut, reserveBase, reserveQuote)  // post-swap reserves
error BadAmount()  error BadToken()  error Slippage(out, min)  error NoLiquidity()
```

- **Swap:** 30 bps fee on the input. `inWithFee = amountIn·9970`; `out = inWithFee·Rout / (Rin·10000 + inWithFee)`, rounded down; `out < minOut` reverts `Slippage(out, minOut)`. k never decreases.
- **LP shares are in 18-dp whole units** whatever the token decimals. First deposit: `floor(sqrt(baseIn·10^(18-db) · quoteIn·10^(18-dq))) - 1000`; the 1,000 raw units are locked at `0x...dEaD` (v2's guard). Later deposits: `shares = min(baseIn·S/Rb, quoteIn·S/Rq)` (floor).
- **The first deposit pulls the full amounts offered** and reverts `BadAmount` if the square root is 1,000 or less (nothing left to mint). **Later adds pull only the proportional amounts**, rounded up: `baseUsed = ceil(shares·Rb/S)`, `quoteUsed = ceil(shares·Rq/S)`, never more than offered, so the pool never loses to rounding. `minShares` protects the depositor.
- **Remove** pays `shares·Rb/S` and `shares·Rq/S`, floored (one side may round to 0; only 0 shares reverts `BadAmount`).
- **Reserves are tracked in storage**, not read from `balanceOf`, so a donation to the pool does not move the price.

## Units and display

Prices are quote raw units per one whole base unit (same as `@evmb/orderbook`), floored. For display, build the price from an exact rational of the reserves (orderbook units collapse when the quote token has few decimals, e.g. USD per GBP at 2 dp) and round **half-up to 4 dp** (`priceText` in `@evmb/swap`, e.g. 1.2537). LP amounts display **half-up to 2 dp** (56,347.14 where truncation gives .13). `fee` is 30 bps of the input, in the input token.

`impactBps` (number, 0.01 bp precision) is Uniswap's definition: the execution price **excluding the fee** against the current price, `amountIn / (rIn + amountIn)`. It is not the move of the pool price (about double for the same trade).

## Unordered pair

A pool belongs to {A, B}, not to a direction. `findPool` matches either order, the newest record wins, and deploying must be refused when a pool for the pair exists in either order. `orient(state, base, quote)` returns the state as the page sees it (reserves, decimals and so prices flip when reversed); every quote works on an oriented state. Add/remove calls and activity amounts use the pool's on-chain order: keep the unoriented state for `addLiquidityCall` / `removeLiquidityCall` and map activity back for a reversed pool.

## API

- **Identity:** `poolAbi` (embedded copy; a test pins it to `@evmb/contracts`), `isPoolAbi(abi)`, `findPool(request, records, a, b)`: records in deploy order (newest last); the newest `Pool` record whose on-chain `base()`/`quote()` are {a, b} in either order wins. Only "no code" and decode failures (and reverts) skip a record; transport/RPC errors propagate, otherwise a flaky node could make the page offer a duplicate deploy.
- **Reads:** `readPool(request, pool)` returns `PoolState` (tokens, decimals, reserves, LP supply incl. the 1000 locked shares). `position(request, state, owner)` returns `{ shares, shareBps, base, quote }` (what removing all would pay).
- **Maths (mirrors the contract to the raw unit):** `amountOut`, `quoteSwap(state, tokenIn, amountIn, slippageBps)` returns `{ out, fee, price, priceNow, priceAfter, impactBps, minOut }`; `quoteAdd(state, baseIn, quoteIn)` returns `{ shares, baseUsed, quoteUsed }` (`shares` 0 means the contract reverts `BadAmount`); `quoteRemove(state, shares)`; `poolPrice(state)`; `isqrt` (= OZ `Math.sqrt`).
- **Calls:** `addLiquidityCall(pool, baseIn, quoteIn, minShares)`, `removeLiquidityCall(pool, shares, minBase, minQuote)`, `swapCall(pool, tokenIn, amountIn, minOut)` return `{to, data}`. Approve the pool for the amounts pulled first.
- **Errors:** `decodePoolError(data)` decodes `BadAmount`, `BadToken`, `Slippage(out, min)`, `NoLiquidity`, OpenZeppelin ERC-20 errors, `Error(string)`, `Panic(uint256)`, else `undefined`.
- **Activity:** `activity(request, pool, fromBlock)` lists `add` / `remove` / `swap` events newest first; a swap's `base`/`quote` are the post-swap reserves. It reads every event since `fromBlock` (the deploy block) per call, so its cost grows with the chain (ADR-0019, R36).

## Guards callers must apply

The quotes do not refuse what the contract would revert. Before sending: swap `out` is 0 (dust input), remove of 0 shares, remove of more than the holder's balance, a token that is not one of the pool's two, an add whose `shares` is 0.

```ts
import { findPool, readPool, orient, quoteSwap, swapCall } from '@evmb/pool'

const pool = await findPool(request, records, gbp, usd)
const state = await readPool(request, pool!)
const q = quoteSwap(orient(state, gbp, usd), gbp, 100_000n, 50) // 1,000.00 GBP in, 0.5% slippage
if (q.out > 0n) await send(trader, swapCall(pool!, gbp, 100_000n, q.minOut)) // approve the pool for GBP first
```

Limits: fee-on-transfer and rebasing tokens unsupported (R40); price can skew at dust reserves (R38); products could overflow uint256 for enormous supplies (R39).

Tests: `bun test packages/pool`.
