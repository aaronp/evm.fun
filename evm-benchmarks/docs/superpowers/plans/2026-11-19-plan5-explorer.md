# evm-benchmarks Plan 5: App bar, combined Chains page, explorer views (step 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an app bar on every page with page-specific icon actions. Merge Chains and Explorer into one Chains page with a filterable chain list and a "+" new-chain dialog. Give the explorer four views (Table, Chain, Timeline, Fisheye) and a selected-block panel.

**Architecture:**
- **App bar:** a shell component fed by `useAppBar({title, crumbs?, actions})`.
- **Chains page:**
  - Left: the chain list (`filterChains`) and a native `<dialog>` for creating a chain.
  - Right: the explorer pane.
- **Explorer data:** views share a `useBlockWindow` hook (the latest 500 headers). The selected block lives in the URL (`/chains/block/:n`).
- **Pure logic in testable modules:** `filterChains`, `blockMatches`, `lens.ts`, `timeline.ts`.

**Tech Stack:** React 19, Tailwind 4, Vite, Bun test (DOM-free). No new runtime dependencies.

**Spec:** `evm-benchmarks/docs/superpowers/specs/2026-11-19-explorer-design.md`. Its "Settled after the builder check" section is binding. It also builds on Addendum 2 of `2026-11-19-playground-theme-design.md`.

**Supersedes:** Task 10 of plan 4 (`2026-11-19-plan4-theme.md`). Don't execute that task.

## Global Constraints

- **Colours:** colour tokens only. The raw-colour guard and the contrast tests must stay green.
- **Shared building blocks:** reuse `src/ui/` (Button, Card, Panel, Input, Badge, Table with `th`/`td`, Segmented, Notice, icons) and `ChainTypePicker`/`ChainTypeHelp`.
- **Dependencies:** none new.
- **Real data only:** no fork rule, finality, confirmations, miner, difficulty, or mockup placeholder values.
- **Accessibility:** status and selection must never be shown by colour alone. Icon buttons have `sr-only` text and a `title`. Toggles use `ui/segmented.tsx`. The dialog uses `showModal()`, closes on Esc, and returns focus to the "+" button.
- **Routes:**
  - The routes are `/chains`, `/chains/block/:n`, `/chains/block/:n/txs`, `/chains/tx/:hash` and `/chains/address/:addr`.
  - `/explorer` and `/explorer/*` redirect to the matching `/chains` route.
  - Every internal link uses `/chains…`. After Task 2, `grep -rn "/explorer" src/` must show only the redirect routes.
- **Behaviour kept:** every plan-3/4 behaviour stays, including:
  - paging, "Not found", the never-throws data layer and registry contract names
  - ephemeral chains, the selected chain driving the ContextBox, Studio and Transact
  - StorageNotice and the address datalist
  - "Open in Explorer" from Benchmark and the block link in Transact's Result panel
- **localStorage key:** `evmb.explorerView`, values `table|chain|timeline|fisheye`, default `table`, accessed through try/catch.
- **Project docs and git:**
  - **Board:** `docs/board/board.md` (strict format). Each task moves its card to Doing at the start and Done at the commit, with real `date -u` timestamps and `owner: Claude`. Card check: `node_modules/.bin/agile card docs/board/board.md <dir>`, then delete the `card.json` it writes.
  - **Branch:** `plan3-playground`. Git writes and `bun install` need the sandbox disabled. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - **Checks at every task end:** the full `bun test` from evm-benchmarks/, `make build`, and tsc on the changed files:

    `bunx --package typescript@5 tsc --noEmit --strict --jsx react-jsx --moduleResolution bundler --module esnext --target es2022 --skipLibCheck <files>`

    Run it unsandboxed with `allowed_domains: ["registry.npmjs.org"]`. Ignore TS5097 and errors that were already there.

## Review Focus

