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
- likelihood: 4
- target: 2x1
- appetite: 4
- category: Quality
- driver: Claude
- approver: Aaron

`bun test` (Bun 1.3.13) panicked once in 4 runs during the plan-3 final review (82 workers spawned, 74 terminated at the time of the crash). Plan 3 raised worker churn: the suite now creates 129 workers (base 3c6dd51: 18), because the web tests build sequencer chains that each start `hardwareConcurrency - 1` verify workers. Re-runs on 2026-11-19 did not reproduce it: HEAD 0 crashes in 40 runs, base 0 in 35. An instrumented run showed all 129 workers terminated, so no test leaks a chain; the crash looks like a Bun bug when workers are terminated (not awaited) while others start.

Update during plan 6 (snapshots): the crash now reproduces in about 1 of 2 to 3 full runs, more often inside the sandbox, and once as exit 133. The earlier zero-in-40 result no longer holds, so likelihood is raised from 2 to 4.

Root cause of most of that rise, found 2026-11-19 at the end of plan 6: one snapshot test (`createFrom: storage failing…`) never disposed its source sequencer chain, leaving 11 verify workers alive at exit (found with a `Worker`-counting `--preload`; that test was the only leaker). After the fix, every suite ends with 0 live workers, and the remaining rate is about 1 crash in 5 to 6 runs (single process or split, so splitting doesn't help). That residue is Bun's.

Update during plan 8 (swap): the residual rate is now about 1 in 3 full runs (a Task 6 check at e5916ac: 3 runs, 1 segfault, 2 clean). A `Worker`-counting preload at e5916ac found no leaks, so the new tests dispose their chains and the rise is Bun's, not ours. Likelihood stays 4.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Every test disposes its chains (instrumented run: 129/129 workers terminated) | Preventive | Partial |
| Re-run on a crash; a panic with all tests passed is not a test failure. CI (pages.yml) runs `bun test || bun test`, so a deterministic failure still fails | Corrective | Partial |
| Leak check: `bun test --preload <Worker-counting script>` should report 0 live workers per file | Detective | Partial |
| Upgrade Bun when a release fixes worker teardown | Corrective | Partial |

## R12 · Google Fonts third-party fetch in the playground
- impact: 1
- likelihood: 3
- target: 1x2
- appetite: 4
- category: Quality
- driver: Claude
- approver: Aaron

The playground loads Inter, Space Grotesk and JetBrains Mono from Google Fonts through a `<link>` in `index.html`. Each page load sends the visitor's IP and user agent to a third party (privacy), and offline or blocked-network use gets no web fonts.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| System fallback font stacks, so the UI stays fully usable without the fetch | Corrective | Strong |
| Self-host the fonts if privacy or offline use becomes a requirement | Preventive | Partial |

## R13 · Memory and CPU with many live chains in one tab
- impact: 2
- likelihood: 3
- target: 1x3
- appetite: 4
- category: Technology
- driver: Claude
- approver: Aaron

Each running chain holds an engine, and sequencer chains start `hardwareConcurrency - 1` verify workers. Many chains open at once in one tab can exhaust memory or CPU and make the playground sluggish or crash the tab.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Cap: warn at 4 running chains, refuse at 8, never auto-close (ADR "Cap on running chains in one tab") | Preventive | Strong |
| The chain list never opens a chain; it only reads the height of one already running | Preventive | Strong |
| Delete a chain or reload the page to stop running chains | Corrective | Partial |

## R14 · webevm loadState does not clear the manual-mining queue
- impact: 3
- likelihood: 1
- target: 3x1
- appetite: 3
- category: Technology
- driver: Claude
- approver: Aaron
- status: closed
- closed: 2026-11-19

Restore calls webevm `loadState` on the live node. In webevm 0.9.1 `loadState` does not clear the manual-mining queue, so txs queued before a restore would be mined on top of the restored state. The pipeline cannot reach this: `restoreTo` requires `pending() === 0` and the dialog disables Restore otherwise. It is reachable through the raw request pass-through (a manual-mining chain given txs by direct JSON-RPC, then restored).

Closed 2026-11-19: moot. `loadState` also never clears accounts, code or storage created after the snapshot (it merges), so restore now disposes the node and loads the dump into a fresh one (the `setup({dump})` path). A fresh node has an empty queue, so nothing queued before a restore can survive it.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| `restoreTo` refuses while `pending() > 0` (nothing saved or lost) | Preventive | Strong |
| Restore dialog polls pending and disables Restore with "Wait for N pending transactions to settle" | Preventive | Strong |
| Clear the queue ourselves or fix upstream if restore is ever exposed to raw requests | Corrective | Partial |

## R15 · Snapshot storage growth
- impact: 2
- likelihood: 3
- target: 2x2
- appetite: 4
- category: Technology
- driver: Claude
- approver: Aaron

Each snapshot stores a full dump (blocks, receipts, transactions, state) in IndexedDB, and "Save current state first" adds one on every restore. Measured: a 2,000-block chain is about 5.7 MB (5,665 KB), so repeated snapshots of long chains can fill browser storage quota or slow the dialogs. Heavier blocks (deploys, logs) will be larger.

The kv store drops to memory for good after any failed IndexedDB operation (the app then shows it is not persisting). Snapshot writes are the exception: they use a strict write, so a quota or IndexedDB failure on a large snapshot is shown in the dialog ("Snapshot too large to save (N KB): browser storage is full" or the error) and the rest of the app keeps persisting.

The orphan prune at startup is per tab: it knows only this tab's stored and live chains, so reloading one tab can prune the snapshots of a benchmark chain still live in another tab. That is acceptable for a single-tab playground.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| The snapshots dialog shows each snapshot's size in KB and a "large" badge above 20 MB | Detective | Partial |
| Delete a snapshot from the dialog; deleting a chain deletes its snapshots | Corrective | Strong |
| Save-first is a checkbox, so it can be turned off | Preventive | Partial |
| Snapshot writes are strict: a failed write shows its error and never switches kv to memory | Corrective | Strong |
| Startup prunes snapshots whose chain is gone (unsaved benchmark chains) | Corrective | Strong |

## R16 · Allowance discovery scans all Approval logs from block 0
- impact: 2
- likelihood: 4
- target: 2x2
- appetite: 4
- category: Technology
- driver: Claude
- approver: Aaron

The Allowances card finds (owner, spender) pairs with `eth_getLogs` for the token's `Approval` event from block 0 to latest, on every open and after every transaction (it re-runs on each balance tick), then re-reads each pair with `allowance()`. The cost grows with chain history and with the number of distinct pairs, so a long-lived or busy playground chain makes the card slow.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Playground scale: chains are small, and the filter is one address and one topic | Preventive | Partial |
| Upgrade path: page the log scan, or index incrementally and cache by block (ADR approach B) when a chain gets long | Corrective | Partial |

## R17 · Swap book read grows with every offer
- impact: 2
- likelihood: 4
- target: 2x2
- appetite: 4
- category: Technology
- driver: Claude
- approver: Aaron

The Swap page reads `nextId` and then `offers(1..nextId-1)`, every offer ever made, open or not, one `eth_call` per offer, on load and after every transaction (ADR-0016, solution A). A chain with thousands of offers makes the page slow.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Playground scale: a few hundred offers load in well under a second | Preventive | Partial |
| Upgrade path: an incremental indexer keyed by block without changing Swap.sol (backlog t-67) | Corrective | Partial |

## R18 · Swap failure reports can miss earlier same-block txs and old state
- impact: 2
- likelihood: 3
- target: 2x2
- appetite: 4
- category: Quality
- driver: Claude
- approver: Aaron

Already taken or cancelled is decided from the Swap's `OfferTaken`/`OfferCancelled` logs ordered by block and tx index, so a same-block race names the winner; the offer's stored `taker` and `closedBlock` name the winner and narrow that log query to one block. Any other reverted take is replayed with `eth_call` at the parent block. An approve or transfer earlier in the same block is not seen, so the reason can be wrong. Playground chains also keep only the last 256 blocks of state history; for an older failure the replay falls back to `latest`, which the report says in a note.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| The report states when it reconstructed at `latest` instead of the failing block | Detective | Partial |
| Bounded history window (256 blocks) keeps memory small | Preventive | Partial |
| Replay with the block's preceding txs applied, or trace the tx (backlog t-68) | Corrective | Partial |

## R19 · Swap Activity scans every block
- impact: 2
- likelihood: 3
- target: 2x2
- appetite: 4
- category: Technology
- driver: Claude
- approver: Aaron

Activity finds reverted takes by scanning blocks for txs to the Swap with status 0, and fetches logs from block 0, with unbounded parallel reads; it then runs one `takeReport` per reverted take to get its reason. The cost grows with chain length and with the number of failed takes.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Playground scale: chains are small | Preventive | Partial |
| Index failed attempts or use the explorer's tx index (backlog t-69) | Corrective | Partial |

## R20 · Swap "your offers" filters all offers
- impact: 1
- likelihood: 4
- target: 1x2
- appetite: 4
- category: Technology
- driver: Claude
- approver: Aaron

The page builds a maker's offers by filtering the full offer list, so it costs the same as the whole book read (R17) even for a maker with one offer. The contract records no per-maker index.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Playground scale: same bound as R17 | Preventive | Partial |
| Per-maker on-chain offer index: `makeOffer` records ids per maker (backlog t-72) | Corrective | Partial |

## R21 · Swap report status lookup scans logs from block 0
- impact: 1
- likelihood: 1
- target: 1x1
- appetite: 1
- category: Technology
- driver: Claude
- approver: Aaron
- status: closed
- closed: 2026-11-20

`take` stored the taker and fill block, but `cancel` stored no block, so the report for a take that hit a cancelled offer (and any reverted take on an open offer) found the status change by scanning logs from block 0.

Closed 2026-11-20 (t-73): `cancel` now stores `closedBlock` as `take` does, so a filled or cancelled offer's report reads one block's logs. An open offer cannot have been taken or cancelled (offers never reopen), so its report makes no log query at all.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| `take` and `cancel` store `closedBlock`; the report queries that one block | Preventive | Strong |
| No log query for an offer that is still open | Preventive | Strong |

## R22 · Fee-on-transfer and rebasing tokens leave Swap escrow short
- impact: 3
- likelihood: 2
- target: 3x1
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

Swap escrows `giveAmt` with `transferFrom` and pays out the same nominal amount. A fee-on-transfer or rebasing token delivers less than it records, so the escrow can be short and a take or cancel can revert or pay out of other offers' funds.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Scope: playground tokens are the plain OpenZeppelin ERC-20s the app launches; offers hold ERC-20s only (ADR-0016) | Preventive | Partial |
| Measure the balance delta on deposit, or refuse such tokens (backlog t-74) | Corrective | Partial |

## R23 · Ribbon waits on a page that never offers its action
- impact: 2
- likelihood: 3
- target: 2x1
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0017. Next waits up to 5 s for the page to register its action or for the chain/account switch to land, then shows a generic error. A failing `selectChain` is not surfaced, so the user waits the full 5 s and sees "Couldn't switch" instead of the cause.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| The 5 s timeout ends the wait with a visible error; the user can retry or Exit | Detective | Partial |
| Surface selectChain errors in the ribbon (backlog t-79) | Corrective | Partial |

## R24 · Render-time writes in the wizard hooks may misbehave under concurrent rendering
- impact: 2
- likelihood: 2
- target: 2x1
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0017. `useWizardField` and `useWizardAction` register with the ribbon while rendering. React may render without committing, so a registration can come from a render that never lands. The app does not use concurrent features today, so it works.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| No concurrent features (transitions, Suspense) around wizard pages today | Preventive | Partial |
| Move registration into effects or useSyncExternalStore (backlog t-79) | Corrective | Partial |

## R25 · No DOM test harness for the ribbon
- impact: 3
- likelihood: 3
- target: 3x1
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0017. Ribbon effects, Next's switch wait and field refill have no automated test: the runner and the render output are tested, but behaviour that needs a live DOM is checked only in the browser (checklist in the task 6 report).

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Runner, validation and render tests cover the logic; a browser checklist covers the rest | Detective | Partial |
| Add a DOM harness (backlog t-80) | Corrective | Partial |

## Example design risk
- impact: 5
- likelihood: 3
- stars: 3
- category: some-category-tag
- slugs: some-slug
- inherent: 3x3
- target: 4x4
- confidence: 3
- appetite: 25
- driver: who's owning this
- approver: who approves this risk
- contributors: who's involved; another person
- informed: who's informed

design risk decision

### Clarification
25 is the max 'appetite' for this risk.
We gave it 3/5 stars in confidence.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Some Control - how we mitigate this risk | Preventive | Partial |
| Detective controle | Detective | Effective |

### Evidence
| Title | Description | Resources |
|---|---|---|
| Risk Evidence | anything we've observed | some resource |
