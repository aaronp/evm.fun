---
register: evm-benchmarks risks
as_at: 2026-11-19
---

## R01 · webevm lacks a feature we rely on
- impact: 4
- likelihood: 1
- target: 2x2
- appetite: 6
- category: Technology
- driver: Claude
- approver: Aaron
- related: O01

webevm is young (v0.9.x, single maintainer). Trusted sender mode, manual mining or the revm engine may be missing, buggy or slow, or change between releases.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Spike t-01 confirms features before building on them | Detective | Strong |
| Pin the webevm version | Preventive | Strong |
| Fall back to @ethereumjs/vm / revm-wasm directly (both already webevm deps) | Corrective | Partial |

## R02 · A single serial executor can't reach 1k TPS
- impact: 3
- likelihood: 4
- target: 3x2
- appetite: 9
- category: Performance
- driver: Claude
- approver: Aaron

The single-threaded EVM loop may top out below 1k TPS for contract calls (especially atomic-swap).

Measured by approach 02 (2026-11-19, n=10000, webevm@0.9.1 default engine, M4 Pro): erc20 3.2-4.2k TPS, atomic-swap 1.35k TPS, eth-transfer 315 TPS. eth-transfer misses 1k with ~31 s per run in webevm `mine()` for 10,000 fresh recipients, consistent with a per-new-account cost in `mine()` (block 500 vs 2000 gave the same TPS), so the limit looks like the engine, not the single executor. Likelihood raised to 4: already realized for one scenario; revm (05) is the next control to measure.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| revm engine approach (05) | Corrective | Partial |
| Parallel-execution approaches (later) | Corrective | Partial |
| Report shortfall as a finding, since 1k is a target line not a gate | Corrective | Strong |

## R03 · State root hashing dominates per-block cost
- impact: 3
- likelihood: 4
- target: 3x2
- appetite: 9
- category: Performance
- driver: Claude
- approver: Aaron

Merkle trie hashing in @ethereumjs can cost more than the EVM work for simple transfers.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Separate approaches with and without state root (02 vs 03) | Detective | Strong |
| Deferred root every K blocks | Corrective | Partial |

## R04 · Benchmark numbers mislead
- impact: 5
- likelihood: 2
- target: 5x1
- appetite: 5
- category: Quality
- driver: Claude
- approver: Aaron

A high TPS number that skipped work (unverified state, hidden trade-offs, signing excluded silently) would invalidate the report.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Every run verifies final state, and failed runs report no TPS | Preventive | Strong |
| Trade-offs declared per approach and shown next to each number | Preventive | Strong |
| Signing time reported separately | Preventive | Strong |

## R05 · Results not repeatable
- impact: 3
- likelihood: 3
- target: 3x1
- appetite: 6
- category: Quality
- driver: Claude
- approver: Aaron

JIT warm-up, GC pauses and machine load make one-off runs noisy.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Warm-up run plus multiple timed runs, report median | Preventive | Partial |
| Record machine info, runtime and engine versions in each result | Detective | Strong |

## R06 · Browser playground is slow or heavy
- impact: 2
- likelihood: 4
- target: 2x2
- appetite: 8
- category: Technology
- driver: Claude
- approver: Aaron

solc-js is several MB, revm-wasm adds about 1.2 MB, and signing 10k transactions in the browser takes noticeable time. Web Worker messaging adds overhead.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Lazy-load solc-js and revm in workers | Preventive | Partial |
| Show signing as a separate untimed phase with progress, smaller default N in browser | Preventive | Partial |

## R07 · Benchmark contracts aren't representative
- impact: 2
- likelihood: 2
- target: 2x1
- appetite: 6
- category: Quality
- driver: Claude
- approver: Aaron

The OpenZeppelin MintableToken may be cheaper or costlier than real tokens (e.g. ERC-3643 with compliance hooks).

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Document contract choice, and the scenario set can grow (e.g. ERC-3643 from chain-as-a-service) | Corrective | Partial |

## O01 · Real-chain comparison for free
- value: 4
- effort: 1
- realisation: 2026-12-15

The JSON-RPC approach (06) benchmarks anvil or Besu on the same signed transactions with no harness changes.

## O02 · Measure the cost of the EVM itself
- value: 3
- effort: 2
- realisation: 2027-01-31

A native (non-EVM) ERC-20 approach, labelled `evm: false`, shows how much throughput EVM compatibility costs.

## R08 · solc bundle size and load time
- impact: 2
- likelihood: 4
- target: 2x2
- appetite: 6
- category: Technology
- driver: Claude
- approver: Aaron

soljson is several MB and takes seconds to initialise, which slows first compile in the Studio.

Measured (plan 3, task 5): soljson.js 0.8.38 is 10,811,469 bytes (10.3 MiB) uncompressed, fetched only on the first Compile and evaluated inside the compiler worker. Observed in the browser smoke check: compiling works, and because the load is lazy and off the main thread the rest of the UI stays usable while it initialises.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Load solc lazily in a worker, only when the Studio compiles | Preventive | Strong |
| Show a loading state while the compiler initialises | Detective | Partial |

## R09 · revm-wasm and workers through Bun's HTML bundler
- impact: 3
- likelihood: 3
- target: 2x2
- appetite: 6
- category: Technology
- driver: Claude
- approver: Aaron

Bun's HTML bundler may not emit the wasm file or module workers with relative URLs, which breaks revm or the solc worker on a static host.

Observed (plan 3): Bun's HTML bundler did fail for this, so the playground is built with Vite. The Vite dev server's dependency pre-bundling then broke the revm-wasm URL (the wasm was resolved relative to the pre-bundled chunk); fixed with `optimizeDeps.exclude: ['revm-wasm']`. The built site, served from a sub-path, was smoke-checked by hand and works.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Browser smoke test of the built site (plan 3, task 9) | Detective | Strong |
| Copy wasm and soljson as static assets with relative URLs | Corrective | Strong |

## R10 · data loss in webevm IndexedDB persistence
- impact: 3
- likelihood: 3
- target: 2x2
- appetite: 6
- category: Technology
- driver: Claude
- approver: Aaron

webevm saves the whole chain as one IndexedDB record on every state-changing request. Large chains make each save slow, and a failed or blocked write can lose history; clearing site data loses everything.

Observed (plan 3): persistence re-serialises the whole chain on every change. That is fine at playground scale (a handful of accounts, contracts and transactions in the smoke check). Benchmark chains are in memory only and are never persisted.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Wrap storage access and fall back to memory with a visible notice | Corrective | Strong |
| Keep playground chains small; benchmark chains run without persistence | Preventive | Partial |

## R11 · Bun worker-teardown segfault in the test suite
- impact: 2
- likelihood: 2
- target: 2x1
- appetite: 4
- category: Quality
- driver: Claude
- approver: Aaron

`bun test` (Bun 1.3.13) panicked once in 4 runs during the plan-3 final review (82 workers spawned, 74 terminated at the time of the crash). Plan 3 raised worker churn: the suite now creates 129 workers (base 3c6dd51: 18), because the web tests build sequencer chains that each start `hardwareConcurrency - 1` verify workers. Re-runs on 2026-11-19 did not reproduce it: HEAD 0 crashes in 40 runs, base 0 in 35. An instrumented run showed all 129 workers terminated, so no test leaks a chain; the crash looks like a Bun bug when workers are terminated (not awaited) while others start.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Every test disposes its chains (instrumented run: 129/129 workers terminated) | Preventive | Partial |
| Re-run on a crash; a panic with all tests passed is not a test failure | Corrective | Partial |
| Upgrade Bun when a release fixes worker teardown | Corrective | Partial |
