# @evmb/web: browser EVM playground

A static, in-browser playground: create accounts and chains, write and deploy Solidity, send transactions, browse blocks, and run the benchmark scenarios. Everything runs client-side (revm-wasm, solc in a worker); there is no server and the built site works from any static host and path.

    make dev     # Vite dev server, http://localhost:5173
    make build   # static site -> packages/web/dist

**Keys:** Playground keys only. They are stored unencrypted in this browser's localStorage. Never use a real key.

Address inputs suggest your accounts and the contracts deployed on the selected chain; free text still works.

## Known limits

- The UI stutters during benchmarks: the EVM runs on the main thread.
- In-flight sequencer transactions are lost on reload.
- Benchmark chains are in memory only and are not persisted. Playground chains are persisted (IndexedDB), and the whole chain is re-saved on every change, which is fine at playground scale.
- The dev server must exclude `revm-wasm` from Vite `optimizeDeps` (already set in `vite.config.ts`). Pre-bundling breaks the URL the package uses to locate its `.wasm` file.
- soljson is 10.3 MiB; it loads lazily on the first Compile.
- If storage is blocked the app runs in memory and shows a notice.
