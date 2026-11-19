# evm-benchmarks — design

Date: 2026-11-19 · Status: draft for approval

## Intent

Explore architectures for settling **Solidity-compatible transactions at 1,000+ TPS** (tuned for ERC-20s). Each architecture is built as its own runnable, documented **approach**. One shared benchmark measures them all with the same signed transactions. The result shows what each approach gives up (state roots, durability, inline signature checks, single-threaded execution…) for the throughput and latency it gains.

There are two end products:
1. **A comparison report**: approaches 1..N × scenarios. Throughput, latency, and each approach's trade-offs side by side.
2. **A zero-install browser playground**. Compile Solidity with solc-js, deploy and call it, and run the benchmark scenarios against the browser-capable approaches.

## Goals

- The benchmark's only input is **N pre-signed raw Ethereum transactions** (standard RLP-encoded, signed hex). Nothing in that input assumes a particular engine. Any Ethereum-compatible implementation can be an approach, including an external node (Besu, anvil) over JSON-RPC.
- Every approach is a self-contained package. It has a README explaining the idea, what it sacrifices, and how to run it, plus a machine-readable trade-off declaration that the report turns into columns.
- Adding an approach means adding one package. The core, CLI and report don't change.
- Results are repeatable and machine-readable (JSON). The report is generated from them.

## Non-goals

- Consensus, multiple nodes, networking between nodes, a P2P mempool.
- Full JSON-RPC node compatibility.
- Production hardening, auth, multi-tenancy.
- Besu tuning in this round. The JSON-RPC approach leaves that door open.

## Anti-goals (it fails even if the number is high)

- **Not Solidity-compatible.** An approach that bypasses the EVM (e.g. a native ERC-20 fast path) may exist only if its trade-offs say `evm: false`. It never becomes the headline number.
- **Unverified throughput.** Every run checks final state (balances, receipt statuses). A run that fails this check reports no TPS.
- **Hidden trade-offs.** Each number is shown next to the approach's declared trade-offs. A fast number without its sacrifices is misleading.
- **Engine-specific inputs.** Approaches receive signed transactions (plus setup), nothing else.

## Constraints

- TypeScript on Bun. Core code and browser-capable approaches must bundle for the browser. Node-only APIs stay in CLI-only packages.
- The EVM is webevm (`webevm` on npm, built on @ethereumjs/vm), with its `webevm/revm` (revm-wasm) engine. Pin the version. It's young and single-maintainer.
- Solidity is compiled with solc-js. Benchmark contracts are precompiled at build time with the same compiler.
- Starting material: `chain-as-a-service/cntrcts/src/src/{Token.sol, AtomicSwap.sol}` and the React/Tailwind UI patterns in `chain-as-a-service/app`. Copy what's useful. Don't depend on it. The existing starter projects stay untouched.

## Approaches considered (for the project as a whole)

| | Approach | Trade-off |
|---|---|---|
| A | Generic harness + tuned Besu and our own sequencer | Real-chain numbers plus a browser story, most up-front work |
| B | Besu only | Quickest realistic number. No browser version, and the sequencer can't be tested |
| **C (chosen)** | **Our own sequencer + EVM in TS/Bun, runs in the browser, harness open to any engine** | Best numbers, fully in our control, browser-native. "Real chain" numbers come later via the JSON-RPC approach |

The user then reframed the open design questions (state roots, durability, parallel execution, success threshold) as **approaches to compare, not decisions to make up front**.

## Structure

```
evm-benchmarks/
  packages/
    core/        Approach interface, trade-off schema, scenarios, generators, verifiers, metrics (browser-safe)
    contracts/   MintableToken.sol, AtomicSwap.sol (+ OpenZeppelin), compiled artifacts
    cli/         `bench` and `report` commands (Bun)
    web/         playground: Studio + Benchmark (static site)
  approaches/
    01-webevm-baseline/   …each: README.md, index.ts (factory + meta), optional own tests
    02-seq-memory/
    …
  results/       run JSON
  REPORT.md      generated + hand-written iteration notes
```
One Bun workspace.

### Approach contract

```ts
interface ApproachMeta {
  id: string                 // "02-seq-memory"
  title: string
  runsIn: ('bun' | 'browser')[]
  tradeoffs: {
    evm: boolean             // runs real EVM bytecode
    stateRoot: 'per-block' | 'deferred' | 'none'
    log: 'none' | 'memory' | 'file' | 'indexeddb'
    sigVerify: 'inline' | 'parallel-pre' | 'trusted'
    execution: 'serial' | 'parallel'
    notes?: string
  }
}

interface Approach {
  meta: ApproachMeta
  setup(opts): Promise<void>                    // fresh chain; prefund accounts
  submit(rawTxs: Hex[]): Promise<void>          // accept a batch; may return before execution
  awaitSettled(count: number): Promise<Settled> // when `count` txs have receipts
  call(req: {to: Hex, data: Hex}): Promise<Hex> // eth_call, for verification
  dispose(): Promise<void>
}
```
The fields of `tradeoffs` may grow as new approaches need them, with the report showing whatever fields exist.

### Measurement

