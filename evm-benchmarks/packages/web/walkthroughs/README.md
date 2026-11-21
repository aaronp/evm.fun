# Walkthroughs

A walkthrough is one JSON file that two runners use: `bun test` runs it headless (`test/walkthroughs.test.ts`), and the app's wizard ribbon runs it on the real pages, filling fields and pressing buttons for you (Get started page). Format rules are enforced by `src/walkthrough/validate.ts`. Design: ADR-0017 and `docs/superpowers/specs/2026-11-20-walkthroughs-design.md`.

## File

```json
{ "id": "...", "title": "...", "summary": "...", "keys": { ... }, "steps": [ ... ] }
```

`id`, `title` and `summary` are required text. Every key must be filled by exactly one step.

### Keys

Named things with initial values the user may change. Each has one kind:

| Kind | Value | Filled by step |
| --- | --- | --- |
| `{ "account": { "label" } }` | label | `account` |
| `{ "chain": { "name" } }` | name | `chain` |
| `{ "asset": { "symbol", "name", "decimals" } }` | token | `launchAsset` |
| `{ "swap": {} }` | the Swap contract | `deploySwap` |
| `{ "offer": {} }` | an offer | `makeOffer` |
| `{ "venue": { "venue": "onchain" \| "offchain" } }` | an order-book venue (OrderBook / Settlement contract) | `deployVenue` |
| `{ "order": {} }` | a resting order | `placeOrder` |
| `{ "pool": {} }` | a liquidity pool (Pool contract) | `deployPool` |

When a step completes, the run records its **actual values** (address, id, tx hash). `$name` anywhere in a step resolves through those, never the initial value: if the user renames GBP to EUR, `$GBP` is the EUR token. A `$name` used before its step, or never declared, fails validation; one with no value at run time is an error naming the step and key.

### Steps

`id`, `do`, `title`, `text` (plain language, no jargon), optional `key`, `args`, `expect`, `expectRevert`. Steps that create something take `key`; `approve`, `take`, `cancelOrder`, `transfer`, `addLiquidity`, `removeLiquidity`, `poolSwap` and `view` take none. A `placeOrder` may omit it:
an order that fills in full rests nothing (off-chain it then has no id), so a taker's order needs no key.