1. **Old links still land.** `/explorer/block/5` and Benchmark's "Open in Explorer" go to the right `/chains` view with the right chain selected. Test in Task 2 (`legacyRoute` mapping).
2. **One box for search and filter.** Typing a number or hash prefix filters; pressing Enter on a full tx hash, address or number navigates; garbage input shows "Not found". Test in Task 3 (`blockMatches`, and `classify` reuse).
3. **Empty and edge chains.**
   - A chain with only genesis: Chain view has no parent or child, Timeline has a single mark, Fisheye has a lens of 1 (the mockup throws below 1 item, so handle 0 as an empty state).
   - No chains at all: the empty state points at "+".
   - Tests: Tasks 4–6 (`lensSizes(1,…)`, `timeScale` with one block, and the empty window).
4. **A selected block outside the 500 window** still shows in the panel and in Chain view, and Timeline/Fisheye show the "older than" caption. Test in Task 3 (`windowContains`).
5. **Phone width.** The app-bar actions wrap, the chain list becomes a compact picker above the pane, Timeline and Fisheye scroll inside their card, and the page never scrolls sideways. Checked in the Task 7 browser check.

---

### Task 1: App bar

Board: add cards t-38…t-44 for Tasks 1–7 (To Do). Mark plan 4's t-37 as superseded by editing its description; leave it in To Do or archive it. Then move t-38 through Doing to Done.

**Files:**
- Create: `src/components/AppBar.tsx`, `src/state/appBar.tsx` (context, provider, `useAppBar` hook), `test/appbar.test.ts`
- Modify: `src/App.tsx` (render AppBar at the top of main), every page (register a title; no actions yet), `src/ui/icons.tsx` (add `TableIcon`, `ChainLinkIcon`, `TimelineIcon`, `LensIcon`, `PlusIcon`, `RefreshIcon`, and `CopyIcon` if missing)

**Interfaces:**
```ts
type AppBarAction =
  | {kind: 'button'; id: string; label: string; icon: ReactNode; onClick: () => void; disabled?: boolean}
  | {kind: 'toggle'; id: string; label: string /* group label */; value: string; options: {value: string; label: string; icon: ReactNode}[]; onChange: (v: string) => void}
interface AppBarConfig { title: string; crumbs?: {label: string; to?: string}[]; actions?: AppBarAction[] }
useAppBar(config: AppBarConfig): void   // registers while the page is mounted, then clears
crumbsFor(pathname: string, chainName?: string): {label: string; to?: string}[]   // pure, in appBar.tsx
```
- `crumbsFor('/chains/block/12', 'demo')` gives `[{label:'Chains',to:'/chains'},{label:'demo',to:'/chains'},{label:'Block #12'}]`.
- For a tx path it gives `Tx 0x1234…abcd`, and for an address path `Address 0x…`.

- [ ] **Step 1: Write failing test** `appbar.test.ts` for `crumbsFor`:
  - the chains root
  - a block
  - a tx (shortened)
  - an address
  - an unknown path, which gives just the page
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - **Bar:** the title in `font-display`, the crumbs as links, and the actions on the right. Buttons are icon-only `Button variant="ghost" size="sm"` with `sr-only` labels and a `title`. Toggles use `Segmented` with icons.
  - **Narrow screens:** the actions wrap.
  - **Pages:** every page registers its title.
- [ ] **Step 4:** Run the checks.
- [ ] **Step 5:** Board. Commit `feat(web): app bar with per-page actions and breadcrumbs`.

### Task 2: Combined Chains page, new-chain dialog, routes

Board: t-39.

**Files:**
- Create: `src/chain/filter.ts`, `src/components/NewChainDialog.tsx`, `src/pages/ChainsPage.tsx`, `src/routes.ts`, `test/chain-filter.test.ts`, `test/routes.test.ts`
- Modify: `src/App.tsx` (nav: one "Chains" entry, with the Explorer entry removed; routes; redirects), `src/pages/Explorer.tsx` (becomes the right-hand pane under `/chains`), `src/components/ReceiptView.tsx`, `src/pages/Benchmark.tsx`, `src/pages/Studio.tsx` (links)
- Delete: `src/pages/Chains.tsx`, once its pieces have moved