- **Settled** = executed in a block, with a receipt.
- **TPS** = N / (time of last settled − time of first submit). Signing is untimed and reported separately.
- **Latency** p50/p99 per tx (submit → settled).
- Approaches may report a phase breakdown (e.g. verify / sequence / execute / root).
- Each result records approach id, trade-offs, scenario, params, machine info, engine version, and verified pass/fail.
- 1,000 TPS is drawn as a target line in the report, not a pass/fail gate.

### Scenarios (in core, shared by all approaches)

Each scenario = setup (deploy + fund, untimed) + generator of N signed txs + verifier.

1. **`eth-transfer`**: plain value transfers, as the floor without contract cost.
2. **`erc20-disjoint`**: transfers between distinct pairs, no hot accounts.
3. **`erc20-hot`**: many senders → few receivers (contention; this is where parallel approaches differ).
4. **`erc20-mint`**: owner mints to many addresses (one sender, sequential nonces).
5. **`atomic-swap`**: AtomicSwap.sol delivery-versus-payment between two tokens.

Params: `--n` (default 10,000), `--senders`, `--batch`, plus approach-specific options passed through.

### Initial approaches (ordered; later ones built as iterations)

| # | Approach | Idea | Main sacrifice |
|---|---|---|---|
| 01 | `webevm-baseline` | Plain webevm, `eth_sendRawTransaction`, auto-mine one tx per block | none, just slow. This is the reference |
| 02 | `seq-memory` | Parallel signature pre-verify (workers) → single-writer sequencer + ring buffer → one executor loop, blocks of B txs, signature checks trusted, no state root, in-memory log | durability, state root |
| 03 | `seq-stateroot` | 02 + state root computed per block (or deferred every K blocks) | throughput, for verifiable state |
| 04 | `seq-durable` | 02 + append-only event log to file (Bun) / IndexedDB (browser), replayable | throughput, for crash recovery |
| 05 | `seq-revm` | 02 with the revm-wasm engine | bundle size (+~1.2 MB) |
| 06 | `rpc` | Any JSON-RPC node (anvil, Besu): send raw txs, poll receipts | depends on the node. CLI only |
| later | `parallel-*` | Execution split by account or run in parallel with conflicts redone | complexity |
| later | `native-erc20` | Non-EVM ERC-20 fast path, as a comparison of what the EVM costs | not Solidity (`evm: false`) |

Each approach README states: idea, data flow, trade-offs, how to run, and observed results/lessons.

### Report

`bun run report` collects `results/*.json` into `REPORT.md`. It has one table per scenario, with rows for approaches and columns for TPS, p50/p99, verified, and each trade-off field. The 1k TPS target is marked. Machine info and a hand-written iteration log are included.

### Browser playground (`packages/web`)

Static page, Bun-built, React + Tailwind (reusing chain-as-a-service UI patterns):
- **Studio**: Solidity editor, solc-js compile in a Web Worker, deploy to an in-browser chain, read/write calls (ERC-20 card for ERC-20s).
- **Benchmark**: pick a browser-capable approach, a scenario and N. Shows signing progress (untimed), then TPS, latency and phases. Can run several approaches back to back for an in-browser comparison.
- Deploys as a static site (e.g. GitHub Pages), no backend.

## Decided by the user

- Approach C, TypeScript/Bun, not tied to Besu but Besu must stay benchmarkable.
- The abstraction is N signed transactions, with no engine assumptions.
- Sequencer / event-log / hot-thread architecture is the main direction. Signature verification may be separated out.
- Architectural choices (state roots, durability, parallelism, sig checks) are separate approaches, each documented and compared by what it gives up.
- A new `evm-benchmarks` project holds the benchmark framework, the browser UI and the approach packages.
- Deliverables: comparison report + zero-install browser playground.

## Calls made by Claude (correct if wrong)

- Settlement = executed with a receipt. Finality/consensus isn't modelled.
- Signing is untimed and excluded from TPS. Every run is verified, and an unverified run reports no TPS.
- Default N = 10,000.
- `MintableToken.sol` (OpenZeppelin ERC20 + Ownable `mint`) is used by all ERC-20 scenarios, because Token.sol has no public mint.
- webevm is used as published, with the version pinned. If a needed feature (`senderMode: 'trusted'`, manual mining, `webevm/revm`) is missing or slow, approaches drop to `@ethereumjs/vm` / `revm-wasm` directly. Forking is the last resort. The first build task is a spike that confirms these features.
- Initial approach list and order (01–06) as above. `parallel-*` and `native-erc20` come later.
- The project lives at `chain-perf/evm-benchmarks/`. The git repo is `chain-perf/` itself, so code and the project docs (`docs/board`, `docs/risks`, `docs/adr`) change in the same commit. The three cloned starter projects and `node_modules` are git-ignored.

## Project tracking

- **Board** `docs/board/board.md`: one task per plan task. Move to Doing when started and Done when verified.
- **Risks** `docs/risks/risks.md`: update when a spike or result changes a risk's likelihood or impact, and add new risks as found.
- **Decisions** `docs/adr/decisions.md`: proposed records (engine choice, state root) are closed with measured results. Any new key choice gets a record.

## Left to the builder

Ring buffer details, worker-count defaults, log file format, JSON result schema details, UI styling, editor component, revm wiring, block size defaults.
