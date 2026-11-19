# Playground look & feel and themes — design

Date: 2026-11-19 · Status: draft for approval · Builds on: `2026-11-19-playground-design.md` (plan 3, branch `plan3-playground`)

## Intent

Give the browser playground the designer's look and feel. The redesign mockups are in `evm-benchmarks/design/project/*.dc.html`, with notes in `design/README.md`. The playground should support three themes: **Dark** (the designer's palette), **Light**, and **Paper**.

The mockups are reference material. They need the design tool's `support.js` runtime, so they can't be copied in directly. We port their look into our existing React + Tailwind pages.

## Goals

- **Theme tokens.** One set of semantic colour tokens, defined as CSS variables per theme. Tailwind 4 maps them to utility classes. Page and component code never uses a raw colour value.
- **Three themes, switchable from the sidebar.** The choice is remembered in localStorage, wrapped in a try/catch so it falls back gracefully. The first-visit default follows `prefers-color-scheme`: Dark if dark, Light otherwise.
- **Shared building blocks rebuilt to match the mockups.** That covers button (primary, ghost and danger), card, input/select, badge/status pill, table, notice, and nav link.
  - **Fonts:** Inter for UI text, Space Grotesk for headings and the brand, JetBrains Mono for code, addresses and hashes.
  - **Icons:** the mockups' inline SVG icons, copied into one icon module. No icon library.
- **App shell matches `Main.dc.html`:**
  - Grouped sidebar: a brand block reading "EVM Playground · webevm 0.9.1 · revm", then "Setup" (Accounts, Chains) and "Build & run" (Studio, Transact, Explorer, Benchmark).
  - An **active context** box showing the selected chain (name and type) and the selected account (label and ETH balance).
  - The theme switcher.
- **Each of the six existing pages restyled to follow its mockup's layout and visual treatment:**
  - **Accounts and Chains** follow the account and chain cards in `Main.dc.html`.
  - **Chains** also follows the chain-type cards in `ChainWizard.dc.html`, but as the current single-form create. There is no wizard.
  - **Studio** follows `Studio.dc.html`: the editor panel, compile status, and deploy panel.
  - **Transact** follows `Transact.dc.html`: function rows where state-writing functions use the warning/orange tint and read-only functions the accent/blue tint, and the receipt panel.
  - **Explorer** follows `Explorer.dc.html`: search, the blocks table and the tx detail.
  - **Benchmark** follows `Benchmark.dc.html`, for the run form, the KPI tiles (TPS, p50, p99), the phase breakdown, the trade-offs chips and the session table.
- **Behaviour unchanged.** All existing tests stay green. Every current feature still works: the address datalist, chain-type help, storage notice, key warning and phone-width layout.

## Non-goals (mockup features deliberately left out)

- Workspace dashboard and the "Getting started" tracker.
- The 3-step chain wizard, and its "What this costs you" panel.
- Studio's file sidebar, ABI/bytecode tabs, and line/column status bar.
- Transact's Simulate, session history, and balance-changes panel.
- Explorer's status filter, state diff, and "Replay in Transact".
- Benchmark's export JSON, percentile chart, p90/p99.9, histogram, and run comparison.
- New engine options. Parallel execution, state root and log options are not built yet. See the answers given to the designer below.

These can come later as separate pieces of work. Where a mockup panel exists only to host one of them, it is dropped. It is not shown with placeholder data.

## Anti-goals

- **Showing placeholder or invented data.** The mockups' bracketed values and the designer's assumed scenario and sender labels must not appear. Only real values are shown.
- **Hard-coding colours.** A colour hard-coded anywhere in components breaks themes. A test or grep check guards this.
- **Losing accessibility.** Text and background pairs must meet WCAG AA contrast in all three themes. Focus rings must stay visible, and status must never be shown by colour alone.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Semantic CSS-variable tokens + Tailwind 4 theme mapping + rebuilt shared components; pages restyled | One styling system; new theme = new values only |
| B | Port mockup inline styles to a separate stylesheet, wrap existing logic | Fastest fidelity, but two styling systems to maintain |
| C | Themed component library (daisyUI, shadcn/Radix) | New dependency; look fights the designer's palette |

## Tokens

The names are semantic. The Dark values are taken from the mockups' most-used colours.