**Interfaces:**
- `filterChains(chains: ChainInfo[], q: string, tab: 'all'|'saved'|'bench'): ChainInfo[]`, as in the theme spec's Addendum 2.
- `legacyRoute(path: string): string | null` in `src/routes.ts` maps `/explorer`, `/explorer/block/5` and so on to `/chains…`. Anything else gives null.
- **ChainsPage layout:**
  - **List:** the "Filter chains" Input, Segmented tabs (All / Saved / Benchmark runs), and rows showing the name, a type Badge, the block height (via `eth_blockNumber`, "—" until it loads), and a "benchmark" Badge for ephemeral chains. The selected row gets `border-accent` plus a "selected" Badge. The round "+" (`PlusIcon`, `aria-label="New chain"`) opens NewChainDialog.
  - **Narrow screens:** the list is a compact Select of chains, with the "+" beside it.
  - **Right pane:** a chain header (name, type Badge, created time, and Delete with `confirm`, deselecting first), then the explorer pane.
  - **No chains:** an empty state pointing at "+".
- **NewChainDialog:** a `<dialog>` opened with `showModal()`. It contains the existing create form (name, `ChainTypePicker` with help, prefund checkboxes defaulting to all accounts). Esc or Cancel closes it. Create closes it and selects the new chain. Focus returns to "+".

- [ ] **Step 1: Write failing tests:**
  - `filterChains`: an empty query with the `all` tab, a case-insensitive trimmed query, the tabs, and preserved order.
  - `legacyRoute`: every `/explorer` form maps correctly, and a non-explorer path gives null.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. The explorer pane keeps its current internals for now; Task 3 rebuilds it.
- [ ] **Step 4:** Run the checks. Run `grep -rn "/explorer" src/` and confirm only the redirect routes remain.
- [ ] **Step 5:** Board. Commit `feat(web): combined Chains page with new-chain dialog and /chains routes`.

### Task 3: Block window, View toggle, Table view, selected-block panel, search and filter

Board: t-40.

**Files:**
- Create: `src/explorer/window.ts` (`blockWindow`, `blockMatches`, `windowContains`), `src/explorer/useBlockWindow.ts`, `src/explorer/views/TableView.tsx`, `src/explorer/SelectedBlock.tsx`, `test/window.test.ts`
- Modify: `src/explorer/data.ts` (if needed), `src/pages/Explorer.tsx` (pane shell: search/filter box, the active view, SelectedBlock; `/chains/block/:n/txs` renders the existing full `Block` detail), `src/pages/ChainsPage.tsx` (registers the app-bar View toggle with 4 icon options, plus Refresh)

**Interfaces:**
```ts
interface Header { number: number; hash: Hex; parentHash: Hex; timestamp: number /* s */; txCount: number }
blockWindow(h: ChainHandle, limit = 500): Promise<{headers: Header[] /* newest first */; total: number /* head+1 */}>   // never throws
blockMatches(header: Header, q: string): boolean    // '' matches all; digits match the number exactly; hex with or without 0x matches a case-insensitive hash prefix
windowContains(headers: Header[], n: number): boolean
useBlockWindow(h?: ChainHandle): {headers, total, loading, refresh()}   // re-reads on refresh() and when balanceTick changes
```
- **View toggle:** a Segmented control with `TableIcon`, `ChainLinkIcon`, `TimelineIcon` and `LensIcon`, persisted to `evmb.explorerView`. Views that aren't built yet render "Coming in this plan" until Tasks 4–6. This is never shipped; Task 6 removes it.
- **Search/filter box:**
  - typing sets `q`, which Table filters on and other views dim on
  - Enter calls `classify(q)` and navigates to `/chains/block/:n`, `/chains/tx/:hash` or `/chains/address/:a`, or shows "Not found" for invalid input
