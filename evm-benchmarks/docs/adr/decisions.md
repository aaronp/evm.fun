---
title: Keep project docs as markdown next to the code
status: accepted
date: 2026-11-19
tags: process
decision: md
---

## Goal
Keep tasks, risks and decisions current without a separate tool.

## People
- Aaron — decider

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| upkeep | Easy to keep current | 5 | Higher = less effort. |
| review | Reviewed with the code | 4 | Higher = shows up in pull requests. |

## Solution: md — Markdown in the repo
| criterion | score |
| --- | --- |
| upkeep | 4 |
| review | 5 |

## Solution: wiki — Team wiki
| criterion | score |
| --- | --- |
| upkeep | 3 |
| review | 1 |

## Decision
Markdown in the repo (docs/board, docs/risks, docs/adr): it changes in the same commit as the code it describes.

---
title: Build our own sequencer + EVM rather than tuning Besu
status: accepted
date: 2026-11-19
tags: architecture
decision: own
---

## Goal
Find an architecture that settles Solidity-compatible transactions (tuned for ERC-20s) at 1,000+ TPS, and can also be shipped as a zero-install browser playground.

## Hypothesis
A single-writer sequencer with signatures checked in parallel ahead of it, feeding one hot execution loop that runs blocks in batches, can reach 1k TPS on one machine. A tuned general-purpose node is bounded by its mempool, consensus and per-block overhead.

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| headroom | Throughput headroom | 5 | Higher = more room to reach and exceed 1k TPS. |
| browser | Runs in the browser | 4 | Higher = the same architecture can be the zero-install playground. |
| control | Control over the pipeline | 4 | Higher = we can change sequencing, verification and execution freely. |
| realism | Real-chain realism | 2 | Higher = numbers transfer to a production node. |
| effort | Effort to first number | 3 | Higher = less work. |

## Solution: own — Own sequencer + EVM (webevm/revm), TS/Bun
| criterion | score |
| --- | --- |
| headroom | 5 |
| browser | 5 |
| control | 5 |
| realism | 2 |
| effort | 3 |

## Solution: both — Generic harness + tuned Besu and own sequencer
| criterion | score |
| --- | --- |
| headroom | 4 |
| browser | 4 |
| control | 4 |
| realism | 5 |
| effort | 1 |

## Solution: besu — Single tuned Besu node only
| criterion | score |
| --- | --- |
| headroom | 2 |
| browser | 1 |
| control | 2 |
| realism | 5 |
| effort | 4 |

## Decision
Own sequencer + EVM. Besu doesn't need to be the node, but it must stay benchmarkable: the harness only takes signed transactions, and a JSON-RPC approach (06) can point at Besu or anvil later. See the design: evm-benchmarks/docs/superpowers/specs/2026-11-19-evm-benchmarks-design.md.

---
title: Benchmark input is N pre-signed raw transactions
status: accepted
date: 2026-11-19
tags: architecture, benchmark
decision: rawtx
---

## Goal
Compare any implementation (ours, webevm, anvil, Besu) on identical input.

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| neutral | Engine neutral | 5 | Higher = no implementation is favoured by the input format. |
| fair | Fair comparison | 4 | Higher = every implementation does the same work. |
| simple | Simple adapter | 3 | Higher = less code per implementation. |

## Solution: rawtx — Signed RLP raw transactions (eth_sendRawTransaction shape)
| criterion | score |
| --- | --- |
| neutral | 5 |
| fair | 5 |
| simple | 4 |

## Solution: calls — Engine-specific calls (e.g. direct EVM runCall)
| criterion | score |
| --- | --- |
| neutral | 1 |
| fair | 2 |
| simple | 5 |

## Decision
N signed raw transactions, generated and signed before the clock starts. Approaches implement setup / submit / awaitSettled / call / dispose and nothing else.

---
title: TypeScript on Bun for harness, approaches and playground
status: accepted
date: 2026-11-19
tags: tooling
decision: ts
---

## Goal
One language for the CLI benchmark, the approaches and the browser playground.

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| browser | Same code runs in the browser | 5 | Higher = less duplication with the playground. |
| reuse | Reuses starter projects | 3 | Higher = more of chain-as-a-service / nanochain reusable. |
| raw | Raw single-thread speed | 3 | Higher = faster hot loop. |

## Solution: ts — TypeScript / Bun
| criterion | score |
| --- | --- |
| browser | 5 |
| reuse | 5 |
| raw | 3 |

## Solution: jvm — JVM (disruptor, Besu-adjacent)
| criterion | score |
| --- | --- |
| browser | 1 |
| reuse | 1 |
| raw | 4 |

## Solution: rust — Rust (revm native, wasm for browser)
| criterion | score |
| --- | --- |
| browser | 3 |
| reuse | 1 |
| raw | 5 |

## Decision
TypeScript on Bun. revm is still reachable as wasm through webevm/revm.

---
title: Treat architectural trade-offs as separate, comparable approaches
status: accepted
date: 2026-11-19
tags: architecture, process
decision: approaches
---

## Goal
State roots, durability, signature checking, parallel execution and the success bar each trade throughput and latency for something. Show those costs rather than picking one up front.

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| insight | Shows the cost of each choice | 5 | Higher = the report explains what each sacrifice buys. |
| effort | Effort | 2 | Higher = less work. |

## Solution: approaches — One package per approach, with declared trade-offs
| criterion | score |
| --- | --- |
| insight | 5 |
| effort | 3 |

## Solution: upfront — Decide each question once, build one architecture
| criterion | score |
| --- | --- |
| insight | 1 |
| effort | 5 |

## Decision
evm-benchmarks/approaches/NN-name packages, each with a README and a `tradeoffs` declaration (evm, stateRoot, log, sigVerify, execution) that the report shows as columns. 1k TPS is a target line, not a gate.

---
title: Settlement means executed in a block with a receipt
status: proposed
date: 2026-11-19
tags: benchmark
decision: receipt
---

## Goal
One definition of "settled" used for TPS and latency across all approaches.

## People
- Claude — author
- Aaron — decider

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| comparable | Comparable across approaches | 5 | Higher = every approach can report it. |
| meaningful | Meaningful as settlement | 4 | Higher = closer to irrevocable. |

## Solution: receipt — Executed, receipt available
| criterion | score |
| --- | --- |
| comparable | 5 |
| meaningful | 3 |

## Solution: durable — Executed and durably logged
| criterion | score |
| --- | --- |
| comparable | 2 |
| meaningful | 4 |

## Decision
Receipt available. Durability is shown as a trade-off column (`log`) instead (approach 04). Signing is excluded from timing. Runs that fail final-state verification report no TPS.

---
title: Which EVM engine backs the sequencer
status: proposed
date: 2026-11-19
tags: architecture, engine
---

## Goal
Fastest EVM that stays Solidity-compatible and runs in the browser.

## People
- Claude — author
- Aaron — decider

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| speed | Execution speed | 5 | Higher = more TPS. |
| bundle | Browser bundle size | 2 | Higher = smaller. |
| fit | Supports trusted sender + manual mining | 4 | Higher = less glue code. |

## Solution: webevm — webevm default engine (@ethereumjs/evm)

## Solution: revm — webevm/revm (revm-wasm)

## Solution: ejs — @ethereumjs/vm directly

## Decision
Open. Settled by spike t-01 and approaches 02 vs 05.

## Notes
Spike t-01 (`evm-benchmarks/spike/webevm.test.ts`, webevm 0.9.1, Bun 1.3.13), all confirmed:
- `senderMode: 'trusted'` works: `evm_sendRawTransactionSyncAs [raw, from]` returns a receipt with status 0x1.
- `miningConfig: {type: 'manual'}` queues transactions (receipt null) until `node.mine()`. 3 queued transfers landed in one block.
- `blockGasLimit: 300_000_000n` mined 1000 transfers in a single block, all status 0x1.
- revm loads in Bun. The option is `engine: await createRevmEngine({wasm})` (an object on `createNode`), not `createEngine` (that is only for `webevm/worker-host` `exposeNode`). `wasm` = bytes of `require.resolve('revm-wasm/revm.wasm')`; `node.engine.id` is `revm-wasm`.
- Throughput, 2000 single-sender transfers, default engine: recover+auto about 1700 tx/s; trusted+manual(500) about 16900 tx/s (about 10x).

