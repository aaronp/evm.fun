# Playground: app bar, combined Chains page, explorer views — design

Date: 2026-11-19 · Status: draft for approval

Builds on:
- `2026-11-19-playground-theme-design.md`, including Addendum 2 (combined Chains + Explorer)
- branch `plan3-playground`
- the block-explorer mockup `evm-benchmarks/design/blocks/Main.dc.html`, kept local and not in git

## Intent

A more capable block explorer, folded into one Chains page and driven from a new **app bar** where each page can put its own icon buttons. The work is in three steps. **This document specifies step 1 in full.** Steps 2 and 3 are recorded below so step 1 doesn't box them in.

### Roadmap

1. **App bar, combined Chains page and four explorer views** (this document): Fisheye, Table, Chain, Timeline.
2. **Export / import and named snapshots:**
   - Export the selected chain's full webevm state to a downloaded `.json` file, and import such a file as a new chain.
   - Named snapshots are saved in the browser and listed per chain. "Open as new chain" has the same effect as a download/upload round trip.
   - Imported or snapshot-born chains record where they came from.
   - **Restore (rewind) a chain to one of its snapshots** (user request; the explicit way to demonstrate forks):
     - A modal warns that blocks after the snapshot will be discarded.
     - It offers "Save current state as a snapshot first", **checked by default**, then Restore and Cancel.
     - The saved "future" can then be opened as a new chain, and the two chains form a fork.
3. **Fork views:**
   - Chains that share history (identical blocks up to some height, which is what step 2 produces) are grouped as a family.
   - When the selected chain has relatives, the app bar adds **Git graph** (one lane per chain) and **Fork tree** (fork points and tips), plus a "longest chain" canonical marker.
   - "Heaviest work", miner, difficulty and finality stay out: there is no mining, so they'd be invented.
   - Step 2 starts with a spike confirming block hashes survive an export/import round trip, so families can be matched by hash.

## Goals (step 1)

- **App bar.** A bar across the top of the main content area on every page.
  - The left side shows the page title. On the Chains page it also shows a breadcrumb: Chains › chain name › Block #n / Tx … / Address ….
  - The right side holds page-specific actions.
  - Pages register their title and actions through a small hook (`useAppBar({title, crumbs?, actions})`).
  - Actions are icon buttons (a visible icon, plus `sr-only` text and a `title`) or icon segmented toggles. The toggles reuse `ui/segmented.tsx` with the accent-border selected state.
  - On narrow screens the actions wrap under the title, and the page never scrolls sideways.
  - Other pages may register no actions. The bar then shows just the title. Existing in-page buttons are not moved in this step.
- **Combined Chains page** (as in Addendum 2):
  - the filterable chain list with All / Saved / Benchmark runs tabs
  - the round "+" opening a native `<dialog>` with the create form (`ChainTypePicker`, `ChainTypeHelp`, prefund)
  - selecting a chain sets the global current chain
  - a chain header with Delete
  - routes `/chains`, `/chains/block/:n`, `/chains/tx/:hash` and `/chains/address/:addr`, with redirects from `/explorer/*`
- **Explorer views, chosen from the app bar** (icon segmented toggle "View", remembered per browser in `evmb.explorerView`, default **Table**):
  - **Table:** today's latest-blocks table, paged by 20, plus a text filter that removes non-matching rows. The filter matches the block number exactly, or a hash prefix.
  - **Chain:** the selected block with up to 3 parents and 3 children as linked cards, plus **Parent** / **Child** buttons and ←/→ keys to move along. Without a selection it shows the tip.
  - **Timeline:**
    - The most recent window of blocks (up to 500) placed along a time axis by timestamp.
    - Each mark's size reflects its tx count, so plain chains show many small evenly-spaced blocks and sequencer chains a few large ones.
    - Clicking a mark selects that block. The filter dims non-matching marks.
    - Axis labels are ISO times. A caption states how many blocks are shown out of the total.
  - **Fisheye:** a lens list of the same window.
    - Port the mockup's pure lens maths (`lensSizes`, `lensPos`, `lensFocus`: Gaussian magnification around a continuous focus index, normalised to the lens length) into `src/explorer/lens.ts`, with unit tests.
    - The pointer position sets the focus. At rest it focuses the newest block, or the selected one if any.
    - ↑/↓ keys move the focus. Clicking selects. The filter dims.
    - Orientation is vertical. Use the mockup's default magnify and spread values. No tuning controls in step 1.
- **Selected-block panel** (from the mockup), shown beside every view on wide screens (`lg`) and below it on narrow ones:
  - Block #n, the hash in mono with copy, the timestamp, and the tx count.
  - **Parent** (link, or "None — genesis block") and **Child** (link, or "None — this is the tip").
  - "Transactions · first 10 of N", linking to tx pages.
  - Selecting a block in any view navigates to `/chains/block/:n`, so selection lives in the URL, survives a reload and works with Back.