- **TableView:**
  - With no `q`, it keeps today's paged latest-blocks table (20 rows).
  - With `q`, it shows `headers.filter(blockMatches)` paged by 20, with the caption "Filtering the latest 500 blocks".
  - Clicking a row navigates to `/chains/block/:n`.
- **SelectedBlock panel:**
  - **Heading:** "Block #n", or "Latest block" when there's no `:n` in the route.
  - **Hash:** mono, with a copy button.
  - **Timestamp and tx count.**
  - **Parent:** a link, or "None — genesis block".
  - **Child:** a link, or "None — this is the tip". It comes from `block(n+1)`.
  - **Transactions:** "Transactions · first 10 of N", each linking to its tx page, then "All N transactions →" to `/chains/block/:n/txs`.
  - **Layout:** beside the view at `lg`, below it on narrower screens.

- [ ] **Step 1: Write failing tests** `window.test.ts`:
  - `blockWindow` on a plain chain with 7 txs returns 8 headers, newest first, with `total` 8 and a genesis `parentHash`. It returns at most `limit` headers.
  - With a stub handle that throws, it gives empty headers and does not throw.
  - `blockMatches`: `''` matches; `'3'` matches only #3, not #13; a hash prefix with or without `0x` matches, case-insensitively; `'xyz'` matches nothing.
  - `windowContains` works.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the checks.
- [ ] **Step 5:** Board. Commit `feat(web): explorer block window, view toggle, table view, selected-block panel`.

### Task 4: Chain view

Board: t-41.

**Files:**
- Create: `src/explorer/views/ChainView.tsx`, `src/explorer/neighbours.ts`, `test/neighbours.test.ts`
- Modify: `src/pages/Explorer.tsx` (wire the view)

**Interfaces:**
- `neighbours(n: number, head: number, span = 3): {parents: number[] /* ascending */; children: number[]}`.
  - `neighbours(0,10)` gives `{parents:[], children:[1,2,3]}`.
  - `neighbours(10,10)` gives `{parents:[7,8,9], children:[]}`.
  - `neighbours(5,6)` gives `{parents:[2,3,4], children:[6]}`.
- **ChainView:**
  - The focus is the selected block, or the tip when nothing is selected.
  - It renders cards for the parents, the focus block and the children, fetched with `block()`, laid out horizontally on wide screens with connecting arrows, and vertically on narrow ones.
  - Each card shows #n, the short hash and the tx count. The focus card is marked with an accent border and a "selected" Badge.
  - **Parent** / **Child** buttons and the ←/→ keys (when the view has focus) navigate. They are disabled at genesis and at the tip.
  - Non-matching cards are dimmed by the filter (`opacity` plus a "filtered" sr-only note).

- [ ] **Step 1: Write failing test** `neighbours.test.ts`, covering the three cases above plus `head = 0`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the checks.
- [ ] **Step 5:** Board. Commit `feat(web): explorer Chain view`.

### Task 5: Timeline view

Board: t-42.

**Files:**
- Create: `src/explorer/timeline.ts`, `src/explorer/views/TimelineView.tsx`, `test/timeline.test.ts`
- Modify: `src/pages/Explorer.tsx`

**Interfaces:**
- `timeScale(headers: Header[], width: number, pad = 16): (ts: number) => number`. It maps the min..max timestamp onto `pad..width-pad`. With one block, or all timestamps equal, it maps to the centre.
- `markRadius(txCount: number, maxTx: number): number`. It returns 3 px for 0 txs, rising with `sqrt(txCount/maxTx)` to a maximum of 14 px.
- **TimelineView:**
  - An SVG inside an `overflow-x-auto` wrapper with `min-w-[640px]`.
  - One row of circle marks at `timeScale(timestamp)`, with radius `markRadius`, in `fill-accent`.
  - The selected mark gets a ring.
  - Non-matching marks are dimmed. Matching marks also get an outline, so the difference isn't colour alone.
  - The x axis has 5 ISO-time ticks.
  - Clicking a mark selects its block. Each mark has a `<title>` with "#n · k txs · time".
  - **Caption:** "Latest N of M blocks", plus "Block #n is older than the latest 500 shown" when relevant.
  - The SVG has `role="img"` and an `aria-label`.

