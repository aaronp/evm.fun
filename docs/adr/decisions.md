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