Plan 1 results (n=10000, webevm@0.9.1 default engine, approaches 01 and 02): median 273-4,238 TPS. `mine()` dominates 02, and eth-transfer is about 315 TPS with about 31 s per run spent in `mine()` for 10,000 fresh recipients; block size 500 vs 2000 gave the same TPS, consistent with a per-new-account cost. This points at the engine, not the pipeline, but only revm (approach 05, plan 2) can confirm it. Stays proposed.

---
title: State root per block, deferred, or none
status: proposed
date: 2026-11-19
tags: architecture, engine
---

## Goal
Know what a verifiable state root costs in throughput.

## People
- Claude — author
- Aaron — decider

## Solution: none — No state root (approach 02)

## Solution: per-block — Merkle state root every block (approach 03)

## Solution: deferred — State root every K blocks (approach 03, option)

## Decision
Open. Measured by approaches 02 vs 03.

Notes: Plan 1 only has the `none` side (01 and 02, both stateRoot none; 273-4,238 TPS). The per-block and deferred costs come from approach 03 in plan 2. Stays proposed.

---
title: Chain persistence in the playground
status: accepted
date: 2026-11-19
tags: architecture, web
decision: native
---

## Goal
Playground chains keep blocks, receipts and balances across page reloads.

## People
- Claude — author
- Aaron — decider

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| history | Explorer history survives reload | 5 | Higher = blocks and receipts come back. |
| effort | Little glue code | 4 | Higher = less code to write and maintain. |

## Solution: native — webevm persistence adapter (createIndexedDBPersistence)
| criterion | score |
| --- | --- |
| history | 5 |
| effort | 5 |

## Solution: own — dumpState/loadState plus our own block and receipt store
| criterion | score |
| --- | --- |
| history | 5 |
| effort | 2 |

## Decision
Use webevm's own `persistence` option (IndexedDB adapter in the browser). Spike `evm-benchmarks/spike/playground.test.ts` (webevm 0.9.1, Bun 1.3.13), 3/3 pass with an in-memory adapter:
- `PersistenceAdapter` is `{load(): Promise<SerializedState | null>; save(state): Promise<void>}`: one record for the whole chain. `createNode` calls `load()` at creation and applies it only if `saved.chainId` matches; `save()` is awaited inside each state-changing request.
- After 3 mined transfers and `dispose()`, a second node on the same adapter reports `eth_blockNumber` 0x3, `eth_getBlockByNumber(2, true)` lists the tx, the receipt has status 0x1 and balances match. Blocks and receipts survive, so the fallback is not needed.
- `initialBalances` do not override restored state: the restored balance wins on reopen.
- revm via `createNode({engine: await createRevmEngine({wasm})})` runs a transfer; `node.engine.id` is `revm-wasm`.
- Consequence: the whole state is re-serialised on every save, so cost grows with chain size (risk R10). `save()` must not call back into the node. Playground chain ids must stay 31337 for a persisted chain to load.

---
title: Web bundler
status: accepted
date: 2026-11-19
tags: architecture, web
decision: vite
---

## Goal
Bundle the browser playground so module Workers, the revm `.wasm` and static solc/OpenZeppelin files work from any static path.

## People
- Claude — author
- Aaron — decider

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| assets | Worker and wasm emitted correctly | 5 | Higher = `new Worker(new URL(..))` and `.wasm` work without hand wiring. |
| effort | Little glue code | 3 | Higher = fewer moving parts. |

## Solution: bun — Bun HTML bundler (Bun.build on index.html)
| criterion | score |
| --- | --- |
| assets | 1 |
| effort | 4 |

## Solution: vite — Vite
| criterion | score |
| --- | --- |
| assets | 5 |
| effort | 4 |

## Decision
Use Vite. Bun 1.3.13 was tried first with a throwaway worker and revm-wasm: the worker chunk was not emitted (the bundle kept `new URL("./probe.worker.ts", import.meta.url)`, a `.ts` file that is not in dist) and `revm-wasm/wasm-url` stayed `new URL("../wasm/revm.wasm", import.meta.url)` with no such file emitted. Vite 7 emitted `assets/probe.worker-*.js`, rewrote the URL to it relative to `import.meta.url`, and emitted `assets/revm-*.wasm` for both import forms. `base: './'` gives relative URLs. soljson and the OpenZeppelin `.sol` tree are copied by `packages/web/build.ts` into `public/` (so dev and dist both serve them). Tailwind 4 via `@tailwindcss/vite`.

---
title: Playground theming via CSS-variable tokens
status: accepted
date: 2026-11-19
tags: architecture, web
decision: tokens
---

## Goal
Give the playground three themes (Dark, Light, Paper) without hard-coding colours in components.

## People
- Claude — author
- Aaron — decider

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| onesys | One styling system | 5 | Higher = one place to change a colour. |
| deps | No new dependency | 4 | Higher = nothing new to install or maintain. |
| fidelity | Matches the designer's palette | 3 | Higher = closer to the mockups. |

## Solution: tokens — Semantic CSS variables per theme, mapped into Tailwind 4 (`@theme inline`)
| criterion | score |
| --- | --- |
| onesys | 5 |
| deps | 5 |
| fidelity | 4 |

## Solution: sheet — Port the mockups' inline styles to a separate stylesheet
| criterion | score |
| --- | --- |
| onesys | 1 |
| deps | 5 |
| fidelity | 5 |

## Solution: lib — Themed component library (daisyUI, shadcn/Radix)
| criterion | score |
| --- | --- |
| onesys | 4 |
| deps | 1 |
| fidelity | 2 |

## Decision
Tokens. Colours live only in `packages/web/src/theme/tokens.css`, one `:root[data-theme=…]` block per theme; Tailwind utilities (`bg-surface`, `text-muted`, …) read them through `@theme inline`. A pre-paint script in `index.html` sets `data-theme` from `localStorage['evmb.theme']` or `prefers-color-scheme`. Two tests guard it: WCAG contrast for every token pair in every theme, and a grep that fails on raw colours outside the tokens file.

---
title: Explorer views on a linear chain; fork views deferred to real fork data
status: accepted
date: 2026-11-19
tags: architecture, web
decision: linear
---

## Goal
Add richer block-explorer views to the Chains page without showing data the chains do not have.

## People
- Claude — author
- Aaron — decider

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| honest | Shows only real data | 5 | Higher = nothing invented. |
| value | Useful today | 3 | Higher = more insight into current chains. |
| effort | Low effort | 2 | Higher = less to build and maintain. |

## Solution: linear — Build only the four views that work on a linear chain (Table, Chain, Timeline, Fisheye)
| criterion | score |
| --- | --- |
| honest | 5 |
| value | 4 |
| effort | 3 |

## Solution: all — Build all six mockup views, with invented fork data
| criterion | score |
| --- | --- |
| honest | 1 |
| value | 3 |
| effort | 1 |

## Solution: none — Skip the new views
| criterion | score |
| --- | --- |
| honest | 5 |
| value | 1 |
| effort | 5 |

## Decision
Linear. Playground and benchmark chains are linear: one block per height, no forks, no finality. The two fork views in the mockups need fork data these chains do not produce, and would have needed invented fork rules and placeholder values. Fork views come back with snapshots, export/import and restore (explorer spec steps 2-3), when real fork data exists.

---
title: Cap on running chains in one tab (warn 4, refuse 8, no auto-close)
status: accepted
date: 2026-11-19
tags: architecture, web
decision: warn-refuse
---

## Goal
Keep the playground responsive when many chains are open at once: each running chain holds an engine (and, for sequencer chains, verify workers).