- [ ] **Step 1: Write failing tests:**
  - `timeScale`: the endpoints map to `pad` and `width-pad`; a single block maps to `width/2`; all-equal timestamps map to `width/2`.
  - `markRadius`: monotonic; 0 gives 3; `maxTx` gives 14; `maxTx = 0` gives 3.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the checks.
- [ ] **Step 5:** Board. Commit `feat(web): explorer Timeline view`.

### Task 6: Fisheye view

Board: t-43.

**Files:**
- Create: `src/explorer/lens.ts`, `src/explorer/views/FisheyeView.tsx`, `test/lens.test.ts`
- Modify: `src/pages/Explorer.tsx` (wire the view, and remove the "Coming in this plan" placeholder)

**Interfaces:** port these from `evm-benchmarks/design/blocks/Main.dc.html` (the static methods on `Component`):
- `lensSizes(n, f, mag, spread, len)`: weights `1 + mag·exp(-((i-f)/spread)²)`, normalised to `len`. It throws for `n < 1`.
- `lensPos(sizes, u)`
- `lensFocus(n, p, mag, spread, len)`: a 28-iteration bisection.

Use the mockup's defaults: `mag 12`, `spread 2.5`.

**FisheyeView:**
- A vertical list of the window's blocks, newest first. Each row's height is `lensSizes[i]`, with a lens length of 860 px on `lg` and 600 px below that.
- Rows show "#n · k txs · time". Large rows add the short hash.
- The pointer's y position sets the focus via `lensFocus`.
- **At rest** it focuses the selected block if it's in the window, otherwise the newest.
- ↑/↓ keys move the focus. Clicking or Enter selects.
- The filter dims non-matching rows (with an sr-only note).
- An empty window shows an empty state rather than calling `lensSizes(0)`.

- [ ] **Step 1: Write failing tests:**
  - `lensSizes` sums to `len` (within 1e-9) and is largest at `round(f)`.
  - `lensSizes(1,…)` gives `[len]`.
  - `lensSizes(0,…)` throws.
  - `lensPos(sizes, 0)` is 0, and `lensPos(sizes, n)` is about `len`.
  - `lensFocus` inverts `lensPos` (within 0.01).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the checks.
- [ ] **Step 5:** Board. Commit `feat(web): explorer Fisheye view`.

### Task 7: README, docs, browser check

Board: t-44.

**Files:**
- Modify: `packages/web/README.md` (Chains page, app bar, explorer views), `docs/adr/decisions.md` (an ADR "Explorer views on a linear chain; fork views deferred to real fork data", accepted), `docs/risks/risks.md` (if anything new comes up)

- [ ] **Step 1:** Write the README section, the ADR and the board update. Run the checks.
- [ ] **Step 2: Browser check.** You have no browser tool, so stop here and report DONE with this checklist for the controller to give the user:
  - Dark, Light and Paper themes, at desktop and phone width.
  - The app bar on every page, and the breadcrumbs on Chains.
  - Chains: filter and tabs; "+" opens the dialog; Esc closes it and focus returns to "+"; creating a chain selects it; Delete works.
  - All four views, on a plain chain and on a benchmark sequencer chain, using the selected-block panel and "All N transactions".
  - Old links: Benchmark's "Open in Explorer" and Transact's block link.
  - From plan 4 Task 9: the distribution chart in both views with 2+ runs, and the icon theme switcher.
- [ ] **Step 3:** Commit `docs(web): Chains page and explorer views`.
