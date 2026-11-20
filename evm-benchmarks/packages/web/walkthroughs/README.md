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

When a step completes, the run records its **actual values** (address, id, tx hash). `$name` anywhere in a step resolves through those, never the initial value: if the user renames GBP to EUR, `$GBP` is the EUR token. A `$name` used before its step, or never declared, fails validation; one with no value at run time is an error naming the step and key.

### Steps

`id`, `do`, `title`, `text` (plain language, no jargon), optional `key`, `args`, `expect`, `expectRevert`. Steps that create something take `key`; `approve`, `take` and `view` take none.

| `do` | key | args |
| --- | --- | --- |
| `account` | account | none. An existing account with the label is reused. |
| `chain` | chain | `prefund`: list of `$account` (their actual addresses). |
| `launchAsset` | asset | `supply` (whole units, number string), `issuer` (`$account`). |
| `deploySwap` | swap | `from` (`$account`). |
| `approve` | none | `from`, `amount` (`"<amount> $ASSET"`), `before` (id of a later `makeOffer` or `take` step). |
| `makeOffer` | offer | `from`, `sell`, `for` (both `"<amount> $ASSET"`). Price `for/sell` must be exact at the `for` asset's decimals. |
| `take` | none | `from`, `offer` (`$offer`). |
| `view` | none | `{ "page": "swap", "base", "quote" }` (two `$assets`) or `{ "page": "report", "step" }` (id of a `take` step). |

Amounts are `"<decimal> $KEY"`, parsed at the asset's actual decimals. Offer ids are decimal strings, read from the `OfferMade` event. `from` is who acts: the ribbon switches "Acting as" to that account.

`expectRevert: true` on a `take` means the chain must refuse it; the step is done once the revert is recorded.

### Checks

`expect` is a list, evaluated after the step and shown in the ribbon (and asserted by the headless test):

- `{ "balance": "$account", "has": "<amount> $ASSET" }` holds at least that much
- `{ "escrowed": "<amount> $ASSET" }` the Swap holds exactly that much
- `{ "offer": "$offer", "status": "Open" | "Filled" | "Cancelled" }`
- `{ "outcome": "taken" | "reverted", "error"?: "<error name>" }` (on `take`)

## How the runners use a file

- **One fresh chain per run**, named from the `chain` key and suffixed when taken (`Example`, `Example 2`, ...), prefunding the listed accounts. Earlier runs' tokens and offers are not visible to it.
- **`done` excludes checks.** `done(step)` is whether the step's effect is in place (account/chain exists, contract has code, offer exists, take filled or reverted as expected). Checks are reported separately by `checks()`, since a later step can change what they read (a take empties the escrow). An `approve` is done once its recorded tx landed, or when the allowance already covers the amount.
- **Resume.** A run (inputs, outputs, actual values per step) persists in `kv`; after a reload the ribbon continues at the first step that is not done and never repeats one.
- **Edits.** If the user changes a value (e.g. the symbol in the launch dialog), the run is marked `edited` and failing checks show amber as "Differs from the walkthrough" instead of red.
- **Edited copies.** On the Get started page, Edit JSON saves a validated copy; Start and Resume run that copy until reset.
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
is never cut off), and stops on an error or at the end. The countdown beside Next pauses and resumes it. Reduced motion: no ring, the
countdown remains.