- **Real data only.**
  - No fork rule, orphans, finality, confirmations, miner or difficulty in step 1.
  - Status is shown only from real receipts, on tx pages.
  - Placeholders and the mockup's invented values never appear.

## Non-goals (step 1)

- Export/import, snapshots, restore and fork views (steps 2–3).
- Fisheye tuning controls (magnify/spread/length/orientation), lens animations.
- Moving other pages' existing buttons into the app bar. The bar exists for them, but adopting it is optional and later.
- Virtualised rendering beyond the 500-block window.

## Anti-goals

- **Fabricated chain facts:** any value not read from the node.
- **Breaking existing links or behaviour:** every plan-3/4 behaviour and route keeps working, either through redirects or unchanged.
- **Colour-only meaning:** view toggles, the selected block and dimmed vs matching marks must also differ by shape, outline or text, not colour alone.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | App bar as a shell component fed by a `useAppBar` hook. Views are separate components sharing one data hook (`useBlockWindow`) and URL-held selection | Small, testable pieces; adding a view = one component + one toggle entry |
| B | Each page renders its own top bar | Duplicated markup, inconsistent placement |
| C | Port the mockup's single monolithic component | Mixes six views, fork logic and invented data. Hard to test, and doesn't fit our routes |

## Data

- **New:** `blockWindow(handle, limit = 500): Promise<{headers: {number, hash, parentHash, timestamp, txCount}[]; total: number}>` in `src/explorer/data.ts`.
  - It reads the newest `limit` headers (newest first) via `eth_getBlockByNumber(n, false)`.
  - It never throws, using the same tolerant conversion as the rest of the data layer.
  - `useBlockWindow(handle, tick)` caches it per chain and re-reads when the chain gets new blocks. It uses the existing `onNewHead` if available, otherwise a refresh button in the app bar.
- **Existing:** `block`, `tx`, `address` and `classify` are reused unchanged.

## Constraints

- Same as the theme design:
  - tokens only (the raw-colour guard)
  - contrast tests
  - no new runtime dependencies
  - DOM-free unit tests for the pure parts: `filterChains`, `lens.ts`, timeline scale, block-filter matching
  - React 19 / Tailwind 4 / Vite
- Icons are inline SVG in `src/ui/icons.tsx`: table, chain-link, timeline, fisheye (lens), plus, refresh, copy. The mockup's paths are used where it has them.
- Board cards go on `docs/board/board.md`. Any new decision gets an ADR, and new risks go in the register, as before.

## Calls made by Claude (correct if wrong)

- **Default view is Table:** most familiar, and it has the filter that removes rows.
- **Window of 500 blocks** for Timeline and Fisheye, with a caption showing the count. Table keeps paging through all blocks.
- **Filter semantics:** an exact block number, or a hex prefix of a block hash (with or without `0x`). Table removes non-matches; the other views dim them, as the mockup describes.
- **Selection lives in the URL** (`/chains/block/:n`), not in component state.
- **The "+" new-chain button stays in the chain list header**, as approved. App-bar actions on the Chains page are the View toggle and Refresh.

### Settled after the builder check (Claude's calls)

- **One box for search and filter.**
  - The existing Explorer search box stays, at the top of the explorer pane. It is the only text input.
  - **Typing** filters blocks live: an exact block number or a block-hash prefix. Table removes non-matches; the other views dim them.
  - **Enter** navigates as today via `classify`: a block number goes to the block, a 32-byte hash to the tx, an address to the address page, and unknown input shows "Not found".
  - The app bar holds only the View toggle and Refresh.
- **Panel vs full block page.**
  - `/chains/block/:n` renders the current view with the selected-block panel. The panel shows a summary and the first 10 txs, plus "All N transactions →".
  - That link goes to `/chains/block/:n/txs`, which keeps today's full block detail with txs paged by 50 (the existing `Block` component, unchanged). No behaviour is lost.
- **Table filter scope.**
  - With no filter, Table pages through *all* blocks as today.
  - With a filter, it shows the matches within the 500-block window, paged by 20, with a caption: "Filtering the latest 500 blocks".
- **No selection, and out-of-window selection.**
  - At `/chains` the panel shows the tip, headed **"Latest block"**, so it's clearly not a selection. The URL stays `/chains`.
  - A selected block outside the 500 window still loads in the panel and the Chain view, via the existing `block()` fetch.
  - Timeline and Fisheye then show a caption, "Block #n is older than the latest 500 shown", and rest on the newest.
  - Parent/child links always come from `block()` fetches, not window lookups.
- **Refresh:** `ChainHandle` has no `onNewHead`, so the window refreshes on the app-bar Refresh button. It also refreshes whenever the app's `balanceTick` changes, which every send already bumps. There is no polling.

## Left to the builder

Exact layout spacing, timeline mark shape, how many chain cards fit at each width, the lens's pixel length at each breakpoint, and the `useAppBar` implementation (context or store).
