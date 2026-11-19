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

## Themes

Three themes: **dark**, **light** and **paper** (warm off-white). Colours are CSS custom properties (`--c-*`) defined once per theme in `src/theme/tokens.css` and mapped to Tailwind colours in `src/index.css`; components use only those tokens.

The header switcher calls `setTheme()` (`src/theme/theme.ts`), which sets `data-theme` on `<html>` (instant, no reload) and saves the choice in `localStorage` under `evmb.theme`. With nothing stored, the OS `prefers-color-scheme` picks dark or light. A small inline script in `index.html` applies the theme before first paint (keep it in sync with `initialTheme()`). If storage is blocked the choice lasts for the session only.

**Add a theme:** add one `:root[data-theme="name"] { ... }` block to `tokens.css` defining every `--c-*` token, add `'name'` to `THEMES` in `theme.ts`, then run `bun test` (the contrast test checks each theme's text/background pairs).

Two guard tests:

- `test/contrast.test.ts` checks WCAG contrast ratios for every theme block in `tokens.css`.
- `test/no-raw-colours.test.ts` fails if any file in `src/` (other than `tokens.css`) contains a hex, `rgb()`/`hsl()` or Tailwind palette colour. Its allowlist is empty and must stay so.

## Known limits

- The UI stutters during benchmarks: the EVM runs on the main thread.
- In-flight sequencer transactions are lost on reload.
- Benchmark chains are in memory only and are not persisted. Playground chains are persisted (IndexedDB), and the whole chain is re-saved on every change, which is fine at playground scale.
- The dev server must exclude `revm-wasm` from Vite `optimizeDeps` (already set in `vite.config.ts`). Pre-bundling breaks the URL the package uses to locate its `.wasm` file.
- soljson is 10.3 MiB; it loads lazily on the first Compile.
- If storage is blocked the app runs in memory and shows a notice.
