# @evmb/swap

UI-free helpers for `Swap.sol` (same-chain escrowed offers, ADR-0016). Runtime deps: `viem` and `@evmb/assets` (types only: `Request`). No DOM, React or IndexedDB. Offers are never cached; they are read from the chain each time.

- **Identity:** `swapAbi` (embedded copy of the contract ABI; a test pins it to `@evmb/contracts`), `isSwapAbi(abi)`, `findSwap(records)` (last record named `Swap` with a Swap ABI wins).
- **Calls:** `makeOfferCall`, `takeCall`, `cancelCall` return `{to, data}`.
- **Reads:** `readOffers(request, swap)` reads `nextId` then `offers(1..nextId-1)`, all statuses.
- **Book:** `book(offers, base, quote)` gives `asks` (ascending), `bids` (descending), `bestAsk`, `bestBid`, exact `spread` and `escrowed` per token for open offers in the pair. Prices are exact fractions (quote per whole base); ties go to the lowest id. `priceText(price, dp = 4)` formats half-up; `quoteFor(amount, price, baseDecimals, quoteDecimals)` is amount x price rounded half-up to the quote's decimals (throws `Invalid price`).
- **Errors:** `decodeSwapError(data)` decodes `OfferNotOpen`, `NotMaker`, `BadOffer`, `ERC20InsufficientAllowance`, `ERC20InsufficientBalance`, else `undefined`.

Tests: `bun test packages/swap`.
