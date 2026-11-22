# evm-benchmarks

**▶ [Try the playground](https://aaronp.github.io/evm.fun/)**: zero-install, runs entirely in your browser.

Benchmark harness for EVM settlement architectures (Bun + TypeScript).

    bun install
    bun test
    bun run bench
    bun run report

Browser playground (accounts, chains, Solidity studio, explorer, in-browser benchmark): `make dev` / `make build`, see [packages/web/README.md](packages/web/README.md).

Asset registry (token identity and metadata, live reads): [packages/assets/README.md](packages/assets/README.md).

Same-chain token swap helpers (escrowed offers, book, reports; ADR-0016): [packages/swap/README.md](packages/swap/README.md).

Cross-chain hash-locked swap helpers (HashLock.sol, swap state, reports; ADR-0021): [packages/htlc/README.md](packages/htlc/README.md).
