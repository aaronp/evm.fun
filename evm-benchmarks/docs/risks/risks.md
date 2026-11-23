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

Update 2026-11-23 (plan 15): 1 of 3 full runs crashed (exit 133) on branch chain-store, the others 787/787; same rate as before; CI retries up to 3 times (6b3f3e0).

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

## R26 · Order-book trades() reads the whole log from the deploy block
- impact: 3
- likelihood: 4
- target: 3x2
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0018. Both venues' `trades()` run a topic-filtered log query from the venue's deploy block (a fork's `fromBlock` falls back to 0). Not a block scan, but the read grows with chain history until an indexer exists. The ruling allowing it is in the ADR-0018 plan ledger.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Topic-filtered query, not a block walk; limit applied to the result | Detective | Partial |
| Index trades as they happen (backlog t-83) | Corrective | Partial |

## R27 · Off-chain book, place and Trade-page polling re-read every open order and maker
- impact: 3
- likelihood: 4
- target: 3x2
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0018. `book()` and `place` read every open order on a side and each maker's balance and allowance live (O(orders + makers) calls); the Trade page also re-reads My orders and balances every tick. Fine for a playground book, slow for a large one.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Reads are live on purpose so the book never shows liquidity the chain won't honour | Preventive | Strong |
| Batch the reads, cache per block, and poll less (backlog t-83) | Corrective | Partial |

## R28 · On-chain book lists grow with dead ids
- impact: 3
- likelihood: 3
- target: 3x2
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0018. Cancelled ids stay in their level's queue (a cancel-spam attack at one price level makes every take skip them), emptied levels keep their ids, the hint walk is unbounded when the hint is bad, and `ordersOf` is unbounded. Gas grows with that history.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Dead ids are skipped per take; a good hint makes insert O(1); `maxLevels` caps the levels crossed | Preventive | Partial |
| Compact queues on take and bound the walk and `ordersOf` (backlog t-82) | Corrective | Partial |

## R29 · Push payments let a blacklisting or hook token block a price level
- impact: 3
- likelihood: 2
- target: 3x1
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0018. `OrderBook` pays each maker from the taker's wallet in the taking transaction. A token that blacklists the maker or runs a hook that reverts makes every take across that order revert, blocking the level until the maker cancels.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Scope: playground tokens are plain OpenZeppelin ERC-20s | Preventive | Partial |
| Skip a failing maker or move to pull payments (backlog t-82) | Corrective | Partial |

## R30 · idbStore is tested only against fake-indexeddb
- impact: 3
- likelihood: 3
- target: 3x2
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0018. The shared conformance suite runs `idbStore` on `fake-indexeddb`; no test runs it in a real browser. Known gaps: rows with undefined/NaN index keys are dropped (memory indexes them), the version is fixed at 1, and there is no `onblocked`/`versionchange` handling.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| One conformance suite for both stores; browser checklist in the task 11 report | Detective | Partial |
| Run the suite in a real browser and handle upgrades (backlog t-85) | Corrective | Partial |

## R31 · Off-chain orders: EOA signatures only, no per-maker nonce invalidation
- impact: 3
- likelihood: 2
- target: 3x1
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0018. `Settlement.sol` verifies ECDSA signatures only (no ERC-1271 contract wallets) and a maker can cancel one order at a time but cannot invalidate all of them at once (no nonce floor).

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Playground scope: accounts are EOAs; noted in the contract NatSpec | Preventive | Partial |
| ERC-1271 and a per-maker nonce floor (backlog t-84) | Corrective | Partial |

## R32 · Attempts journal can miss a hash or keep a pending row
- impact: 2
- likelihood: 3
- target: 2x2
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0018. A broadcast transaction whose `wait` throws is journalled as an error without a hash, though it may land unseen; a closed tab leaves `pending` rows. Neither shows correctly as a failed or filled order.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| The journal row is written before sending, so the attempt is never lost | Detective | Partial |
| Record the hash at broadcast and reconcile pending rows on open (backlog t-84) | Corrective | Partial |

## R33 · Off-chain resting orders lose coverage when a settle spends the allowance
- impact: 2
- likelihood: 3
- target: 2x2
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0018. An off-chain order stays signed after the maker's allowance is spent by another settle; it silently becomes `unfunded` and leaves the book. The form's need includes the maker's other open orders (`Venue.committed`), but nothing re-approves later.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| The book and matching use the same live coverage, so no unhonourable liquidity shows | Preventive | Strong |
| Warn the maker in My orders and offer Approve more (backlog t-84) | Corrective | Partial |

## R34 · Off-chain book can rest crossed after a maker is re-funded
- impact: 2
- likelihood: 2
- target: 2x1
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0018. Matching skips unfunded orders and fills whose quote rounds to 0, so a limit order priced through such an ask (or bid) rests beyond it; once that maker is re-funded both are live and the best bid ≥ the best ask. The book stays crossed until the next crossing taker clears it; orders are never refused for it.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| The Trade header and book show "crossed" instead of a spread; the depth chart centres on the midpoint of the two bests | Detective | Effective |
| The next taker crossing either best matches the crossed orders at the makers' prices | Corrective | Partial |

## R35 · Snapshot restore does not roll back the order-book store
- impact: 2
- likelihood: 2
- target: 2x1
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0018. A restore keeps the chain's UUID scope, so the order-book store (attempts journal, signed off-chain orders) keyed by `[chainId, venueAddress, …]` is not rolled back with the chain: failed attempts from after the snapshot stay listed, and off-chain orders signed after it stay valid if Settlement is redeployed at the same address.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Store keys include the venue address, so a redeploy at a new address never mixes | Preventive | Partial |
| Scope the store by snapshot generation, or clear it on restore | Corrective | Partial |

## R36 · Pool activity reads every event since deploy
- impact: 3
- likelihood: 3
- target: 3x2
- appetite: 3
- category: Performance
- driver: Claude
- approver: Aaron

ADR-0019. `activity` calls eth_getLogs from the pool's deploy block on every refresh, so cost grows with the chain (O(chain)).

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Reads are limited to the pool's own address and three topics | Preventive | Partial |
| Bounded window or incremental/indexed read (backlog t-87) | Corrective | Partial |

## R37 · No factory: pools are found via contract records
- impact: 2
- likelihood: 2
- target: 2x1
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0019. Without a factory a pool is discovered only through this app's contract records plus on-chain `base()`/`quote()` reads; a pool deployed elsewhere is invisible and duplicates are refused only for known records.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| findPool reads base/quote on chain, either order; deploy refuses an existing pair | Preventive | Partial |
| Registry or factory contract (backlog t-88) | Corrective | Partial |

## R38 · Price skew at dust reserves
- impact: 2
- likelihood: 2
- target: 2x1
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0019. A pool with tiny reserves can be pushed to an arbitrary price by a small trade or first deposit; later depositors adding at the skewed ratio lose value.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| minShares on add protects depositors; first deposit locks 1,000 raw units | Preventive | Partial |
| Warn or refuse adds below a minimum liquidity (backlog t-88) | Corrective | Partial |

## R39 · Theoretical uint256 overflow in products for enormous supplies
- impact: 1
- likelihood: 1
- target: 1x1
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0019. Swap and add multiply reserves by amounts and 10000 before dividing; with supplies near 2^256 / 1e4 the product overflows and the call reverts. Unreachable with playground tokens.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Solidity 0.8 checked arithmetic reverts instead of wrapping | Preventive | Effective |
| Use mulDiv (full-precision) in the contract (backlog t-89) | Corrective | Strong |

## R40 · Fee-on-transfer and rebasing tokens unsupported
- impact: 2
- likelihood: 1
- target: 2x1
- appetite: 3
- category: Quality
- driver: Claude
- approver: Aaron

ADR-0019. The pool tracks reserves in storage and assumes it receives exactly what is pulled; a token that skims on transfer or rebases makes storage and balances diverge and breaks the quote.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Documented limit; the playground's tokens are plain ERC-20 | Preventive | Partial |
| Measure the received balance per pull, or reject such tokens (backlog t-89) | Corrective | Partial |

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

## R41 · A sender that can't pay gas×fee+value stops an approach-02 executor for good
- impact: 3
- likelihood: 3
- target: 3x1
- appetite: 3
- category: Technology
- driver: Claude
- approver: Aaron

On an approach-02-seq-memory (sequencer) chain, a tx whose sender can't afford gas × fee + value makes webevm's `mine()` throw, and approach-02 treats that as fatal: the executor stops permanently. The web app's `signAndSend` refuses such a send up front, but only reads the latest balance and ignores the sender's pending txs, so concurrent sends from one account can each pass and together overspend. Non-web clients (raw JSON-RPC, scripts) are not covered at all.

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| `signAndSend` balance pre-check in the web app | Preventive | Partial |
| Reject at admission in approach-02, counting pending txs (backlog t-91) | Preventive | Partial |

## R42 · A workspace file contains every account private key
- impact: 3
- likelihood: 3
- target: 2x2
- appetite: 4
- category: Security
- driver: Claude
- approver: Aaron

A saved workspace file holds each account's private key unencrypted, so a shared or leaked file hands over those accounts. They are playground keys, but a user may reuse a real one. (ADR-0020)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Notice on first Save and the web README warning: playground keys only | Preventive | Partial |

## R43 · No total size cap on workspace files
- impact: 2
- likelihood: 3
- target: 2x2
- appetite: 4
- category: Performance
- driver: Claude
- approver: Aaron

Files grow with snapshots and chain history; Save and Open hold the whole file in memory and nothing limits its size, so a very large workspace can be slow or fail to save or open in the browser. Strings in a file are not length-bounded either. (ADR-0020)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Failed Open restores the previous workspace | Corrective | Partial |
| Chains handled one at a time | Preventive | Partial |

## R44 · Open replaces the whole workspace
- impact: 4
- likelihood: 2
- target: 2x2
- appetite: 4
- category: Security
- driver: Claude
- approver: Aaron

Open clears every account, chain, record and walkthrough before loading the file; opening the wrong file, or a failure the restore cannot undo, loses work. (ADR-0020)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Confirm with Save first, all-or-nothing Open with in-memory backup restored on failure, and a download of the previous workspace (automatic when the restore fails; Close then asks to confirm) | Corrective | Effective |

## R45 · A chain whose removal fails may leave orphaned persisted state
- impact: 2
- likelihood: 2
- target: 2x2
- appetite: 4
- category: Quality
- driver: Claude
- approver: Aaron

If removing a chain fails during New or Open, its host-persisted state can remain in the browser, unused. The chain is closed so it does not block the restore. (ADR-0020)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Chain closed when its remove fails; kv.clear() removes other orphan records | Corrective | Partial |

## R46 · Save and Open briefly run LIVE_MAX + 1 engines
- impact: 2
- likelihood: 2
- target: 2x2
- appetite: 4
- category: Performance
- driver: Claude
- approver: Aaron

With 8 live chains, Save opens one extra dump-only engine at a time, so memory briefly holds 9 engines (closed straight after). (ADR-0020)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| One transient chain at a time, closed right after; normal opens keep the cap | Preventive | Partial |

## R47 · The maker's swap secret is stored in the browser and in saved files
- impact: 3
- likelihood: 2
- target: 2x2
- appetite: 4
- category: Security
- driver: Claude
- approver: Aaron

Until the maker claims, the secret sits in the browser's key-value store and in workspace files (`secrets`); anyone with the file or browser profile can claim the taker's lock first. (ADR-0021)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Shown only to the maker, never in URLs or reports before the claim; the workspace file already warns it holds keys; playground chains only | Preventive | Partial |

## R48 · locksFor scans Locked logs from the deploy block
- impact: 2
- likelihood: 3
- target: 2x2
- appetite: 4
- category: Performance
- driver: Claude
- approver: Aaron

Finding locks reads every `Locked` log since the HashLock's deploy block, so each page load grows with the number of locks on the chain. (ADR-0021)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Filtered by indexed sender/recipient and hash; card t-93 for an index or bounded window | Corrective | Partial |

## R49 · Blocks are only a proxy for time across chains
- impact: 3
- likelihood: 3
- target: 2x2
- appetite: 4
- category: Quality
- driver: Claude
- approver: Aaron

Two chains share no clock, so the safety margin (10 blocks) and the report's `unsafe` verdict compare block counts, not time; a chain advanced unevenly can misflag or miss an unsafe swap. (ADR-0021)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Warning with explicit Lock anyway; report passes A's head at the answer when known and says it is a proxy | Detective | Partial |

## R50 · Older HashLocks on chain A are not searched after a redeploy
- impact: 2
- likelihood: 2
- target: 2x2
- appetite: 4
- category: Quality
- driver: Claude
- approver: Aaron

The page reads only the newest HashLock on chain A, so an opening lock on an earlier HashLock is not found after a redeploy and its funds can only be refunded by a direct call. (ADR-0021)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Documented limit; the contract itself still allows refund; card t-94 | Corrective | Partial |

## R51 · The chain-store diff compares the whole state every block
- impact: 2
- likelihood: 3
- target: 2x2
- appetite: 4
- category: Quality
- driver: Claude
- approver: Aaron

`diffState` compares the full state dump before and after each block, so per-block CPU and memory are O(state), not O(touched keys). The 10,000-block soak's state is small (a few hundred rows), so it stays flat; a chain with a few MB of state would slow every block. (ADR-0022)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| `ponytail:` marker in `diffState`; switch to a touched-keys diff when state grows past a few MB | Corrective | Partial |
| `make soak-node` fails if commit time grows more than 2x or memory reaches 128 MB; commit-time flatness covers the SQL write only, the diff compute is the O(state) part this risk tracks | Detective | Partial |

## R52 · Deploy codes can be guessed
- impact: 3
- likelihood: 2
- target: 2x2
- appetite: 4
- category: Security
- driver: Claude
- approver: Aaron

A code the admin types (e.g. `my-first-friend`) can be guessed within its TTL, and a guessed code lets a stranger create a chain on the worker (cost and storage on Aaron's account). The per-IP limit slows guessing but IPs can be rotated. (ADR-0023)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Generated 4-word codes by default; short TTL and single use by default | Preventive | Partial |
| 10 failed redeems per IP per 10 minutes then `429`; redeems are recorded on the root chain | Detective | Partial |

## R53 · A deploy code is spent when chain creation fails after the redeem
- impact: 2
- likelihood: 2
- target: 2x2
- appetite: 4
- category: Quality
- driver: Claude
- approver: Aaron

The worker redeems the code on the root chain before the new chain's Durable Object is created. If the creation then fails, the code is already used and the friend must ask for another. (ADR-0023)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Stateless set-up checks run before the redeem, so a malformed upload never spends a code; the admin can issue another | Preventive | Partial |
| Upload capped at 8 MiB (`413` before auth; evm.fun refuses a larger chain before using a code), so a big chain can't exhaust the DO or the RPC hop after the redeem | Preventive | Partial |
| A failed create after the redeem is recorded (`codes` shows `failed: <error>`), so the admin sees why the use is gone; evm.fun says the code may have been used | Detective | Partial |

## R54 · The root admin key sits on Aaron's machine
- impact: 4
- likelihood: 2
- target: 2x2
- appetite: 4
- category: Security
- driver: Claude
- approver: Aaron

`.env.live` holds `ROOT_ADMIN_KEY` in plain text and evm.fun keeps the imported key in the browser's storage. Anyone with either can issue deploy codes and act as the root admin. The imported key lives in `localStorage` on the evm.fun origin, which until the move to mychain.dev is `aaronp.github.io`, shared with every other GitHub Pages site under that account. Recovery: redeploying with a new `ROOT_ADMIN` does not help (the root chain's on-chain admin is unchanged and a second root create is refused with `409`); a leaked key is replaced by `setAdmin(<new address>)` sent from the old key, then `make deploy` with the new key in `.env.live` (the worker's `ROOT_ADMIN` gates `codes`), and a lost key only by wiping the root Durable Object (losing every issued code and its record) and redeploying. (ADR-0023)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| `.env.*` git-ignored (mode 600 when generated); only the address goes to the worker; `deploy.ts` keeps the key out of wrangler's environment | Preventive | Partial |

## R55 · A reader can take a multi-use writer code from the chain
- impact: 3
- likelihood: 2
- target: 1x2
- appetite: 4
- category: Security
- driver: Claude
- approver: Aaron

A join's claim tx carries the plaintext code into a block, and every member can read blocks (`GET /blocks`). While a writer code has uses left, any reader who sees an earlier claim can redeem it and become a writer. (plan 17)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Invites are single use by default | Preventive | Partial |
| The admin can cancel an unused code (`revokeInvite`) and remove a writer | Corrective | Partial |
| evm.fun defaults an invite to reader with one use, and warns on a writer code with more than one use (plan 18) | Preventive | Partial |

## R56 · A signed tx can be replayed on another chain
- impact: 3
- likelihood: 2
- target: 1x2
- appetite: 4
- category: Security
- driver: Claude
- approver: Aaron

Every chain uses chainId 31337, so a tx an admin signs on one chain is valid on any other chain where the same key has the same nonce and the target contract sits at the same address (e.g. two chains the same key deployed with the same set-up nonces). Someone who can read one chain could submit the admin's tx to the other. (plan 17)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| Submitting needs the signer to be a writer on the target chain, and both chains' state must line up (nonce and contract address) | Preventive | Partial |
| A per-chain chainId (later) makes the signatures chain-specific | Preventive | Full |

## R57 · Device polling and state downloads cost more than expected
- impact: 2
- likelihood: 3
- target: 2x2
- appetite: 4
- category: Performance
- driver: Claude
- approver: Aaron

Each signed `GET /blocks` poll writes a request nonce and runs EVM `canRead` (plus a membership check) in the chain's Durable Object, so many devices polling often add up. `GET /state` returns the whole state with no size cap. (plan 17)

### Controls
| Control | Type | Effectiveness |
|---|---|---|
| evm.fun followers poll every 5, 15 (default) or 60 s, or only on Sync now (Manual); polling pauses while the tab is hidden and backs off after failures (plan 18) | Preventive | Partial |
| Cursor writes at most once a minute when idle; pages capped at 100 blocks | Preventive | Partial |
| Cap or stream `state` (later) | Preventive | Partial |
