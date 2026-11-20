# @evmb/swap

UI-free helpers for `Swap.sol` (same-chain escrowed offers, ADR-0016). Runtime deps: `viem` and `@evmb/assets` (types only: `Request`). No DOM, React or IndexedDB. Offers are never cached; they are read from the chain each time.

- **Identity:** `swapAbi` (embedded copy of the contract ABI; a test pins it to `@evmb/contracts`), `isSwapAbi(abi)`, `findSwap(records)` (last record named `Swap` with a Swap ABI wins).
- **Calls:** `makeOfferCall`, `takeCall`, `cancelCall` return `{to, data}`.
- **Reads:** `readOffers(request, swap)` reads `nextId` then `offers(1..nextId-1)`, all statuses; `readOffer(request, swap, id)` reads one. A filled offer carries `taker` (`takerOf(offer)`) and a filled or cancelled one `closedBlock`, stored by the contract in `take` and `cancel`, so who took it and when it closed are O(1) with no log search. `isSwapAbi` also requires `offers(id)` to return this 8-field layout.
- **Book:** `book(offers, base, quote)` gives `asks` (ascending), `bids` (descending), `bestAsk`, `bestBid`, exact `spread` and `escrowed` per token for open offers in the pair. Prices are exact fractions (quote per whole base); ties go to the lowest id. `priceText(price, dp = 4)` formats half-up; `quoteFor(amount, price, baseDecimals, quoteDecimals)` is amount x price rounded half-up to the quote's decimals (throws `Invalid price`).
- **Errors:** `decodeSwapError(data)` decodes `OfferNotOpen`, `NotMaker`, `BadOffer`, `ERC20InsufficientAllowance`, `ERC20InsufficientBalance`, Solidity `Error(string)` and `Panic(uint256)`, else `undefined`.
- **Reports:** `takeReport(request, txHash)` explains a take from the chain: success with balance changes, or a revert with its reason (`allowance`, `balance`, `filled`, `cancelled`, `other`), a fix, steps and logs. Texts carry placeholders (`{name:..}`, `{symbol:..}`, `{amount:..}`, `{number:..}`, `{price:..}`, `{unit:..}`) that `fillText(text, fmt)` replaces; the page's `fmt` orients the price by its pair (quote per base). A failure is replayed with `eth_call` at the parent block; if the node keeps no history that far back, it falls back to `latest` and sets `reconstructedNow`. Already taken or cancelled is decided from the Swap's `OfferTaken`/`OfferCancelled` logs ordered by block and tx index (so a same-block race names the winner); the offer's stored `taker` and `closedBlock` name the winner and narrow that query to one block, and an open offer needs none.
- **Activity:** `activity(request, swap, pairTokens)` lists offers made/taken/cancelled, reverted takes and approvals to the Swap, newest first. It scans logs and blocks and runs one `takeReport` per reverted take, so its cost grows with chain length (risks R19); a take-selector tx it can't decode is skipped.

```ts
import { makeOfferCall, takeCall, readOffers, book } from '@evmb/swap'

// maker sells 10 WBTC (8 dp) for 650000 USDC (6 dp); approve the Swap for the give token first
await send(maker, makeOfferCall(swap, wbtc, 10n * 10n ** 8n, usdc, 650_000n * 10n ** 6n))
const offers = await readOffers(request, swap)
const { asks, bestAsk } = book(offers, { address: wbtc, decimals: 8 }, { address: usdc, decimals: 6 })
await send(taker, takeCall(swap, asks[0]!.id)) // needs allowance of the get token; each offer fills whole
```

Limits: ERC-20 tokens only, each offer fills whole, fee-on-transfer and rebasing tokens are unsupported (risks R22). Book and "your offers" reads grow with every offer (risks R17, R20).

Tests: `bun test packages/swap`.