## People
- Claude — author
- Aaron — decider

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| safe | Tab stays responsive | 4 | Higher = memory and CPU stay bounded. |
| control | User keeps control | 4 | Higher = nothing is closed or lost behind the user's back. |
| effort | Low effort | 2 | Higher = less to build and maintain. |

## Solution: none — No cap
| criterion | score |
| --- | --- |
| safe | 1 |
| control | 5 |
| effort | 5 |

## Solution: lru — Auto-close the least recently used chain
| criterion | score |
| --- | --- |
| safe | 5 |
| control | 1 |
| effort | 2 |

## Solution: warn-refuse — Warn at 4 running chains, refuse to open more at 8, never auto-close
| criterion | score |
| --- | --- |
| safe | 4 |
| control | 5 |
| effort | 4 |

## Decision
Warn and refuse. A notice appears at 4 running chains (`LIVE_WARN`); opening or adding a ninth is refused with an error that tells the user to delete one or reload (`LIVE_MAX` = 8). Nothing is closed automatically, so a chain the user is looking at never disappears. The chain list only peeks at running chains and never opens one.

---
title: Chain snapshots via webevm dumpState/loadState
status: accepted
date: 2026-11-19
tags: architecture, web
decision: dump-load
---

## Goal
Build chain snapshots, in-place restore and file import/export on webevm's `dumpState`/`loadState`, if they are faithful enough.

## People
- Aaron — decider

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| exact | Exact state | 5 | Higher = blocks, hashes and receipts come back identical. |
| effort | Low effort | 3 | Higher = less to build and maintain. |
| local | Works for every chain | 3 | Higher = also works for ephemeral (benchmark) chains. |

## Solution: dump-load — Use webevm dumpState / loadState
| criterion | score |
| --- | --- |
| exact | 5 |
| effort | 5 |
| local | 5 |

## Solution: replay — Replay recorded transactions
| criterion | score |
| --- | --- |
| exact | 3 |
| effort | 2 |
| local | 2 |

## Solution: idb-copy — Copy the IndexedDB database
| criterion | score |
| --- | --- |
| exact | 5 |
| effort | 3 |
| local | 1 |

## Decision
Use `dumpState`/`loadState`. Spike: `evm-benchmarks/spike/snapshots.test.ts`, 18 tests, all passing, on webevm 0.9.1 with {auto, manual mining} × {default engine, revm}; ~5 transfers per case. Verdicts:

