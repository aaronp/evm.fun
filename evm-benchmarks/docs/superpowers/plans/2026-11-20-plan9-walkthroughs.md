# Walkthroughs: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Walkthroughs: a JSON file (keys with initial values, steps, checks) run headless by `bun test` and in the app by a wizard ribbon that fills, pulses and presses the real pages, with focus mode and a "Get started" page.

**Architecture:** A UI-free runner in `packages/web/src/walkthrough/` validates files, resolves `$key` references through a run's **actual values**, performs steps with the app's own helpers, and checks state. Both runners record each step's `Outputs` into the run with one `record` function. In the app a `WizardProvider` holds the active run; pages take part through four hooks (field in/out, action, report, mark); the ribbon presses the page's own handlers, and pages report their outputs whoever pressed.

**Tech Stack:** Bun 1.3.13 workspace, TypeScript, viem, webevm 0.9.1 (tests), React 19 + Tailwind 4, react-router 7 (HashRouter).

**Spec:** `evm-benchmarks/docs/superpowers/specs/2026-11-20-walkthroughs-design.md`. ADR-0017 in `evm-benchmarks/docs/adr/decisions.md`. Aaron's "Get started" screenshot (vertical stepper left, step body right) is the reference for the vertical ribbon only.

## Global Constraints

- **Name:** "walkthrough" in code and copy; never "scenario" (that's the benchmarks).
- **Runner boundaries:** `src/walkthrough/*.ts` imports no React/DOM. It may import the web app's stores and helpers (`store/accounts`, `chain/registry` types, `contracts/registry`, `assets/registry`, `swap/locate`, `tx/send`, `@evmb/swap`, `@evmb/assets`).
- **Env:** `type Env = { accounts: { list(): Account[]; create(label: string): Account }; registry: ChainRegistry }` where `ChainRegistry = ReturnType<typeof createChainRegistry>`. Contract and asset records use the existing `contractsRegistry`/`assetRegistry` singletons (memory-backed `kv` in tests, as `swap-locate.test.ts` already relies on). The app passes `accounts` and `registry` from `chain/revm`.
- **One fresh chain per run**, named from the `chain` key, suffixed when taken: `Example`, `Example 2`, `Example 3`…; prefunds the listed accounts' actual addresses.
- **Actual values only:** `$name` resolves through `run.values[name]`; an unresolved `$name` at run time is an error naming the step and the key.
- **Amounts:** `"<decimal> $KEY"`, parsed with `parseAmount(text, decimals)` (the asset's actual decimals); `supply` is whole units with the same parser. offer ids are decimal strings in JSON.
- **Copy:** every step's `text` comes from the file, plain language, no jargon (no "ERC-20", "allowance", "escrow" without saying what it means). Ribbon buttons: "Back", "Next", "Exit", "Restart", "Focus", "Run values". Amber note: "Differs from the walkthrough". Reused account note: "{label} already exists — reused."
- **Web:** tokens only (no raw colours; contrast and no-raw-colours tests keep passing); three themes; phone width (vertical ribbon collapses to horizontal below `sm`); pulse respects `prefers-reduced-motion`; no new runtime deps.
- **Outside a walkthrough** every hook is a no-op and pages behave exactly as today.
- **Every task end:** `bun test` from `evm-benchmarks` (R11 exit crash ~1 in 3 after tests pass: rerun once and say so), `make build`, tsc on changed files: `bunx --package typescript@5 tsc --noEmit --strict --jsx react-jsx --moduleResolution bundler --module esnext --target es2022 --skipLibCheck <files>` (ignore TS5097). Every test disposes every chain it creates.
- **Docs only in `evm-benchmarks/docs/`:** board card **t-76** (Doing now; Done in Task 6, real `date -u`), ADR-0017 (extend, don't duplicate), risks `risks/risks.md`. Regenerate cards with `evm-benchmarks/node_modules/.bin/{agile,adr,risk-register} card <file> <dir>`. Deferred work → To Do card referencing ADR-0017.
- **Git:** commit only your paths: `git commit --only -m … -- <paths>` (new files `git add -N` first); never stage or commit anything else Aaron has modified; never commit `design/`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Git writes need `dangerouslyDisableSandbox: true`.

## Review Focus

1. **Resume after reload mid-run.** A run persisted after step 5 resumes at step 6; done steps are not repeated (no second deploy, no second offer). Pinned by a Task 2 test that runs half, reloads the run from kv, finishes.
2. **User edits.** Renaming GBP→EUR in the launch dialog: the run records EUR, later `$GBP` resolves to the EUR token, `run.edited` is true and a failing check is amber not red. Pinned by Task 2 (`record` with differing inputs sets `edited`) and Task 3 (check tone) tests.
3. **Existing label.** An `account` step whose label already exists reuses that account (no duplicate created), headless and in the ribbon. Pinned by Task 2.
4. **Chain name taken.** "Example" exists → the run's chain is "Example 2", and a second run gets "Example 3"; the old run's tokens/Swap/approvals are not visible to the new run. Pinned by Task 2.
5. **Modal dialogs.** A step inside `NewChainDialog`/`LaunchAssetDialog` must still be advanceable: the page behind a modal is inert, so the dialog shows `WizardInline` (step text + Next). Pinned by a Task 3 render test and the Task 6 browser checklist.

---

### Task 1: Format, validator, resolver, bundled files

**Files:**
- Create: `packages/web/src/walkthrough/types.ts`, `packages/web/src/walkthrough/validate.ts`, `packages/web/src/walkthrough/resolve.ts`
- Create: `packages/web/walkthroughs/gbp-usd.json`, `packages/web/walkthroughs/take-without-approval.json`, `packages/web/walkthroughs/index.ts` (exports `bundled: Walkthrough[]` via static JSON imports)
- Test: `packages/web/test/walkthrough-format.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type KeyDef = { account: { label: string } } | { chain: { name: string } } | { asset: { symbol: string; name: string; decimals: number } } | { swap: Record<string, never> } | { offer: Record<string, never> }`
  - `type StepType = 'account' | 'chain' | 'launchAsset' | 'deploySwap' | 'approve' | 'makeOffer' | 'take' | 'view'`
  - `type Check = { balance: string; has: string } | { escrowed: string } | { offer: string; status: 'Open' | 'Filled' | 'Cancelled' } | { outcome: 'taken' | 'reverted'; error?: string }`
  - `type Step = { id: string; do: StepType; key?: string; title: string; text: string; args?: Record<string, unknown>; expect?: Check[]; expectRevert?: true }`
  - `type Walkthrough = { id: string; title: string; summary: string; keys: Record<string, KeyDef>; steps: Step[] }`
  - `type Outputs = { account: { label: string; address: Address }; chain: { id: string; name: string }; launchAsset: { address: Address; symbol: string; name: string; decimals: number }; deploySwap: { address: Address }; approve: { tx: Hex }; makeOffer: { offerId: string; tx: Hex }; take: { tx: Hex; reverted: boolean; error?: string }; view: Record<string, never> }`
  - `type StepRecord = { inputs: Record<string, string>; outputs: Outputs[StepType]; at: string }`
  - `type Run = { walkthrough: string; started: string; edited: boolean; values: Record<string, Outputs[StepType]>; steps: Record<string, StepRecord> }`
- Produces (`validate.ts`): `validate(json: unknown): { ok: Walkthrough } | { errors: { step?: string; field: string; message: string }[] }`
- Produces (`resolve.ts`): `ref(run, '$GBP') → value` (throws `Step <id>: $GBP has no value yet`), `amount(run, '1000 $GBP') → { asset: Outputs['launchAsset']; raw: bigint }`, `uniqueName(name, taken: string[]) → string`.

Args per step type (validator enforces): `account` — none (`key` required, kind account); `chain` — `prefund: string[]` of `$account` keys (`key` kind chain); `launchAsset` — `supply: string`, `issuer: $account` (`key` kind asset); `deploySwap` — `from` (`key` kind swap); `approve` — `from`, `amount`, `before: <stepId of a later makeOffer or take>`; `makeOffer` — `from`, `sell`, `for` (`key` kind offer; the price `for/sell` must be exact at the `for` asset's decimals, checked against initial decimals); `take` — `from`, `offer: $offer`; `view` — `{ page: 'swap', base: $asset, quote: $asset }` or `{ page: 'report', step: <stepId of a take> }`. Every `$name` must be a declared key whose step comes earlier; step ids unique; every key filled by exactly one step.

- [ ] Write `gbp-usd.json` per the spec's example, with `approve` steps reordered to sit right before what they enable: alice, bob, chain, gbp, usd, swap, aliceOk (`before: offer`), offer (`expect: escrowed 1000 $GBP`), bobOk (`before: take`), take (`expect: offer Filled; bob has 1000 $GBP; alice has 1270 $USD; outcome taken`), view (report of take). Plain-language `title` and `text` per step.
- [ ] `take-without-approval.json`: same minus `bobOk`; take has `expectRevert: true`, `expect: outcome reverted, error ERC20InsufficientAllowance; offer Open; escrowed 1000 $GBP`; ends with view of its report.
- [ ] Failing tests: both bundled files validate; errors for unknown `do`, duplicate step id, `$name` used before its step, undeclared key, key filled twice, `approve.before` pointing backwards, inexact price (`"1 $GBP"` for `"1 $USD"` is fine; `"3 $GBP"` for `"1 $USD"` with USD 2 dp is not), missing `text`. Resolver: `ref` throws with step and key; `amount` uses actual decimals (run where GBP was relaunched with 4 dp parses `"1.5 $GBP"` to 15000n); `uniqueName('Example', ['Example','Example 2']) === 'Example 3'`.
- [ ] RED → implement → GREEN. Board t-76 already Doing. Commit.

### Task 2: Runner and headless test

**Files:**
- Create: `packages/web/src/walkthrough/run.ts`, `packages/web/src/walkthrough/runs.ts`
- Create: `packages/web/src/assets/launch.ts` (extract from `LaunchAssetDialog.launch`); modify `LaunchAssetDialog.tsx` to call it
- Test: `packages/web/test/walkthroughs.test.ts`

**Interfaces:**
- Consumes: Task 1 types/validate/resolve; `deploySwap`, `swapFor` (`swap/locate`); `signAndSend`, `readContract` (`tx/send`); `approveCall` (`@evmb/assets`); `makeOfferCall`, `takeCall`, `takeReport`, `readOffers`, `swapAbi` (`@evmb/swap`).
- Produces:
  - `launchToken(chain: ChainHandle, from: Account, t: { name: string; symbol: string; decimals: number; supply: bigint }, onSent?: () => void): Promise<Asset>` — deploys `AssetToken`, adds the contract and asset records (same behaviour and errors as the dialog today, including the "deployed but not saved" error).
  - `newRun(w: Walkthrough): Run`
  - `record(run: Run, step: Step, outputs: Outputs[StepType], inputs?: Record<string,string>): Run` — returns a new run with `steps[step.id]`, `values[step.key]` set; sets `edited` when any `inputs[k]` differs from the step's initial input for `k` (initial inputs: `initialInputs(w, step, run)`).
  - `initialInputs(w: Walkthrough, step: Step, run: Run): Record<string, string>` — the field values the ribbon fills (Task 4 uses the same ids): account `label`; chain `name` (already `uniqueName`d); launchAsset `name`, `symbol`, `decimals`, `supply`, `issuer` (address); makeOffer `side` (`ask`), `amount`, `price`; take `offer` (id); approve — the inputs of its `before` step.
  - `perform(w, step, env, run): Promise<Outputs[StepType]>` — headless step library. `account`: reuse by label or `env.accounts.create`. `chain`: `env.registry.create(uniqueName(...), 'plain', prefund addresses)`. Others open the run's chain with `env.registry.open(id)` and use the helpers above; `take` returns `{tx, reverted, error}` with `error` from `takeReport(...).reason` name when reverted.
  - `done(w, step, env, run): Promise<boolean>` — per spec (state through actual values); `approve` done when allowance ≥ amount; `take` done when recorded and (expectRevert ? reverted : offer Filled).
  - `checks(w, step, env, run): Promise<{ check: Check; pass: boolean; actual: string }[]>`
  - `runs.ts`: `loadRun(id): Promise<Run | undefined>`, `saveRun(run): Promise<void>`, `clearRun(id)` on `kv` store `walkthroughRuns`; `activeId()`/`setActiveId(id | undefined)` in localStorage `evmb.walkthrough.active` (try/catch).

- [ ] Failing tests (real in-process chains via `createChainRegistry` with the in-memory persistence of `chain.test.ts`; an `Env` whose `accounts` is an in-memory list): run each bundled walkthrough end to end with `perform` → `record` → `done` true → every check passes; `take-without-approval`'s take is reverted with `ERC20InsufficientAllowance` and the offer stays Open. Review Focus 1, 3, 4 tests: resume from a saved run doesn't repeat (count txs via the chain height); existing label reused (accounts length unchanged); taken chain name → "Example 2", a second run "Example 3", and the second run's `bob` allowance starts at 0. `record` with `inputs.symbol = 'EUR'` sets `edited` and the next `amount('… $GBP')` resolves to the EUR token.
- [ ] RED → extract `launchToken` (dialog behaviour unchanged) → implement → GREEN. Commit.

### Task 3: Wizard context, hooks, ribbon

**Files:**
- Create: `packages/web/src/walkthrough/wizard.tsx` (provider + hooks), `packages/web/src/components/Ribbon.tsx`, `packages/web/src/components/WizardInline.tsx`, `packages/web/src/walkthrough/bindings.ts`
- Modify: `packages/web/src/App.tsx` (provider around the router contents; `<Ribbon />` above `<AppBar />`; vertical mode lays out ribbon and page side by side inside `main`), `packages/web/src/index.css` (pulse and focus rules)
- Test: `packages/web/test/wizard.test.ts`

**Interfaces:**
- Consumes: Task 2 `Run`, `record`, `initialInputs`, `done`, `checks`, `loadRun`/`saveRun`/`activeId`.
- Produces (`wizard.tsx`):
  - `WizardProvider` — active walkthrough + run (persisted on every change), current step index, `start(w)`, `restart()`, `exit()`, `next()`, `back()`, `layout: 'horizontal' | 'vertical'` and `focus: boolean` (localStorage `evmb.walkthrough.layout` / `.focus`, focus default on).
  - `useWizardField(id: string, value: string, set: (v: string) => void)` — when the current step's binding lists `id`: on arrival sets `initialInputs[id]` (actual value if the run has one) once; afterwards reads `value` back as the step's input.
  - `useWizardAction(id: string, fn: () => void | Promise<void>)` — registers what Next presses.
  - `useWizardReport(): (id: string, outputs: Outputs[StepType]) => void` — no-op unless `id` is the current step's report id; then `record` with the read-back inputs, save, recompute `done`/`checks`.
  - `useWizardMark(): (id: string) => { 'data-wizard': string; 'data-wz-on'?: '' ; 'data-wz-pulse'?: '' }` — `data-wz-on` when `id` is in the current step's areas; `data-wz-pulse` when it is the action Next would press now.
- Produces (`bindings.ts`): `binding(step): { path(run): string; fields: string[]; actions: string[]; areas: string[]; report: string }` for every `StepType`. Next presses the **last** id in `actions` that is currently registered (an opener such as `chains.new` comes first, the dialog's submit last). Ids: `account.label`/`account.create` (Accounts); `chain.name`/`chains.new`,`chain.create` (Chains + NewChainDialog); `launch.name|symbol|decimals|supply|issuer` / `assets.launch`,`launch.submit` (Assets + LaunchAssetDialog); `swap.deploy`; `offer.side|amount|price` / `offer.approve`, `offer.create`; `take.offer` / `take.approve`, `take.submit`; approve steps use their `before` step's fields with only the `*.approve` action. Swap paths carry `?base=&quote=` from the run's actual asset addresses. `view` has no fields or actions: Next navigates (`/swap?base=&quote=` or `/swap/report?tx=<the take's tx>&base=&quote=`) and records `{}`.
- Ribbon behaviour per spec "Ribbon (UI)": stepper (✓ / current / pending; reused steps say "{label} already exists — reused."), step text, Back / Next / Exit / Restart, Focus toggle, layout toggle, "Run values" (JSON of `run.values`, with Download). Next on a pending step: `navigate(path)`, `selectChain(run chain)`, `selectAccount(from)`, wait for the action to register, press it. An `account` step whose label exists is recorded without pressing. Errors shown on the step. Checks: pass ✓, fail red, fail with `run.edited` amber "Differs from the walkthrough".
- `WizardInline`: inside a modal dialog that is part of the current step, renders the step's title/text and a Next button (the page behind a modal is inert).
- Focus CSS (in `index.css`, tokens only): with `main[data-wz-focus]`, dim (`opacity` via a token-based rule, no compounding) every element that is a child of an ancestor of a `[data-wz-on]` element and neither is nor contains one: `main[data-wz-focus] :has([data-wz-on]) > :not([data-wz-on]):not(:has([data-wz-on]))` plus `main[data-wz-focus] > :not(:has([data-wz-on])):not([data-wz-on])`, excluding the ribbon. Pulse: a ring animation on `[data-wz-pulse]`, none under `prefers-reduced-motion`.

- [ ] Failing tests: `binding` covers every `StepType`; "last registered action" picks `chain.create` when both are registered and `chains.new` when only it is; `useWizardMark` props for on/pulse/off (render a tiny component with `renderToString` inside a provider seeded with a run at a given step); hooks are no-ops without an active walkthrough (renders unchanged); `WizardInline` renders the step text and "Next" when its step is current and nothing otherwise; check tone: fail + edited → amber.
- [ ] RED → implement → GREEN. Commit.

### Task 4: Page bindings

**Files:**
- Modify: `pages/Accounts.tsx`, `pages/ChainsPage.tsx`, `components/NewChainDialog.tsx`, `pages/Assets.tsx`, `components/LaunchAssetDialog.tsx`, `pages/Swap.tsx`, `components/MakeOfferCard.tsx`, `components/TakePanel.tsx`, `pages/SwapReport.tsx` (area mark for `view`)
- Test: `packages/web/test/wizard-pages.test.ts`

**Interfaces:**
- Consumes: Task 3 hooks and binding ids (verbatim).
- Each page: `useWizardField` for each listed field id on its own state; `useWizardAction` on each action id calling the same handler the button calls; `useWizardMark` on the control and its card/area; `useWizardReport` called when the action **completes successfully** with that step type's `Outputs`, whoever pressed:
  - Accounts → `account` `{label, address}` after create.
  - NewChainDialog → `chain` `{id, name}` after create (it already selects the chain).
  - LaunchAssetDialog → `launchAsset` from the `Asset` it launched.
  - Swap: deploy → `deploySwap {address}`; approve (both cards) → `approve {tx}` (make `approve` return the receipt); create → `makeOffer {offerId, tx}` (from the parsed `OfferMade` id); take → `take {tx, reverted, error}` (reverted takes report too; `error` = the report's decoded error name).
  - MakeOfferCard: `offer.side` sets the Sell/Buy toggle (`ask` | `bid`), `offer.amount`, `offer.price`; TakePanel: `take.offer` selects the offer (lifted: Swap's `setSelected(BigInt(v))`).
- [ ] Failing tests (`renderToString` with a provider seeded at a step): Accounts at an `account` step renders the label input with the initial label and `data-wz-pulse` on "Create account"; Swap's MakeOfferCard (rendered directly with fixture assets) at the `offer` step carries `data-wz-on` on its card and `data-wizard="offer.create"` on the create button; outside a walkthrough Accounts/Swap render no `data-wz-*` attributes except `data-wizard`.
- [ ] RED → implement → GREEN. Commit.

### Task 5: Get started page

**Files:**
- Create: `packages/web/src/pages/GetStarted.tsx`; icon `FlagIcon` in `ui/icons`
- Modify: `App.tsx` (`groups`: "Get started" first under Setup; route `/get-started`; default redirect stays `/accounts`)
- Test: `packages/web/test/get-started.test.ts`

**Interfaces:**
- Consumes: `bundled`, `validate`, `loadRun`, `WizardProvider.start/restart`.
- Edited copies: kv store `walkthroughEdits`, key = walkthrough id; the list shows the edited copy when present, marked "edited", with "Reset to original".
- Per spec "Get started page": cards with title, summary, step count, progress `n of m` when a run exists; Start / Resume / Restart; View JSON (read-only `<pre>`); Edit JSON (textarea, `validate` on every change, errors listed as `step · field — message`, Save disabled while invalid).
- [ ] Failing tests: page lists both bundled walkthroughs with step counts; an invalid edit shows its error and disables Save; a saved edit is listed as "edited" and Reset removes it; `groups` Setup is `['Get started', 'Accounts', 'Chains']`.
- [ ] RED → implement → GREEN. Commit.

### Task 6: Docs and checklist

**Files:**
- Create: `packages/web/walkthroughs/README.md` (format: keys, steps, args per type, checks, `$` references, how both runners use a file, how to add one)
- Modify: `docs/board/board.md` (t-76 Done), `docs/adr/decisions.md` (ADR-0017 consequences: anything learned), `docs/risks/risks.md` (risks found, e.g. ribbon waiting on a page that never registers its action)
- Report: browser checklist in the task report: run `gbp-usd` with Next only, in both layouts and focus on/off; rename GBP→EUR mid-run and see amber; reload mid-run and resume; `take-without-approval` ends on its report; phone width; three themes.
- [ ] Write, regenerate cards, full test + build. Commit.