| Token | Use | Dark |
|---|---|---|
| `bg` | page background | `#0A0C10` |
| `panel` | sidebar, editor chrome | `#0E1117` |
| `surface` | cards | `#121620` |
| `surface-hover` | row/nav hover | `#151A25` |
| `selected` | active nav, selected row | `#1A2133` |
| `line` | dividers | `#1C2230` |
| `line-strong` | card borders | `#232A38` |
| `input-line` | input borders | `#2C3446` |
| `text` | primary text | `#E7EAF0` |
| `text-2` | secondary text | `#C3CAD8` |
| `muted` | labels | `#A3ACBD` |
| `subtle` | captions | `#97A0B3` |
| `faint` | section headings | `#8A93A6` |
| `disabled` | disabled | `#5A6377` |
| `accent` / `accent-hover` / `accent-soft` / `on-accent` | primary action, links, read-only fns | `#8AA8FF` / `#B3C6FF` / `#141B2E` / `#0A0C10` |
| `success` / `success-text` / `success-soft` | verified, success | `#4ADE80` / `#86EFAC` / `#173A27` |
| `warn` / `warn-text` / `warn-soft` | state-writing fns, pending | `#FFB054` / `#FFD7A3` / `#2A2416` |
| `danger` / `danger-soft` | errors, reverted | `#FF8A8A` / builder picks |
| `code-keyword` / `code-string` | editor highlighting | `#C792EA` / `#7FDBCA` |

- **Light:** the same tokens, as a light counterpart to Dark.
- **Paper:** the same tokens, a warm theme anchored on the agile board's paper colours:
  - bg `#EFE8DC`
  - surface `#FFFDF7`
  - text `#2B2622`
  - muted `#5F574E`

  Accents are adjusted to keep AA contrast.
- The builder picks the remaining Light and Paper values. They must pass the contrast check below.

## Constraints

- **Location:** `evm-benchmarks/packages/web` (Vite, React 19, Tailwind 4). Theme variables live on `:root[data-theme=…]`, set before first paint by a small inline script in `index.html`, so there is no flash of the wrong theme.
- **Fonts:** Google Fonts `<link>` (Inter, Space Grotesk, JetBrains Mono), with system fallbacks so the site still works offline.
- **Dependencies:** no new runtime dependencies.
- **Editor:** CodeMirror's theme is driven by the same tokens.
- **Git and project docs:** work continues on branch `plan3-playground`. The project docs (board, risks, ADR) are updated as before.

## Decided by the user

- Mainly the look, not the mockups' new features.
- Three themes: Dark, Light, Paper.
- Approach A.

## Calls made by Claude (correct if wrong)

- Pages keep their current routes and features. The mockups' layout is applied per page, and panels for out-of-scope features are dropped.
- The Chains page keeps a single-form create, styled like the wizard's chain-type cards. That includes the existing plain-vs-sequencer help.
- First-visit theme follows the OS setting. The switcher lives in the sidebar footer.
- Contrast is checked by a unit test that computes WCAG ratios for key token pairs in each theme (text/bg, text/surface, muted/surface, on-accent/accent).
- Raw colours are guarded by a test that greps `src/**/*.tsx` for hex and `rgb(` literals outside the tokens file.

### Settled after the builder check (Claude's calls)

- **Trade-off chips:** these come straight from `RunResult.approach.tradeoffs` (evm, stateRoot, log, sigVerify, execution, notes), plus any `params.opts` (e.g. `block=500`) and `env.engine`. All of it is real data, so no core change is needed. Values are shown exactly as recorded, never the mockup's wording.
- **Phase breakdown:**
  - Two tiles: **Run (timed)** = `durationMs`, and **Signing (untimed)** = `signingMs`, captioned "untimed · includes browser yields".
  - Below them, one row per `phases` entry, labelled by its key, only when present. Nothing is shown when `phases` is absent.
  - The mockup's "vs #1" deltas are dropped, because they are run comparison.
- **Active context box:**
  - Shows the chain name and type, and the account label (falling back to the short address).
  - Shows the account's ETH balance, via a small shared `useBalance(handle, address)` hook. It re-reads on chain or account change and after any send, using a refresh counter in app state that sending bumps. It shows "—" when the balance can't be read.
  - This is a read-only display the design calls for. Accepted as part of the look.