- **Hash stability: YES.** After `dumpState` then `loadState` into a fresh node, every block's `hash`, `parentHash`, `timestamp` and tx hashes, every receipt, `eth_blockNumber`, balances and the sender nonce are identical (`toEqual`). This held even when the fresh node was created more than a second later, because a loaded dump brings its own block 0. So a fork opened from a snapshot shares real block hashes with the original up to the snapshot height, and explorer step 3 can match shared history by hash (block hash, not tx content — see Consequences).
- **JSON round trip: YES.** The dump survives `JSON.stringify` with a `$bigint` replacer and `JSON.parse` with the matching reviver, deep-equal to the original, and still loads. In 0.9.1 the dump contains no bigint at all (only strings, numbers, arrays, objects; keys `version, chainId, accounts, code, storage, blocks, receipts, transactions`), so the `$bigint` encoding is a safeguard for the file format, not something this version needs. The chain file's own fields (e.g. balances above 2^53 held in our records) still use it.
- **Cross-engine loading: YES, both ways.** A dump from the default engine loads into revm and the reverse; blocks, hashes, receipts and balances are identical and the node keeps executing new txs on the new engine. Import therefore accepts any `engine` value; the file still records it for information. No engine-mismatch rejection is needed, and no `test.todo` was left.
- **Restore into a running node: NO, it merges; restore reloads into a fresh node instead.** Dump after 3 txs (height 3 in auto mining, height 1 in manual mining), mine 2 more, `loadState(dump)` on the same node: `eth_blockNumber` is back to the dump height, the later blocks and their receipts are null, the observed state (blocks, receipts, the two spike accounts' balances and the sender nonce) equals the height-3 state, and the node accepts new txs afterwards. But `loadState` only puts the dump's accounts, code and storage and never clears newer ones: an address funded and a contract deployed after the dump keep their balance and code (spike test "loadState merges into a running node", found in the final review). So an approach's `restore()` disposes the node and loads the dump into a fresh one, the same path as `setup({dump})`. Approach tests check that after a restore an address funded after the snapshot has balance 0 and a contract deployed after it has no code (`eth_getCode` is `0x`) and no storage.
- **2,000-block chain (1 transfer per block, auto mining): size about 5,665 KB (5.5 MB, about 2.8 KB per block), identical on both engines.** Times (ms): dump 1-3, JSON encode 10-36, decode 15-21, `loadState` into a fresh node 81-85; building the chain took about 450. The JSON round trip is deep-equal to the original dump; after `loadState` only the height is checked. The 20 MB warning corresponds to roughly 7,000 such blocks. Heavier blocks (contract deploys, logs) will be larger; not measured here.

Limits of the spike: apart from the merge regression (one transfer and one tiny contract deploy), only ETH transfers were exercised (no logs, and contract storage only in that regression), and the sequencer's in-flight queue is outside webevm and so not covered; restore on a sequencer chain is refused while txs are pending (see the design spec).

## Consequences
- **Block hashes do not cover tx content** (found in Task 4): webevm's `transactionsRoot` is a zero placeholder, so two forks can share a block hash at a height while holding different txs. Explorer step 3 must detect divergence by per-block tx hashes plus height, not by block hash alone. Shared history still lines up by hash.
- Restore loads into a fresh node, so webevm `loadState` keeping the manual-mining queue no longer matters (risk R14, closed). Restore on a sequencer chain still requires `pending() === 0`, because the sequencer's in-flight txs live outside webevm.

---
title: "Assets: identity + metadata registry, live reads, no cache"
status: accepted
date: 2026-11-19
tags: architecture, web
decision: registry
---

## Goal
Give the playground a first-class notion of an asset (native ETH and ERC-20s) that survives snapshots, forks and file export/import, without it ever disagreeing with the chain.

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| truth | Never stale | 5 | Higher = shown values always match the chain. |
| effort | Low effort | 4 | Higher = less to build and maintain. |
| travel | Travels with chains | 3 | Higher = survives fork, snapshot and export/import. |

## Solution: registry — A: identity + metadata registry, live reads, no cache
| criterion | score |
| --- | --- |
| truth | 5 |
| effort | 4 |
| travel | 4 |

## Solution: indexer — B: indexer that caches balances, supply and allowances
| criterion | score |
| --- | --- |
| truth | 3 |
| effort | 1 |
| travel | 2 |

## Solution: derive — C: no registry, derive tokens from contract records
| criterion | score |
| --- | --- |
| truth | 5 |
| effort | 5 |
| travel | 3 |

## Decision
A. Store only identity and metadata (symbol, name, decimals, origin, issuer, mintable); read supply, balances and allowances from the chain every time. B was rejected as too much machinery for playground scale and because a cache can go stale. C cannot represent imported tokens, origin or issuer. Details:

- **Identity.** `AssetId` is `<chainId>:native` or `<chainId>:<lowercase address>`, where `chainId` is the playground `ChainInfo.id` (a UUID), not the EVM chain id 31337, which every chain shares. Fork and import call `rebase` so the new chain's assets carry the new id in both `id` and `chainId`; the parent's list is unchanged. Native is never stored.
- **Allowance discovery.** Approval logs from block 0 give the (owner, spender) pairs; each pair is re-read with `allowance()`, because OpenZeppelin 5 `transferFrom` emits no `Approval` when it spends, so the last log would show a stale amount. Zero allowances are dropped.
- **Amounts.** A custom `parseAmount` replaces viem `parseUnits`: `parseUnits` rounds extra decimals instead of refusing them and accepts negatives. `parseAmount` refuses extra fractional digits, negatives and non-numbers inline before signing.
- **Imported tokens** also get a contract record, with `txHash` zeroHash and deployer `owner()` or zeroAddress (ruling R1: the real deploy tx is unknown), written only if no record exists for that address, so a real deployment record is never overwritten.
- **Decimals** 0 to 255 are accepted (uint8).

## Consequences
- Every Assets view costs chain reads; allowance discovery scans all logs from block 0 (risk R16).
- Upgrade path to B (an incremental indexer keyed by block) stays open: the registry's stored shape does not change.

---
id: ADR-0016
title: "Swap: one contract per chain, offer book read from contract storage"
status: accepted
date: 2026-11-20
tags: architecture, swap, step-2
decision: storage
---

## Goal
Read the same-chain swap's offer book (roadmap step 2, board t-61) so the Swap page never shows an offer as open when the chain says it isn't, with as little machinery as possible.

## Hypothesis
- We believe: keeping offers in a `Swap.sol` mapping with a public getter and `nextId`, read directly by `@evmb/swap`, is enough for the playground
- Will result in: a book that is always correct, needs no stored state, and travels with snapshots, forks and imports for free
- Measured by: the Swap page loads its book in well under a second with a few hundred offers on a chain; no stale-offer bug reports

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| truth | Never stale | 5 | Higher = the book always matches the chain. |
| effort | Low effort | 4 | Higher = less to build and maintain. |
| travel | Travels with chains | 3 | Higher = no extra state to carry through snapshot, fork and export/import. |
| scale | Scales with history | 2 | Higher = read cost does not grow with every offer ever made. |

## Solution: storage — A: offers in a mapping, read with offers(1..nextId-1)
Events are used only for Activity and execution reports.

| criterion | score |
| --- | --- |
| truth | 5 |
| effort | 5 |
| travel | 5 |
| scale | 2 |

Pros:
- Can't go stale; nothing to cache or invalidate
- No new stored state; snapshots, forks and imports just work
- The contract is the single source of truth, which step 5 (on-chain order book) builds on

Cons:
- Reads every offer ever made, open or not (one call per offer)

## Solution: logs — B: rebuild the book from OfferMade/Taken/Cancelled logs
| criterion | score |
| --- | --- |
| truth | 4 |
| effort | 3 |
| travel | 5 |
| scale | 1 |

Pros:
- No getter needed in the contract

Cons:
- Another from-block-0 log scan (the same cost as R16)
- State must be reconstructed from events; easy to get subtly wrong

## Solution: index — C: index offers in the app's key-value store
| criterion | score |
| --- | --- |
| truth | 2 |
| effort | 2 |
| travel | 1 |
| scale | 5 |

Pros:
- Fastest reads; cost independent of history

Cons:
- Goes stale on restore, fork and import unless every path rebuilds it
- New state to validate in imported files

## Decision
A. Also decided with Aaron: one `Swap` per chain, deployed explicitly (Studio's "Deploy Swap.sol", or the Swap page's "Deploy Swap.sol?" button) and found from contract records (name `Swap`, matching ABI, newest wins). Reports take the Swap address from the transaction's `to`.

Calls made after the builder check (spec `docs/superpowers/specs/2026-11-20-swap-design.md`):
- **Revert reasons.** "Already taken/cancelled" is worked out from logs ordered by block and tx index, so a same-block race names the winner. Other failures are replayed with `eth_call` at the parent block; an approve or transfer earlier in the same block is not seen (backlog t-68).
- **Activity** finds reverted takes by scanning blocks for txs to the Swap with status 0 (backlog t-69).
- **Price.** Quote amount = amount × price, rounded half-up to the quote token's decimals; the book shows the price from stored amounts (4 dp), compared exactly with BigInt, ties lowest id first.
- **Crossing offers** get the mockup's advisory note only; Swap does not match.
- **ERC-20s only**; native ETH can't be escrowed with `transferFrom` (backlog t-70).
- **No named markets**: a market is any (base, quote) pair of the chain's assets (backlog t-71).
- **Rich data at its point of origin.** `take` stores the `taker` and `closedBlock` in the offer, and `cancel` stores `closedBlock` too, so "who took it, and when it closed" is O(1) via `offers(id)` with no event join. A report's winner (taker and block) and "your offers" ("taken by …") read them from the offer, and the report's status-log query is narrowed to `closedBlock`; an open offer needs no log query. Activity reads `OfferTaken`/`OfferCancelled` logs: it is an event feed by design.
- **History window.** Playground chains keep webevm `stateHistory: {blocks: 256}` (benchmark chains keep none), so a failure report replays at the parent block while it is within 256 blocks; older than that falls back to `latest` and the report says so.
- **A take stays on the page.** The mockup wins over the spec's "navigates to": after a take the page shows a success or danger flash with a "View report →" link.

## Consequences
- Book reads grow with every offer ever made (risk R17); upgrade path is an indexer keyed by block (backlog t-67) without changing the contract.
- Known O(n) spots, each a logged risk with a backlog card: Activity's block scan (R19, t-69), "your offers" filtering all offers (R20, t-72), replay blind spots and the 256-block window (R18, t-68). Fee-on-transfer and rebasing tokens leave escrow short (R22, t-74; ERC-20-only scope).
- A report's status lookup is one block's logs since `cancel` also stores `closedBlock` (R21 closed, t-73).
- Reports and Activity are derived from the chain, so they work after reload, fork and import.

---
id: ADR-0017
title: "Walkthroughs: one file, two runners; pages exchange values with the running walkthrough"
status: accepted
date: 2026-11-20
tags: architecture, web, walkthrough
decision: declare
---

## Goal
Give newcomers a clear, jargon-free path through the playground, and let anyone load, replay and step through the scenarios our tests run, on the real pages, editing values as they go.

## Hypothesis
- We believe: a walkthrough as a JSON file (keys with initial values, plus steps and checks) run by both `bun test` and an in-app wizard ribbon that fills and presses the real pages
- Will result in: walkthroughs that can't drift from the tests, and a guided UI that teaches the actual app
- Measured by: every bundled walkthrough passes headless and completes in the browser by pressing Next only; an edited run records the values actually used

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| robust | Robust to UI change | 5 | Higher = page markup changes don't break walkthroughs. |
| shared | Shared with tests | 5 | Higher = the headless and UI runs share code and outputs. |
| reach | Reaches all page state | 4 | Higher = dialogs and component state can be filled and read back. |
| effort | Low effort | 3 | Higher = less to build and less per page. |

## Solution: declare — 1: pages declare fields, actions and outputs
`useWizardField` (in, and read back), `useWizardAction` (what Next presses), `useWizardReport` (outputs after an action, whoever pressed), `data-wizard` markers for pulse and focus mode.

| criterion | score |
| --- | --- |
| robust | 5 |
| shared | 5 |
| reach | 5 |
| effort | 3 |

Pros:
- Typed and explicit; works for dialogs and internal state
- Pages report the same `Outputs` the headless runner returns, so both runs record identically
- The same markers drive pulse and focus mode

Cons:
- A few lines per page per step type

## Solution: url — 2: URL pre-fill
| criterion | score |
| --- | --- |
| robust | 4 |
| shared | 2 |
| reach | 2 |
| effort | 4 |

Pros:
- Least machinery; deep links to pre-filled screens

Cons:
- Dialog open state must go in the URL; values are strings; no way back for outputs

## Solution: robot — 3: drive the DOM with selectors
| criterion | score |
| --- | --- |
| robust | 1 |
| shared | 1 |
| reach | 3 |
| effort | 4 |

Pros:
- No page changes

Cons:
- Breaks with markup changes; React controlled-input hacks; shares nothing with the headless runner

## Decision
1. Also decided with Aaron: one file, two runners (the test is the walkthrough); the ribbon drives the real pages with a focus mode for newcomers, not separate simplified pages; a walkthrough's named things are **keys** with initial values the user may change, and their **actual values** (addresses, ids, tx hashes) are captured when each step completes.

Claude's calls (spec `docs/superpowers/specs/2026-11-20-walkthroughs-design.md`): the name "walkthrough" ("scenario" is taken by benchmarks); the runner lives in `packages/web/src/walkthrough/` because steps act on the web app's stores; one fresh chain per run; `approve` is its own step; `from` switches the acting account; checks broken by a user edit show amber; Back doesn't undo; only the step types the two bundled walkthroughs use.

## Consequences
- Each page that takes part grows a few wizard lines, and handlers that keep outcomes internal (e.g. the take receipt) report them.
- Pages report errors to the ribbon by throwing from their registered action; the ribbon shows the message.
- Next waits for a chain or account switch to land before pressing the page's action (R23).
- Focus mode dims the sidebar as well as the page chrome.
- Render-time writes in `useWizardField` / `useWizardAction` and the missing DOM harness are logged risks (R24, R25, backlog t-79, t-80).
- Deferred, each a backlog card: `transfer`, `cancel`, snapshot / fork / restore steps (t-77); reusing an existing chain and funding traders on it (t-78).

---
id: ADR-0018
title: "Order book: two venues (on-chain, off-chain with on-chain settlement) behind one Venue API"
status: accepted
date: 2026-11-20
tags: architecture, orderbook, step-5
decision: both
---

## Goal
A Trade screen with limit and market orders and a live book, on a UI-free package with a realistic API over a lower-level persistence API that IndexedDB can back, so the playground can compare order-book designs.

## Hypothesis
- We believe: one `Venue` API with two implementations (orders resting in `OrderBook.sol`; signed orders in a store matched off-chain and settled by `Settlement.sol`) and a venue switch on the Trade screen
- Will result in: two real designs exercised by the same screen, walkthroughs and benchmark
- Measured by: both walkthroughs pass headless and in the ribbon; `book-match-onchain` vs `book-match-offchain` give comparable numbers

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| compare | Compares designs | 5 | Higher = both designs can be run and measured the same way. |
| real | Realistic | 4 | Higher = the API and storage look like a real venue's. |
| effort | Low effort | 3 | Higher = less to build. |
| truth | Never shows unhonourable liquidity | 5 | Higher = the book only shows what a settle would honour. |

## Solution: both — two venues, one API, header switch
| criterion | score |
| --- | --- |
| compare | 5 |
| real | 5 |
| effort | 2 |
| truth | 4 |

Pros:
- Same screen, walkthroughs and benchmark for both designs
- Uses the persistence API for real (off-chain book, attempt journal)

Cons:
- Two contracts and two venue implementations to build

## Solution: onchain — orders rest in OrderBook.sol only (t-64 as written)
| criterion | score |
| --- | --- |
| compare | 1 |
| real | 3 |
| effort | 4 |
| truth | 5 |

Pros:
- Simplest; the contract is the only truth

Cons:
- Every place/cancel costs gas; no use for the persistence API

## Solution: offchain — signed orders and off-chain matching only (t-65)
| criterion | score |
| --- | --- |
| compare | 1 |
| real | 5 |
| effort | 3 |
| truth | 4 |

Pros:
- Free to place; how real venues work

Cons:
- No on-chain baseline to compare against

## Decision
Both. Decided with Aaron: a realistic API over a lower-level persistence API; a venue switch in the header (not side by side); a walkthrough per venue; t-64 moved ahead of t-62 and t-63, including t-65's single-chain work.

Claude's calls (spec `docs/superpowers/specs/2026-11-20-orderbook-design.md`, "Settled after the builder check"): failed attempts journalled by the sender in the Store for both venues (no block scan); the benchmark uses the package's lower layers and times only transactions; off-chain liquidity capped per maker, summed, oldest first; market orders carry a worst price with a 1% default slippage bound; no settlement choices and no fees in this step.

## Consequences
- The off-chain book's fill/cancel truth is on-chain; the store holds signed orders and attempts only.
- Off-chain liquidity reads each maker's balance and allowance live (O(makers) per book read; risk to log).
- The comparison deliberately excludes off-chain matching time; reports must say so.
- Store keys use `scope` (the app's chain id), not the EVM chain id: every playground chain is 31337 and a fresh chain deploys at the same addresses, so chain-id keys collided. A fork starts with an empty book and journal.
- `Venue.committed(owner, asset)` was added: the off-chain form's allowance need must include the maker's other open orders, or Approve more unfunds older ones (on-chain it is 0, the escrow holds it).
- A limit order whose matching is cut short by `maxLevels` would rest crossing the book, so the contract reverts instead (tested for the buy side); the package pre-checks and tells the user before sending.
- The taker pays each maker per fill (ceil per fill) and escrows only its resting part: escrow-then-refund at one ceil can't cover the sum of per-fill ceils. Allowances need `quoteFor(up)` plus one raw unit per fill.
- Attempts carry the decoded revert `reason`; failed orders show it as a badge. Expired orders show as cancelled.
- O(n) reads and contract list growth are logged risks with backlog cards (R26-R33, t-82 to t-85).

---
id: ADR-0019
title: "Liquidity pool: one Pool.sol per pair that is its own LP token (v2 shape, from scratch)"
status: accepted
date: 2026-11-21
tags: architecture, pool, step-4
decision: pair
---

## Goal
A GBP/USD pool to add/remove liquidity and swap against with a quote and a slippage limit, giving later steps a reference price, readable in a playground.

## Hypothesis
- We believe: one small x·y = k contract per pair, itself the ERC-20 LP token, with a UI-free `@evmb/pool` that mirrors its maths to the unit
- Will result in: quotes that always match execution, and a pool price the order book and Swap can reference
- Measured by: quote == on-chain output in tests across decimals; `amm-swap` verifies conservation and k

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| read | Readable | 5 | Higher = easy to read and explain in a playground. |
| familiar | Familiar | 4 | Higher = matches what people know (Uniswap v2). |
| effort | Low effort | 3 | Higher = less to build. |
| lp | LP transferable | 2 | Higher = LP shares are a normal ERC-20. |

## Solution: pair — one Pool.sol per pair, its own LP ERC-20
| criterion | score |
| --- | --- |
| read | 5 |
| familiar | 5 |
| effort | 4 |
| lp | 5 |

Pros:
- About a page of Solidity; the v2 model people know
- LP shares are transferable ERC-20s

Cons:
- One deploy per pair; no factory

## Solution: singleton — one contract for every pair, internal LP balances
| criterion | score |
| --- | --- |
| read | 3 |
| familiar | 2 |
| effort | 3 |
| lp | 1 |

Pros:
- One deploy

Cons:
- LP not transferable; less familiar

## Solution: vendor — vendor Uniswap v2
| criterion | score |
| --- | --- |
| read | 1 |
| familiar | 5 |
| effort | 4 |
| lp | 5 |

Pros:
- Battle-tested

Cons:
- Hard to read in a playground; licence questions

## Decision
pair. Decided with Aaron: the pool goes next (before t-62); the screenshot (design/step4/Pool.png) is the layout reference.

Claude's calls (spec "Settled after the builder check"): LP shares normalised to 18-decimal whole units before the √ (first deposit locks 1,000 raw units); `amm-swap` verifies order-independent invariants (conservation, positive outputs, final k ≥ start) with minOut = 0; a pool belongs to an unordered pair (public base/quote, found in either order, no duplicates).

## Consequences
- Prices display from an exact rational of the reserves (4 dp half-up); orderbook-style integer units collapse when the oriented quote token has few decimals (USD per GBP at 2 dp).
- The unordered-pair lookup reads `base()`/`quote()` on every record; it skips only no-code and decode failures, so transport errors surface instead of letting the page offer a duplicate deploy.
- The walkthrough needed a `transfer` step: a launched token's supply goes to its issuer, so Bob could not get GBP otherwise (closes part of t-77).
- `amm-swap` gives each trader one direction so verify checks the paid token exactly; price impact is Uniswap's (fee excluded), not the pool-price move.
- Dust-reserve price skew (R38, t-88), a uint256 overflow ceiling (R39, t-89) and fee-on-transfer tokens (R40, t-89) are logged risks.

---
id: ADR-0020
title: "Workspace files: one file holds the whole playground; a permanent top bar carries File and profile menus"
status: accepted
date: 2026-11-21
tags: architecture, web, workspace
decision: whole
---

## Goal
Reset, save and open the whole playground from a File menu, and switch accounts from a profile menu, so a workspace can be started fresh, kept, and shared.

## Hypothesis
- We believe: one `evm.fun/workspace` file (accounts with keys, chains as today's chain files with their ids, snapshots, records, walkthrough data, order-book rows, selection) opened all-or-nothing
- Will result in: New/Open/Save that behave like any desktop app's
- Measured by: Save → New → Open round-trips every page's data exactly, including links and walkthrough runs, with more than 8 chains

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| complete | Complete | 5 | Higher = Open restores everything the user had. |
| simple | Simple to use | 4 | Higher = one file, one action. |
| safe | Safe | 4 | Higher = nothing is lost when an Open fails. |
| small | Small files | 2 | Higher = smaller files. |

## Solution: whole — one workspace file
| criterion | score |
| --- | --- |
| complete | 5 |
| simple | 5 |
| safe | 4 |
| small | 2 |

Pros:
- File semantics people expect; shareable

Cons:
- Contains private keys; large with snapshots

## Solution: chain — the current chain only (today's export)
| criterion | score |
| --- | --- |
| complete | 2 |
| simple | 4 |
| safe | 4 |
| small | 4 |

Pros:
- Exists already

Cons:
- New can't reset accounts or walkthroughs

## Solution: parts — one file per area
| criterion | score |
| --- | --- |
| complete | 4 |
| simple | 1 |
| safe | 4 |
| small | 3 |

Pros:
- Flexible

Cons:
- Open becomes a multi-step chore

## Decision
whole. Decided with Aaron: a workspace file holds everything; New clears (offering Save first), Open replaces (same offer), Save warns about keys; one permanent top bar with File (incl. Import/Export chain) and a profile menu; the sidebar becomes navigation only.

Claude's calls (spec "Settled after the builder check"): Open is all-or-nothing (in-memory backup restored on failure); chains handled one at a time (works beyond the 8 live chains); per-browser settings aren't workspace data; `@evmb/orderbook` Store gains `entries(table)`; chain ids kept on Open.

## Consequences
- Saved files contain private keys (playground keys only; warned on first Save).
- Files grow with snapshots and chain history.
- Save with 8 live chains opens a transient dump-only chain beyond LIVE_MAX (one at a time, closed straight after); normal opens keep the cap.
- `kv` silently falling back to memory made persistence a precondition: New and Open are refused up front when storage isn't persistent, instead of reloading into nothing.
- Restore after a failed Open is best-effort: clear, then load the in-memory backup; Open refuses if the current workspace can't be backed up.
- `@evmb/orderbook` Store gained `entries(table)` so order-book rows can be saved.
- Risks R42–R46 log the keys in the file, the missing size cap, Open replacing everything, orphaned state, and the nine-engine peak.

---
id: ADR-0021
title: "Hash-locked cross-chain swap: the maker's lock is the offer, the page plays both parties"
status: accepted
date: 2026-11-21
tags: architecture, web, htlc
decision: lock
---

## Goal
Swap GBP on one chain for USD on another with no trusted party: either both legs complete or both are refunded.

## Hypothesis
- We believe: a hash time-locked `HashLock.sol` on each chain, where the maker's lock carries the terms (`wantChain`, `wantLock`, `wantToken`, `wantAmount`), is enough to find, answer, claim and refund a swap
- Will result in: a claim path and a refund path that each produce a report, with no off-chain offer registry
- Measured by: both paths run headless and in the page; the secret is shown only to the maker until claimed

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| simple | Simple | 5 | Higher = fewer moving parts. |
| honest | Real data only | 4 | Higher = everything shown comes from chain logs. |
| safe | Safe | 4 | Higher = a mistake costs less. |

## Solution: lock — the maker's lock is the offer
| criterion | score |
| --- | --- |
| simple | 5 |
| honest | 5 |
| safe | 4 |

Pros:
- One contract per chain; the offer lives on-chain in the lock, so a reload or a saved file finds it

Cons:
- Every lock carries four extra term fields; pairing rules live in the page

## Solution: registry — a separate offer registry
| criterion | score |
| --- | --- |
| simple | 2 |
| honest | 3 |
| safe | 4 |

Pros:
- Locks stay minimal

Cons:
- A second contract and a place for offers and locks to disagree

## Decision
lock. Decided with Aaron: the maker's lock is the offer (a lock with empty `wantChain` is an answer); the page plays both parties (no watcher); unsafe timeouts warn and ask "Lock anyway" instead of blocking; the maker's secret lives in `kv` keyed by its hash until it is claimed.

Claude's calls (spec "Settled after the builder check" 3-4): `wantLock` added to the terms and no `answers` field; claim needs `block.number < timeoutBlock` and refund `block.number >= timeoutBlock`, so the two never overlap; `BadLock` refuses zero amount or recipient, a timeout not in the future, and terms with a zero `wantToken` or `wantLock`.

## Consequences
- An answer pairs with its opening lock only on matching hash, sender/recipient swapped, the wanted token, an amount at least the wanted one, and the wanted lock on the wanted chain; anything else with that hash is ignored.
- Timeouts are in blocks, so the page needs an "Advance N blocks" control; safe means the maker's remaining blocks exceed the taker's by at least 10.
- `locksFor` reads `Locked` logs from the contract's deploy block (the same unbounded read as ADR-0019's activity); logged as a risk and backlog card.
- The secret is in the workspace file while unclaimed.
- Fee-on-transfer and rebasing tokens are not supported: the recorded amount is paid out, not the amount received.
- `eth_call` simulates at the head, but a transaction mines at head + 1, so the buttons use `canClaim` / `canRefund` (blocksLeft ≥ 2 / ≤ 1) instead of simulating at the timeout edge.
- Outcomes needed more than completed/refunded: `taker lost` (A refunded, B claimed) and `maker lost` (A claimed, B refunded) cover a mixed result, beside `refunded (maker | both)` and `stuck`.
- `unsafe` in a report is a proxy: A's head when B answered is not recorded anywhere (two chains share no clock), so it is judged from each lock's own block unless the page passes `headAAtAnswer` (kept in the workspace file as `answers`).
- The core `Approach` gains an optional `mine(n)` so the page can advance blocks; the sequencer's mine refuses while transactions are pending, so Advance is disabled then.
- Older HashLocks on chain A are not searched after a redeploy (risk R50, card t-94); the secret in the browser and in files is risk R47.

---
id: ADR-0022
title: "Incremental chain storage: state rows + block rows; boot from a state-only dump"
status: accepted
date: 2026-11-23
tags: architecture, chains, cloudflare
decision: diff-rows
---

## Goal
A chain node must persist its chain so that per-block work and memory stay flat as the chain grows.

## Hypothesis
- We believe: storing only what each block changed (state rows plus one block row), and booting a fresh node from a state-only dump, keeps cost flat
- Will result in: a commit of a few rows per block and memory far under the Durable Object's 128 MB at any height
- Measured by: a 10,000-block soak (`make soak-node`): same root and next block after a fresh boot at 2,500, 5,000 and 10,000; flat commit time and writes; memory (JS heap + external) under 128 MB

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| flat | Flat cost | 5 | Higher = per-block time, writes and memory do not grow with height. |
| simple | Simple | 4 | Higher = less code and fewer dependencies on upstream changes. |
| safe | Safe | 5 | Higher = a booted node cannot differ from the node that wrote the store. |

## Solution: diff-rows — our own per-block diff into account/slot rows
| criterion | score |
| --- | --- |
| flat | 5 |
| simple | 4 |
| safe | 4 |

Pros:
- Measured in the spike: 2.5-4.5 ms and about 3 KB per 1-tx block; boot 56 ms at any height

Cons:
- We compute the diffs ourselves (a whole-state compare, O(state) per block)

## Solution: trimmed — keep writing a dump, minus old history
| criterion | score |
| --- | --- |
| flat | 2 |
| simple | 5 |
| safe | 4 |

Pros:
- Smallest change

Cons:
- Still rewrites all state every block

## Solution: upstream — patch webevm to expose per-block change sets
| criterion | score |
| --- | --- |
| flat | 5 |
| simple | 3 |
| safe | 4 |

Pros:
- Cleanest diffs

Cons:
- Blocked on webevm changes (t-130)

## Decision
diff-rows. Decided with Aaron (design: chain store, t-129): tables `meta`, `accounts`, `code`, `storage`, `blocks` behind a tiny `Sql` interface that Durable Object SQLite and `bun:sqlite` can each be adapted to (on a DO, `sql.exec(...).toArray()` and `transactionSync`); the node rebuilds from the store on boot, every 1,000 blocks and after a rejected block.

Claude's calls: a slot at zero is treated as absent (webevm keeps it as `0x`, the trie drops it) so its row is deleted; the block row and the diff are written in one transaction; a commit that throws or a rejected block rebuilds the node from the store.

## Consequences
- Soak (10,000 blocks, file-backed SQLite): commit 0.53-0.72 ms (SQL write only), 8 rows and about 9.9 KB per block, memory (JS heap + external) 70-85 MB of the DO's 128 MB, sampled just before the every-1,000 rebuild (the node's most history), all flat; boots matched the live root and next block at 2,500, 5,000 and 10,000.
- `external` only partly reflects wasm linear memory (one revm node: external +2.4 MB, rss +15.6 MB), so `memMB` is a lower bound; the real Durable Object figure is measured under workerd in t-134.
- The diff compares whole-state dumps, so it is O(state) per block; logged as risk R51 (switch to a touched-keys diff past a few MB of state).
- The in-memory node keeps only the last 256 headers plus up to 1,000 blocks; full history stays in the `blocks` table and is never pruned.
- webevm 0.9.1 internals (the per-block timestamp via `blockEnv`) are still relied on (t-130).

---
id: ADR-0023
title: "Deploy codes live on the root chain; the cloud node mines the new chain's set-up block"
status: accepted
date: 2026-11-23
tags: architecture, chains, cloudflare, access
decision: root-codes
---

## Goal
Only people the root admin has chosen may create chains on the cloud worker, with nothing secret stored and nothing deployed from CI.

## Hypothesis
- We believe: deploy codes stored as `keccak256(code)` + expiry + uses on the root chain's `ChainAccess` (the invite mechanism, grant bit `GRANT_CREATE_CHAIN`) are enough to gate chain creation
- Will result in: a friend creating a chain with one code and being refused for a wrong, expired or used-up code
- Measured by: `make e2e-node` (issue, deploy, every refusal) against the local worker

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| simple | Simple | 5 | Higher = fewer new moving parts. |
| honest | Auditable | 4 | Higher = who issued and redeemed what is on a chain. |
| safe | Safe | 5 | Higher = a leaked store or a mistake costs less. |

## Solution: root-codes — codes on the root chain
| criterion | score |
| --- | --- |
| simple | 4 |
| honest | 5 |
| safe | 4 |

Pros:
- Reuses invites (t-133); issuing is a signed tx from evm.fun; redeems are recorded on chain; only hashes are stored

Cons:
- A short typed code is guessable (rate limit and generated 4-word codes); a code is spent even if creation then fails

## Solution: kv — a worker-side KV of codes
| criterion | score |
| --- | --- |
| simple | 5 |
| honest | 2 |
| safe | 3 |

Pros:
- No contract call to issue a code

Cons:
- A second store with its own admin API; no on-chain record of who deployed what

## Decision
root-codes. Decided with Aaron (t-134): the first chain is the root chain, created by the key named in the worker's config (`ROOT_ADMIN`, an address, not a secret); a code alone is enough (no per-use approval); the TTL bounds the risk.

Claude's calls (spec "Deviations"): the browser signs the two set-up txs and uploads them with its dump, and the new chain's Durable Object mines them as block head+1 with real state roots (evm.fun's chains compute no roots); evm.fun then replaces its local chain with the returned dump and checks the head hash, so both copies are identical. View routes (`access-controls/latest`, aliases) are not ported (t-138, t-139).

## Consequences
- Interface changes: `deployChain` takes a required `registry` option (`replaceState`, `setDeployed`) so it stays testable without the wasm loader; its errors carry `step` and `chainId`; `NodeClient.baseUrl` is `readonly`; Deploy is refused once a chain is deployed.
- Failed redeems are limited to 10 per IP per 10 minutes (`429`); request signatures are single-use within 300 s.
- A code is spent when the redeem succeeds; if the new chain's creation then fails, the admin issues another (risk R53).
- The root admin key is on Aaron's machine (`.env.live`, git-ignored) and in evm.fun's Accounts (risk R54); the worker holds only its address.
- Live target: `make deploy` to `cloud.mychain.dev`; nothing deploys from CI. The Pages build gets the URL from repo variable `NODE_URL`.
- Guessable codes and the per-IP limit: risk R52.


---
id: ADR-0024
title: "Every device is a follower until B; followers are saved as pointers in workspace files"
status: accepted
date: 2026-11-23
tags: architecture, chains, web, access
decision: all-follow
---

## Goal
Show a deployed chain on every device of its owner, with real positions and no drifting copies, before any device can write to it through the cloud node.

## Hypothesis
- We believe: making the owner's browser copy a read-only follower of the cloud chain, like any other device, is enough for "follow and show" (plan 17 part 2)
- Will result in: Deploy, join, invite, remove and the Devices panel working against one chain with no reconciliation
- Measured by: `make e2e-node` and the browser checklist in the evm.fun README section

## People
- Aaron — decider
- Claude — author

## Criteria
| id | criterion | weight | description |
| --- | --- | --- | --- |
| nodrift | No drift | 5 | Higher = every copy is the cloud chain's own blocks. |
| simple | Simple | 4 | Higher = less to change now. |
| later | Ready for B | 3 | Higher = B (follow and use) needs less rework. |

## Solution: all-follow — every device is a follower, including the owner's
| criterion | score |
| --- | --- |
| nodrift | 5 |
| simple | 3 |
| later | 4 |

Pros:
- One kind of copy; positions are real everywhere
- Device management is just txs sent to the cloud chain

Cons:
- The owner's copy goes read-only after Deploy ("Read-only until B: this chain lives on the cloud")

## Solution: owner-writable — the owner's copy stays writable
| criterion | score |
| --- | --- |
| nodrift | 1 |
| simple | 4 |
| later | 2 |

Pros:
- Less change now

Cons:
- The owner's copy and the cloud chain drift apart, and B must reconcile them

## Decision
all-follow. Decided with Aaron (design option (ii) rejected): Deploy converts the owner's copy to a follower (a chain deployed earlier converts when opened: quietly if its head matches the cloud block hash, else the user picks Export or Convert anyway).

Claude's call: a follower is saved in workspace files as a pointer (node URL, chain id, the account that follows) together with its contract and asset records, not as a copy of the chain; opening it makes no request, and the follower boots from the cloud's `state` on demand.

## Consequences
- No playground page writes to a deployed chain until B; they show a read-only message. (B is now done: ADR-0025, plan 21.)
- A workspace file stays small, and a follower's state is never trusted from the file: it is re-fetched and root-checked.
- A removed or mismatched follower stops and says so; the user deletes it or joins again.
- Polling cost and the multi-use writer code: risks R55 and R57.


---
id: ADR-0025
title: "The cloud orders writes; the chain checks who submits, contracts check who acts"
status: accepted
date: 2026-11-24
tags: architecture, chains, access, devices
decision: cloud-orders
---

## Goal
Let a device on a deployed chain write: a tx runs on its own copy at once, and the chain still ends with one order that every copy agrees on.

## Hypothesis
Devices that write offline will sometimes send txs that clash (one balance spent twice). Someone has to pick which one wins, and the rest must say so rather than vanish.

## People
- The owner and members who use a chain from a phone or laptop, sometimes offline
- The chain admin, who decides who may submit
- Contract authors, who decide who may do what inside a contract

## Criteria
- one order: every copy reaches the same blocks and state roots
- offline: a write works with no connection and is kept until it can be sent
- honest: a clashing write shows as conflicted, never silently lost or silently won
- simple: the fewest new rules on the chain

## Solution: the cloud orders; the chain ACL checks the submitting key only
The cloud node mines what it receives, in the order it receives it. A device keeps its own txs as pending, runs them locally, submits them in batches (`POST /submit`, answered per tx), and rebases on the cloud's blocks: a pending tx the cloud mined with the same status and logs is confirmed, with other ones conflicted, and one the cloud refused is refused. The chain's `ChainAccess` is checked against the key that signs the request. The sender of a tx inside it needs no chain role, so a broker device can submit a tx signed by someone else's key. What a sender may do is decided by the contracts (`Governance`-style allow-lists, owner checks).
Pros:
- Nothing to merge: the cloud's order is the order
- A device can send for keys it does not hold the chain role of; apps decide who may act
- Same copy everywhere, checked by hash and state root

Cons:
- A contract without version checks lets the later write win silently (risk R60)
- Pending txs live only on the device until synced (risk R59)

## Solution: every tx sender must be a chain writer
| criterion | score |
| --- | --- |
| oneorder | 4 |
| offline | 4 |
| honest | 4 |
| simple | 2 |

Pros:
- One place to look for who may write

Cons:
- Every key a user signs with needs a chain role, and a broker cannot submit for a key with none
- A second ACL beside each contract's own

## Decision
cloud-orders, with the chain ACL on the submitting key only. Decided with Aaron: contract ACLs (a governance contract the apps consult) own who may act; the chain ACL owns who may talk to the node.

Claude's call: outcomes are compared by status and logs (not state), so a tx that behaves the same way after a rebase is confirmed; one that does not is conflicted and the user decides.

## Consequences
- `POST /submit` answers per tx: mined, or refused with a code (`nonce`, `invalid`); a resend of a mined tx answers mined; the body is capped at 512 KiB (`413`) and 256 txs, so a block row stays under DO SQLite's 2 MB; a block row over 1.5 MB is a 400 before it is stored; `GET /blocks` pages at 100 blocks or 8 MiB.
- Behaviour changes in the worker: an undecodable tx is refused per tx (`invalid`), not a 400 for the request; an empty submit mines nothing; non-hex input is a 400; webevm checks nonce and funds only at mine time, so `ChainNode` prechecks them; a tx short of funds is retried in a second block of the same request, since an earlier tx may fund it. A server fault (any failure after mining, or a failed rebuild) answers 503, so a `Follower` keeps its txs pending through an outage; a tx-caused rejection stays 400.
- Known limits: a re-signed contract deploy, or a tx whose logs include the block number or time, always ends conflicted; `send` can wait behind a running `sync`; webevm 0.9.1 `loadState` does not reset accounts missing from the dump, so the Follower rebases on a fresh node (upstream, t-130).
- A self-governed allow-list contract is a later card (t-147).
- The chain ACL has three roles (t-152): read, write and deploy. Deploy (`GRANT_DEPLOY`, `ChainAccess.canDeploy`: a deployer or the admin) lets the submitting key create contracts. The worker checks it on the submitter, per tx, and refuses a creation (a tx with no `to`) from a submitter without it (`invalid`, "<signer> can't deploy contracts on this chain"). Factories are not checked: a contract may create contracts for any caller; apps govern that. `addDeployer` also adds a writer, and `removeWriter` also drops deploy. A chain whose `ChainAccess` predates the role has no `canDeploy`; there writers deploy (the fallback applies only when the function is absent, not on any other failure). evm.fun refuses a creation locally from a device without deploy.
- Risks R59 and R60.


---
id: ADR-0026
title: "Deploy codes live in root's Onboarding contract; the worker asks root, and only root vouches"
status: accepted
date: 2026-11-25
tags: architecture, chains, access, onboarding
decision: root-onboarding
---

## Goal
Let admins decide who may create a chain on the worker, with codes they can issue, time-limit, count and revoke, and see who redeemed what.

## Hypothesis
If the chain is the database, the worker needs no SQL for codes: it asks root one question, may this key create this chain, and the answer is already on chain.

## People
- Admins (issuers), who hand out codes
- Friends who redeem one and get a chain of their own
- The worker operator, who must not let a chain owner mint deployments

## Criteria
- dogfood: codes, redemptions and issuers live on root, not in worker SQL
- trust: the worker believes only root's Onboarding
- no lost use: a code is never spent with no chain to show for it
- simple: the fewest new moving parts

## Solution: Onboarding contract on root; root state is the token
`Onboarding(IAllows issuers)` on root: issuers `issue` (codeHash, label, expiry, uses 1-1000) and `revoke`; anyone `redeem(code, chainId)`, which spends a use and records a grant `chainId -> {by, codeHash, at}`. The worker reads `isDeployAllowed(signer, chainId)` (token introspection) and creates the chain only if true. Issuers are an `AllowList` (an `IAllows`: `allows(caller, subject, owner)`), seeded with the root admin key and governed by itself. The worker finds Onboarding through root's `Aliases.get("onboarding")` and publishes it as `root.onboarding` in `GET /health`. `POST /chains` gains a third form, `{ chainId, dump, setup, redeem? }`: the redeem tx is prechecked like a claim, mined on root, then the grant is checked and the chain created with id `chainId`. A failed create leaves the grant, so the app retries without `redeem`.
Pros:
- No worker SQL; codes, grants and issuers are on chain and readable by issuers
- A code is spent once and its grant survives a failed create (R53 closed for this path)
- `IAllows` is one function, so a Users/Groups/Policy allow-list can replace `AllowList` later without changing the worker

Cons:
- A 6-digit code can be brute-forced from its hash by whoever can read root (risk R62)
- A second issuer needs two entries: the AllowList and root `ChainAccess` writer, since issuing is a root tx

## Solution: the admin signs a ticket
| criterion | score |
| --- | --- |
| dogfood | 2 |
| trust | 3 |
| no lost use | 2 |
| simple | 3 |

Pros:
- No contract state for redemptions

Cons:
- A contract can't sign, so the admin would have to be online to issue
- Nothing on chain shows who redeemed what

## Decision
root-onboarding. Decided with Aaron (2026-11-25): the worker honours root's Onboarding only (other chains may hold their own for other purposes); evm.fun and its `claim` form are unchanged; the new app (`@evmb/app`, over `@evmb/workspace` and `@evmb/keys`) is local only for now, since mychain.dev fronts evm.fun.

Claude's call: refusals say why (`no such code`, `code expired`, `code used up`, `code revoked`, `bad code`, `bad chain id`, `chain id taken`, `issuers only`, `not allowed to create this chain`): a short-lived, rate-limited code gains an attacker nothing from them.

## Consequences
- An issuer must also be a root writer, because `issue` and `revoke` are root txs. A second admin needs the AllowList entry and a root `ChainAccess` writer entry (a README step for now).
- Root must stay read-closed and its readers trusted: a redeem puts the plaintext code on root, and `codes()` shows hashes of 6-digit codes (risk R62).
- Keys in the browser are encrypted at rest with a passphrase (risk R63).
- Not in this step: Users, Usernames, Policy, Groups, passkeys, moving evm.fun onto `keys`/`workspace`.
- Risks R62, R63; R53 noted.
