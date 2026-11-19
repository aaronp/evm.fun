# @evmb/web: browser EVM playground

A static, in-browser playground: create accounts and chains, write and deploy Solidity, send transactions, browse blocks, and run the benchmark scenarios. Everything runs client-side (revm-wasm, solc in a worker); there is no server and the built site works from any static host and path.

    make dev     # Vite dev server, http://localhost:5173
    make build   # static site -> packages/web/dist

**Keys:** Playground keys only. They are stored unencrypted in this browser's localStorage. Never use a real key.

Address inputs suggest your accounts and the contracts deployed on the selected chain; free text still works.

## Chain types

- **plain** (approach `01-webevm-baseline`): a stock webevm node. Each transaction is checked (signature recovered), executed and mined into its own block as it arrives, one tx per block. Simple and immediately consistent, but throughput is limited because every tx pays for signature recovery plus a block on a single thread.
- **sequencer** (approach `02-seq-memory`): signatures are verified in parallel in background Web Workers. A single-writer sequencer puts the transactions in a fixed order (an in-memory log feeding a ring buffer), and one executor runs them in batches, mining many transactions per block. Execution trusts the sender recovered by the workers, so signatures are not re-checked.

Measured with the CLI (n=10000, median of 3 runs, `REPORT.md`): ERC-20 transfers (erc20-disjoint) about 3.2k TPS on sequencer vs about 1.3k TPS on plain; eth-transfer about 315 vs 273. These figures are from webevm's default engine, while the playground runs revm, so browser numbers will differ. Trade-offs of the sequencer: each tx waits for its batch, so per-tx latency is higher under load; the ordering log is in memory, so transactions not yet mined are lost on reload.

Both are real EVMs running unmodified Solidity bytecode; in this playground both run on the revm engine. The full comparison, and other architectures to come, are in `evm-benchmarks/REPORT.md`.

## Chains page and explorer

The sidebar links every page and holds the theme switcher; the app bar shows the page title, breadcrumbs and page actions (on Chains, the View toggle and Refresh). **Chains** (`/chains`) combines the chain list and the explorer. Pick a chain on the left (the filter box and tabs narrow the list); the **+** button opens a dialog to create one (Esc closes it and focus returns to **+**), and Delete removes a chain. Below the `lg` breakpoint the list becomes a compact picker above the pane, without the filter box and tabs. The selected chain drives the context box, Studio and Transact. Old `/explorer/...` links redirect to the matching `/chains/...` route.

Chains are either running (they hold an engine in this tab) or stopped. The list shows the **last known height** of a stopped chain, saved whenever it changes, so you can see it without opening the chain. At most 8 chains can run at once: the page warns at 4 and refuses to start more at 8. Nothing is closed automatically; delete one or reload.

The explorer pane has four views on a linear chain, remembered in `localStorage` (`evmb.explorerView`, default Table):

- **Table**: the latest blocks, paged.
- **Chain**: the selected block (or the tip) with up to 3 parents and 3 children, Parent/Child buttons and the left/right arrow keys; when the selection is beyond the head the Parent button becomes "Go to tip".
- **Timeline**: blocks laid out along a time axis.
- **Fisheye**: a magnified list of blocks around the selection; up/down arrows move and Enter opens.

Timeline and Fisheye use the latest 500 blocks; a selected older block still shows in the selected-block panel and Chain view, and the Timeline and Fisheye captions say it is older than the latest 500. The panel lists the block's transactions ("All N transactions" opens the full list).

**Filter:** digits match the block number exactly; hex (with or without `0x`) matches a block-hash prefix. Table hides non-matches within the latest 500 blocks (a caption says so); Chain, Timeline and Fisheye dim non-matches. Enter navigates to a full tx hash, address or block number; other input shows "Not found".

Fork views come later, with snapshots, export/import and restore, when there is real fork data to show.

## Themes

Three themes: **dark**, **light** and **paper** (warm off-white). Colours are CSS custom properties (`--c-*`) defined once per theme in `src/theme/tokens.css` and mapped to Tailwind colours in `src/index.css`; components use only those tokens.

The sidebar switcher calls `setTheme()` (`src/theme/theme.ts`), which sets `data-theme` on `<html>` (instant, no reload) and saves the choice in `localStorage` under `evmb.theme`. With nothing stored, the OS `prefers-color-scheme` picks dark or light. A small inline script in `index.html` applies the theme before first paint (keep it in sync with `initialTheme()`). If storage is blocked the choice lasts for the session only.

**Add a theme:** (1) add one `:root[data-theme="name"] { ... }` block to `tokens.css` defining every `--c-*` token; (2) add `'name'` to `THEMES` in `src/theme/theme.ts` (the `Theme` type and the switcher options follow); (3) add its label to the `label` map in `src/components/ThemeSwitcher.tsx`; (4) add `'name'` to the allowed names in the inline script in `index.html`. Then run `bun test`: the contrast test discovers themes from `tokens.css`, fails if they differ from `THEMES`, checks each theme's contrast pairs, and fails if `index.html` misses a name.

Two guard tests:

- `test/contrast.test.ts` checks WCAG contrast ratios for every theme block in `tokens.css`, and that `tokens.css`, `THEMES` and `index.html` list the same themes.
- `test/no-raw-colours.test.ts` fails if any file in `src/` (other than `tokens.css`) contains a hex, `rgb()`/`hsl()` or Tailwind palette colour. Its allowlist is empty and must stay so.

## Known limits

- The UI stutters during benchmarks: the EVM runs on the main thread.
- In-flight sequencer transactions are lost on reload.
- Benchmark chains are in memory only and are not persisted. Playground chains are persisted (IndexedDB), and the whole chain is re-saved on every change, which is fine at playground scale.
- The dev server must exclude `revm-wasm` from Vite `optimizeDeps` (already set in `vite.config.ts`). Pre-bundling breaks the URL the package uses to locate its `.wasm` file.
- soljson is 10.3 MiB; it loads lazily on the first Compile.
- If storage is blocked the app runs in memory and shows a notice.