| `do` | key | args |
| --- | --- | --- |
| `account` | account | none. An existing account with the label is reused. |
| `chain` | chain | `prefund`: list of `$account` (their actual addresses). |
| `launchAsset` | asset | `supply` (whole units, number string), `issuer` (`$account`). |
| `deploySwap` | swap | `from` (`$account`). |
| `transfer` | none | `from`, `to` (`$account`), `amount` (`"<amount> $ASSET"`). Sends tokens; the only way someone gets a token they did not launch (closes the transfer part of backlog card t-77). |
| `approve` | none | `from`, `amount` (`"<amount> $ASSET"`), `before` (id of a later `makeOffer`, `take`, `placeOrder`, `addLiquidity` or `poolSwap` step). Before a pool step the spender is that pool and `amount` must be in what the step pays (the swap's `pay` asset, either of the add's two). Before a `placeOrder` the spender is that order's venue contract and `amount` must be in what the order gives (the base for a sell, the quote for a buy); in the app, Approve more approves what the order needs (off-chain, plus what the maker's other open orders already claim), so give each order its own approve. |
| `makeOffer` | offer | `from`, `sell`, `for` (both `"<amount> $ASSET"`). Price `for/sell` must be exact at the `for` asset's decimals. |
| `take` | none | `from`, `offer` (`$offer`). |
| `deployVenue` | venue | `from`, `venue` (`onchain` or `offchain`, matching the key's). |
| `placeOrder` | order (optional) | `from`, `venue` (`$venue`), `side` (`buy`/`sell`, of the base), `type` (`limit`/`market`), `price` (limit only: quote per whole base, at most 4 dp on the tick), `amount` (`"<amount> $BASE"`), `quote` (`$asset`). |
| `cancelOrder` | none | `from`, `order` (`$order`). |
| `deployPool` | pool | `from`, `base`, `quote` (two different `$assets`; the pool's on-chain order). |
| `addLiquidity` | none | `from`, `pool` (`$pool`), `base`, `quote` (`"<amount> $ASSET"`, the pool's two tokens, one each). Minimum shares at 0.5% below the quote. |
| `removeLiquidity` | none | `from`, `pool`, `percent` (whole number 1–100 of `from`'s shares). Minimums at 0.5% below the quote. |
| `poolSwap` | none | `from`, `pool`, `pay` (`"<amount> $ASSET"`, one of the pool's tokens), `slippageBps` (10, 50 or 100: the page's 0.1% / 0.5% / 1%). |
| `view` | none | `{ "page": "swap", "base", "quote" }` (two `$assets`), `{ "page": "trade", "venue", "base", "quote" }`, `{ "page": "pool", "pool" }` or `{ "page": "report", "step" }` (id of a `take` step). |

Amounts are `"<decimal> $KEY"`, parsed at the asset's actual decimals. Offer ids are decimal strings, read from the `OfferMade` event. Order steps record `deployVenue {address, venue}`,
`placeOrder {orderId?, tx?, filled}` (`filled`: base raw units as a decimal string; no `orderId` when nothing rested
off-chain, no `tx` when an off-chain order was only signed) and `cancelOrder {}`. Transfers and pool steps record
`transfer {tx}`, `deployPool {address}`, `addLiquidity {tx, shares, k}` (`k`: the reserves' product read right after
the add, the baseline for `kGrew`), `removeLiquidity {tx, base, quote}` (paid out, in the pool's order) and
`poolSwap {tx, out}`; amounts are raw units as decimal strings. `from` is who acts: the ribbon switches "Acting as" to that account.

`expectRevert: true` on a `take` means the chain must refuse it; the step is done once the revert is recorded.

### Checks

`expect` is a list, evaluated after the step and shown in the ribbon (and asserted by the headless test):

- `{ "balance": "$account", "has": "<amount> $ASSET" }` holds at least that much
- `{ "escrowed": "<amount> $ASSET" }` the Swap holds exactly that much
- `{ "offer": "$offer", "status": "Open" | "Filled" | "Cancelled" }`
- `{ "outcome": "taken" | "reverted", "error"?: "<error name>" }` (on `take`)
- `{ "order": "$order", "status": "open" | "partial" | "filled" | "cancelled" | "failed" | "unfunded", "filled"?: "<amount> $BASE" }` as its venue lists it now
- `{ "trades": "$venue", "count": <n> }` exactly `n` trades in the market of the first `placeOrder` on that venue
- `{ "pool": "$pool", "kGrew": true }` the pool's `k = x · y` now is above `k` right after its first recorded `addLiquidity` (fees only grow it)

## How the runners use a file

- **One fresh chain per run**, named from the `chain` key and suffixed when taken (`Example`, `Example 2`, ...), prefunding the listed accounts. Earlier runs' tokens and offers are not visible to it.
- **`done` excludes checks.** `done(step)` is whether the step's effect is in place (account/chain exists, contract has code, offer exists, take filled or reverted as expected, a placed order is listed by its venue (or, with no id, its tx landed), a cancelled order is `cancelled`, a deployed pool has code, a transfer's or pool step's recorded tx landed). Checks are reported separately by `checks()`, since a later step can change what they read (a take empties the escrow). An `approve` is done once its recorded tx landed, or when the allowance already covers the amount.
- **Resume.** A run (inputs, outputs, actual values per step) persists in `kv`; after a reload the ribbon continues at the first step that is not done and never repeats one.
- **Edits.** If the user changes a value (e.g. the symbol in the launch dialog), the run is marked `edited` and failing checks show amber as "Differs from the walkthrough" instead of red.
- **Edited copies.** On the Get started page, Edit JSON saves a validated copy; Start and Resume run that copy until reset.
- **Order books.** Headless, order steps use the package venues on the recorded contract, scoped by the run's chain id, with the env's order-book store (`Env.book`; the app's IndexedDB `bookStore` by default). Off-chain orders live only in that store, so a reload keeps them. In the app they run on the Trade page (`/trade?venue=&base=&quote=`).
- **Pools.** Headless, pool steps use `@evmb/pool` (quotes, calls) and `signAndSend` on the pool the run recorded. In the
  app they run on the Pool page (`/pool?base=&quote=`, the pair as deployed); the ribbon picks the tab (`pool.tab`)
  before filling the tab's fields. A transfer runs in the Assets page's Send dialog (`/assets?asset=<id>`), sent from
  the acting account.
- Headless: `perform` does a step with the same helpers the pages use, `record` stores its outputs, `done` skips finished steps. The runner (`src/walkthrough/*.ts`) imports no React or DOM.

## Adding one

1. Add `walkthroughs/<id>.json` and list it in `walkthroughs/index.ts`.
2. `bun test packages/web/test/walkthrough-format.test.ts` validates it; `walkthroughs.test.ts` runs every bundled file headless, so give it checks worth asserting.
3. Open Get started, run it with Next only, in both layouts.

## Auto-advance

Add `?auto=5s` to the address (`#/get-started?auto=5s`, or `/?auto=5s#/…`) and the ribbon presses Next for you: a ring
drains around the Next button and presses it when empty. Accepts `5s`, `3` (seconds), `1500ms`, `0.5m`; `?auto=off`
or Exit turns it off. It is kept for the browser tab's session, restarts on every step and after every press, waits
while a press is in flight and while a dialog's own Next is showing, restarts whenever you type in a field (so an edit
is never cut off), and stops on an error or at the end. The countdown beside Next pauses and resumes it. The ▶ beside Next (shown when auto-advance is off) starts it at 5s and writes `?auto=5s` into the address; the ribbon keeps `?auto=` on every address it navigates to, so you can change the speed by editing it in the URL (e.g. `?auto=2s`), which takes effect at once. Reduced motion: no ring, the
countdown remains.

When a step fails for a balance shortfall (e.g. "Not enough GBP — you have 0.00."), the ribbon shows the fix under the error, as the page does: **Request {amount} {SYM} from {issuer}** (a page handler may return `{ message, fix }`; see the web README, "Links and fix-it actions"). It sends from the issuer and comes back to the step's page as you, with the ribbon still on that step; press Next again. A take that would revert for the balance reports the shortfall instead of sending, unless the step has `expectRevert`.

In the app, an approve step approves what the form asks for (what the order needs, including the maker's other open orders; on the Pool page what the swap or add needs, in the token the step's `amount` names), not the JSON `amount`; headless runs use the JSON amount, so leftover allowances can differ.

## Install

"Install" on the Get started page performs every step of a walkthrough from its JSON inputs, at once and without the
ribbon, on a fresh run (a new chain), as the `bun test` runner does (`src/walkthrough/install.ts`). Each step's checks
are evaluated right after it; failures are listed. The run is saved after every step, so if a step fails, the steps
before it are kept and Resume continues from there in the ribbon. When it finishes, the new chain is selected and
"Open →" goes to the walkthrough's last page. An edited copy installs as edited.