- **Brand line:** reads the engine from the approach meta (`meta.engine`, e.g. `webevm@0.9.1+revm`), not hard-coded text.
- **Contrast test (WCAG AA):**
  - **Text pairs at ≥ 4.5:1**, in every theme:
    - `text`, `text-2`, `muted` and `subtle` on `bg`, `surface` and `selected`
    - `faint` on `bg` and `surface`
    - `accent`, `success-text`, `warn-text` and `danger` on `surface`, and on their own `-soft` backgrounds
    - `on-accent` on `accent`
  - **Focus ring:** `accent` on `bg` and on `surface`, at ≥ 3:1.
  - **Exempt:** `disabled`, and decorative borders (`line`, `line-strong`, `input-line`). Inputs are identified by their labels and the focus ring.
  - Dark hexes may be nudged only where a listed pair fails, and each change gets a comment.
- **Raw-colour guard:**
  - Greps `src/**/*.{ts,tsx,css}` for hex, `rgb(`/`rgba(`/`hsl(` literals, everywhere except the one tokens file.
  - `var(--…)` and `color-mix(... var(--…) ...)` are allowed.
  - CodeMirror's theme and highlight style use `var(--…)`.
- **Theme switcher:**
  - A 3-way segmented control built from radio inputs, labelled "Theme".
  - localStorage key `evmb.theme`. If storage fails, it silently falls back to the OS default. The StorageNotice is not changed.
- **Tests:** stay DOM-free, with no new dev dependency. The contrast and raw-colour tests are pure. The switcher and the pre-paint script are verified in the browser smoke check in all three themes.
- **Fonts:** a Google Fonts `<link>` is acceptable, with system fallbacks.
- **Narrow screens:**
  - Below `sm`, keep the current wrapping top bar.
  - The context box becomes a compact one-line strip under the nav, showing chain · type · account · balance.
  - The theme switcher sits at the end of the bar.

## Answers given to the designer (record)

- **Supported strategies:** plain (01) and sequencer (02) only.
  - Parallel execution and per-block state root are planned, not built.
  - "Logs" in the trade-offs means the sequencer's ordering-log durability, not EVM event logs.
- **Per-tx latency:** already measured by the runner, but only p50/p99/max are kept. Exposing the full list is a small core change. It is out of scope here.
- **Sequencer settings:** approach 02 accepts `block` (txs per block, default 500), `chunk` (250) and `workers` (cores−1). There is no time interval. These settings are not exposed in the playground yet.

## Left to the builder

The exact Light and Paper values (subject to the contrast test), component APIs, the icon set picked from the mockups, spacing details, and how to restyle each page within its mockup's layout.

## Addendum: latency distribution chart (user request, 2026-11-19)

**What:** A chart on the Benchmark page that overlays the per-transaction latency distribution of every run in the session. Each run gets its own colour. A toggle switches between **Histogram** (the default) and **Cumulative** (CDF). Both views are hand-drawn SVG with no chart library.

**Data:**
- `runBenchmark` gains `keepSamples?: boolean` (default `false`). When it is true, `RunResult.latencySamplesMs` holds every tx's latency (ms, sorted ascending).
- The browser passes `true`. The CLI does not, so result JSON files are unchanged.

**Histogram:**
- All runs share one set of bin edges: 40 equal bins from the smallest to the largest sample across the runs shown.
- The y axis is the share of that run's txs (%), so runs of different N compare fairly.
- Each run is drawn as a step outline with a light fill.

**Cumulative:**
- x is latency (ms), y is the 0–100 % of txs at or below that latency.
- One line per run. p50 and p99 can be read off the curve.

**Colours and legend:**
- New tokens `--c-series-1` … `--c-series-6` per theme, cycled by run order. The contrast test checks each against `surface` at ≥ 3:1 (graphics).
- The legend shows each run's name, its colour swatch, and its p50 and p99, so colour is never the only key.

**Accessibility:**
- The SVG has `role="img"` and an `aria-label` summarising the runs.
- The toggle is a labelled radio group, like the theme switcher.

**Honesty:**
- A caption notes that all txs are submitted at once, so latency largely reflects queue position. This matches REPORT.md.
- Runs without samples are not plotted.

**Out of scope:** p90/p99.9 tiles, hover tooltips, chart export.
Theme switcher: icon toggles (user request) — moon=Dark, sun=Light, page=Paper; each keeps an accessible name (sr-only text) and a title tooltip; radio semantics and focus ring unchanged.
