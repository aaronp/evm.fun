# Walkthroughs — design

## Intent

Two needs, one mechanism.

- **Newcomers.** A clear, jargon-free path through the playground's parts ("make two traders, a chain, two
  currencies, a Swap, and trade") without facing nine screens at once.
- **Test scenarios.** Load up, replay and step through a scenario that our tests run, and watch it happen on the
  real pages. Long scenarios (and, later, ones that fork a chain from a saved state) are where this pays most.

A **walkthrough** is a plain JSON file: the inputs (e.g. GBP/USD on an "Example" chain with traders alice and bob)
and ordered steps, each an action with arguments plus checks. The same file has **two runners**:

1. `bun test` runs it headless against an in-process chain and asserts its checks. The test *is* the walkthrough.
2. In the app, a **wizard ribbon** walks the real pages: it navigates to the step's page, fills the page's fields
   from the file, and pulses the control to press next (Deploy, Take…). Pressing **Next** presses it. The user can
   instead edit any filled value and press the real button themselves, so a walkthrough can be changed and re-run.
   Keep pressing Next and you end in the walkthrough's end state, on its final view.

"Walkthrough" is the name because "scenario" already means the benchmark scenarios (`offer-fill`, …).

## Goals

- A walkthrough file format, documented, with a JSON schema-like TypeScript type and a validator.
- A UI-free runner (`packages/web/src/walkthrough/`): step library, name resolution, `run` and `done` checks.
- A test that runs every bundled walkthrough headless and asserts its checks.
- The wizard ribbon (horizontal across the top of the page area, or vertical down its side; user toggles) and
  **focus mode** (dims everything on the page the current step doesn't use).
- Pages declare what the ribbon can fill and press (approach 1, below), for the steps in the first two walkthroughs.
- A "Get started" page (sidebar, first item under Setup) listing walkthroughs, each with Start/Resume, View JSON and
  Edit JSON.
- Two bundled walkthroughs: `gbp-usd` (happy path, with both approvals) and `take-without-approval` (the same
  without Bob's approval: the take reverts, `expectRevert`, and the walkthrough ends on its report).
- ADR, board cards and risks kept current.

## Non-goals (this slice)

- `transfer`, `cancel`, and snapshot / fork / restore steps. The format leaves room for them; a backlog card tracks them.
- Benchmark scenarios as walkthroughs (thousands of generated, timed txs); at most a later "run benchmark" step.
- The screenshot's separate "Get started" form pages (approach B, declined): the ribbon drives the real pages.
- Recording a walkthrough from clicks; a visual editor. Editing is the JSON text.
- Steps for pages outside the two walkthroughs (Studio's generic deploy, Transact, Explorer).

## Anti-goals

- A ribbon that says a step is done when the chain says otherwise. "Done" is always read from state.
- A walkthrough that only works headless or only in the UI. Both runners execute the same file.
- Jargon in step text. Every step carries its own plain-language sentence, written in the file.

## Format

```jsonc
{
  "id": "gbp-usd",
  "title": "Two traders swap pounds for dollars",
  "summary": "Alice sells 1,000 GBP to Bob for 1,270 USD, settled in one transaction.",
  "keys": {                                   // the walkthrough's named things, with initial values
    "alice": { "account": { "label": "alice" } },
    "bob":   { "account": { "label": "bob" } },
    "chain": { "chain":   { "name": "Example" } },
    "GBP":   { "asset":   { "symbol": "GBP", "name": "Pound", "decimals": 2 } },
    "USD":   { "asset":   { "symbol": "USD", "name": "Dollar", "decimals": 6 } },
    "swap":  { "swap":    {} },
    "offer": { "offer":   {} }
  },
  "steps": [
    { "id": "alice",   "do": "account",     "key": "alice", "text": "Make Alice. Every action is signed by a key; this creates hers." },
    { "id": "bob",     "do": "account",     "key": "bob",   "text": "…" },
    { "id": "chain",   "do": "chain",       "key": "chain", "args": { "prefund": ["$alice", "$bob"] }, "text": "…" },
    { "id": "gbp",     "do": "launchAsset", "key": "GBP",   "args": { "supply": "1000000", "issuer": "$alice" }, "text": "…" },
    { "id": "usd",     "do": "launchAsset", "key": "USD",   "args": { "supply": "1000000", "issuer": "$bob" }, "text": "…" },
    { "id": "swap",    "do": "deploySwap",  "key": "swap",  "args": { "from": "$alice" }, "text": "…" },
    { "id": "aliceOk", "do": "approve",     "args": { "from": "$alice", "amount": "1000 $GBP" }, "text": "…" },
    { "id": "bobOk",   "do": "approve",     "args": { "from": "$bob", "amount": "1270 $USD" }, "text": "…" },
    { "id": "offer",   "do": "makeOffer",   "key": "offer", "args": { "from": "$alice", "sell": "1000 $GBP", "for": "1270 $USD" }, "text": "…",
      "expect": [{ "escrowed": "1000 $GBP" }] },
    { "id": "take",    "do": "take",        "args": { "from": "$bob", "offer": "$offer" }, "text": "…",
      "expect": [{ "offer": "$offer", "status": "Filled" }, { "balance": "$bob", "has": "1000 $GBP" }] }
  ]
}
```

- **Keys.** A walkthrough names the things it works with (accounts, the chain, assets, the Swap, offers) as
  **keys**, each with a kind and **initial values** (a label, a chain name, a symbol and decimals). The user may
  change those values as they go. A step that creates a thing names its `key`; args and checks refer to keys with
  `$name`, and amounts are `"<decimal> $KEY"` (parsed with `parseAmount` and the asset's actual decimals).
- **Actual values are captured as they happen.** Each key has, per run, an **actual value** recorded at the moment
  its step completes: what was really used and created — account label and address; chain id and name; asset
  address, symbol and decimals; Swap address; offer id; and each step's tx hash and outcome. Later steps and checks
  resolve `$name` through actual values only (so if the user renamed GBP to EUR, `$GBP` is that EUR token). The run's
  key → actual map is plain JSON, viewable in the ribbon and downloadable; it is the run's record.
- **One fresh chain per run.** The `chain` step creates a new chain named from the file, suffixed when the name is
  taken ("Example 2"), and prefunds the traders; later steps act on that run's chain. So a run never inherits
  another run's tokens, Swap or approvals, and the UI behaves like the headless test (which always starts fresh).
  Accounts are global; the `account` step reuses one with the key's label (first match) or creates it.
- **Step types in this slice** (only what the two bundled files use): `account`, `chain`, `launchAsset`,
  `deploySwap`, `approve`, `makeOffer`, `take`, `view` (go to a page: Swap with the pair, or the report of a step's tx). `approve` is a step of
  its own (it's a real, separate tx and a thing newcomers must learn); `makeOffer`/`take` never approve implicitly.
  A step may set `"expectRevert": true` (the `take-without-approval` take).
- **Checks** (`expect`): `balance` (account has amount), `escrowed` (Swap holds amount), `offer` status, `report`
  outcome (`taken` / `reverted` with the error name). Headless: asserted. Ribbon: shown as ticks on the step.
- Unknown `do`, unknown names or bad amounts fail validation with the step id and field.

## Runner (UI-free)

`packages/web/src/walkthrough/` — no React. It drives the app's own stores (accounts, chain registry, contract and
asset registries, all built on the injectable `Kv`), so headless and UI runs touch the same model.

- `validate(file) → Walkthrough | errors`.
- `run(step, env, run) → Outputs` performs one step with the step library, reusing what exists:
  `accounts.create`, `registry.create`, the asset launch path behind `LaunchAssetDialog`, `deploySwap`,
  `@evmb/swap` calls, `signAndSend`. `Outputs` is per step type (one shared TypeScript type, used by both
  runners): `account {label, address}`, `chain {id, name}`, `launchAsset {address, symbol, decimals}`,
  `deploySwap {address}`, `approve {tx}`, `makeOffer {offerId, tx}`, `take {tx, reverted, error?}`.
  `record(run, step, inputs, outputs)` writes them into the step's key and the step's entry; both runners call it.
- `done(step, env, run) → boolean` reads state through the actual values: the key's account / chain / asset /
  Swap / offer exists, the step's tx landed (or reverted, for `expectRevert`), and its checks hold. A step that is
  already done is skipped by both runners, so resuming never repeats a tx.
- `env` is `{ accounts, registry, contracts, assets, kv }`; the app passes its singletons, tests pass ones over a
  memory `Kv` (accounts via `createAccounts()`, which falls back to memory without `localStorage`). Helpers that use
  the global registries today (`deploySwap`, the asset launch) take them as parameters instead.
- **Gas.** Chains only prefund at creation, which the fresh chain per run covers (no faucet in this slice).
- A run (walkthrough id, key → initial and actual values, per-step inputs/outputs) persists in `Kv`, so the ribbon
  resumes after a reload.

## Test runner

`packages/web/test/walkthroughs.test.ts` loads every file in `packages/web/walkthroughs/*.json`, validates it, and
for each step: `run`, then assert `done` and the step's `expect`s (or the revert for `expectRevert`). Runs against a
real in-process chain, like the registry tests.

## Ribbon (UI)

- Lives in the app shell above the page (like the AppBar), present on every page while a walkthrough is active.
- **Horizontal:** a stepper strip (numbered steps with ✓ / current / pending, title per step), then the current
  step's text and Back / Next / Exit. **Restart** starts a new run (new chain, actual values cleared). **Vertical:** the same as a side column next to the page (as in Aaron's
  "Get started" screenshot). A toggle switches; remembered per browser.
- **Next** on a pending step: navigate to the step's page if not there, select the run's chain and the step's
  acting account (`from: "$bob"` switches "Acting as" to bob — that's how the real page works), fill its fields,
  then press its action (the same as clicking the pulsing control). On a done step: advance. **Back** goes to the
  previous step's page and shows it as done (no undo).
- **Pages talk to the running walkthrough both ways** (approach 1), through one small wizard context:
  - **In:** `useWizardField(id, value, setValue)` — on arrival at a step that targets `id`, the key's value (actual
    if known, else initial) is set into the page's own state once; after that the user's edits win, and the ribbon
    reads the current value back so it records what was actually used.
  - **Press:** `useWizardAction(id, fn)` registers what Next presses; `data-wizard="<id>"` marks the control and
    the page areas the step uses.
  - **Out:** `useWizardReport()` gives the page `report(id, outputs)`, which it calls when its action completes —
    whoever pressed, Next or the user's own click — with the same `Outputs` the headless runner returns (e.g. the
    Swap page reports `{offerId, tx}` after creating an offer, the launch dialog reports the token's address).
    Outside a walkthrough `report` does nothing. The ribbon matches it to the current step and calls `record`.
  - Pulse: CSS on `[data-wizard]` matching the current step. **Focus mode** (toggle in the ribbon, default on for
    "Get started"): everything in the page area not inside the step's `data-wizard` areas is dimmed and inert-ish
    (reduced opacity, still reachable by keyboard); the sidebar dims too.
- Each step type maps to one page binding: `account` → Accounts, `chain` → Chains (new-chain dialog),
  `launchAsset` → Assets (launch dialog), `deploySwap`/`approve`/`makeOffer`/`take` → Swap, `view` → its target.
- **Checks after edits.** `expect` lines come from the file. When the user edited a value that a check depends on,
  a failing check shows amber ("differs from the walkthrough"), not red; unedited runs show pass/fail.
- Errors (revert, validation, missing gas) show in the ribbon on the step, with the page's own message where it
  has one. An `expectRevert` step that reverts is done, and the ribbon offers its report.

## "Get started" page

Sidebar item "Get started" first under Setup. Lists bundled walkthroughs (title, summary, step count, progress if
started). Each: **Start** / **Resume**, **Restart** (a new run), **View JSON**, **Edit JSON** (textarea,
validated live; the edited copy is saved per browser with "Reset to original"). Starting one shows the ribbon and
goes to step 1's page.

## Approaches considered

| | How the ribbon fills and presses the real pages | Trade-off |
|---|---|---|
| **1 (chosen)** | Pages declare fields/actions (`useWizardField`, `useWizardAction`, `data-wizard`) | Explicit, typed, works for dialogs and internal state; a few lines per page per step. The same markers drive pulse and focus mode |
| 2 | URL pre-fill (`/swap?amount=…`) | Least machinery, deep-linkable; dialogs need open state in the URL, everything stringly, long URLs |
| 3 | DOM robot (selectors, synthetic typing/clicks) | No page changes; brittle with markup changes, React controlled-input hacks, shares nothing with the headless runner |

Also decided with Aaron: one file, two runners (not UI-only walkthroughs mirroring tests by hand); the ribbon drives
the real pages, with focus mode for newcomers, rather than separate simplified wizard pages.

Decided with Aaron after the builder check: keys with initial values the user may change; actual values captured
when each step completes; pages report their outputs back to the running walkthrough the same way they take its
inputs. Claude's calls then: one fresh chain per run; `from` switches the acting
account; amber for checks broken by an edit; only the step types the two files use. Also: the runner lives in `packages/web/src/walkthrough/` (not a new package) because the steps act on the
web app's stores; the name "walkthrough"; names-not-addresses args; find-or-create; `approve` as its own step; no
faucet; Back doesn't undo.

## Constraints

As earlier steps: tokens only (no raw colours), three themes, contrast tests, phone width (the vertical ribbon
collapses to horizontal below `sm`); real chain data only; never commit `design/`; commit with `git commit --only`.
Benchmark chains can't host walkthroughs (no contract records).

## Left to the builder

- Exact ribbon and Get-started layouts within the above; the pulse animation (respect `prefers-reduced-motion`).
- Validator implementation (hand-written is fine); the step text of the two bundled walkthroughs.
- How the step library shares code with the pages (extract shared helpers where a page has the logic inline,
  e.g. the asset launch).
