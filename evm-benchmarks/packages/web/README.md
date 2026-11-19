# @evmb/web: browser EVM playground

A static, in-browser playground: create accounts and chains, write and deploy Solidity, send transactions, browse blocks, and run the benchmark scenarios. Everything runs client-side (revm-wasm, solc in a worker); there is no server and the built site works from any static host and path.

    make dev     # Vite dev server, http://localhost:5173
    make build   # static site -> packages/web/dist

**Keys:** Playground keys only. They are stored unencrypted in this browser's localStorage. Never use a real key.

Address inputs suggest your accounts and the contracts deployed on the selected chain; free text still works.

## Chain types

- **plain** (approach `01-webevm-baseline`): a stock webevm node. Each transaction is checked (signature recovered), executed and mined into its own block as it arrives, one tx per block. Simple and immediately consistent, but throughput is limited because every tx pays for signature recovery plus a block on a single thread.
- **sequencer** (approach `02-seq-memory`): signatures are verified in parallel in background Web Workers. A single-writer sequencer puts the transactions in a fixed order (an in-memory log feeding a ring buffer), and one executor runs them in batches, mining many transactions per block. Execution trusts the sender recovered by the workers, so signatures are not re-checked.

Measured with the CLI (n=10000, median of 3 runs, `REPORT.md`): ERC-20 transfers (erc20-disjoint) about 3.2k TPS on sequencer vs about 1.3k TPS on plain; eth-transfer about 315 vs 273. Trade-offs of the sequencer: each tx waits for its batch, so per-tx latency is higher under load; the ordering log is in memory, so transactions not yet mined are lost on reload.

Both are real EVMs running unmodified Solidity bytecode; in this playground both run on the revm engine. The full comparison, and other architectures to come, are in `evm-benchmarks/REPORT.md`.

## Known limits

- The UI stutters during benchmarks: the EVM runs on the main thread.
- In-flight sequencer transactions are lost on reload.
- Benchmark chains are in memory only and are not persisted. Playground chains are persisted (IndexedDB), and the whole chain is re-saved on every change, which is fine at playground scale.
- The dev server must exclude `revm-wasm` from Vite `optimizeDeps` (already set in `vite.config.ts`). Pre-bundling breaks the URL the package uses to locate its `.wasm` file.
- soljson is 10.3 MiB; it loads lazily on the first Compile.
- If storage is blocked the app runs in memory and shows a notice.
