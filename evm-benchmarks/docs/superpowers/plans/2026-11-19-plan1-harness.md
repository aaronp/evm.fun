# evm-benchmarks Plan 1: Harness, approaches 01–02, report

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working end-to-end benchmark. Five scenarios generate N signed raw transactions and run against approach 01 (plain webevm) and approach 02 (parallel-verify sequencer). Every run is verified, results are written as JSON, and a REPORT.md is generated from them.

**Architecture:** A Bun workspace. `packages/core` is engine-neutral: the Approach interface, scenarios (which sign raw transactions with viem), the runner and metrics. `packages/contracts` compiles Solidity with solc-js. Each `approaches/NN-name` package default-exports an Approach factory. `packages/cli` finds approaches by scanning `approaches/` and runs `bench` / `report`.

**Tech Stack:** Bun 1.3.x, TypeScript, viem (signing, ABI encoding), webevm 0.9.1 (EVM), solc 0.8.38 (solc-js), @openzeppelin/contracts 5.6.1.

**Spec:** `evm-benchmarks/docs/superpowers/specs/2026-11-19-evm-benchmarks-design.md`

**Later plans:** Plan 2 covers approaches 03 (state root), 04 (durable log), 05 (revm) and 06 (rpc). Plan 3 covers the browser playground. Both build on the interfaces fixed here.

## Global Constraints

- The benchmark input is N pre-signed raw Ethereum transactions. Approaches receive only signed transactions plus a prefund map. No engine-specific inputs.
- Signing is untimed and reported separately. TPS = N / (last settledAt − first submit time).
- Every run verifies final state. A run whose verification fails, or has any non-`success` timed receipt, has `tps: null`.
- Default N = 10,000. chainId = 31337. Transactions are EIP-1559 with fixed gas limits (no estimateGas): eth transfer 21_000, ERC-20 transfer/mint 100_000, approve 60_000, swap 200_000, deploy 3_000_000. maxFeePerGas 2 gwei, maxPriorityFeePerGas 1 gwei. Prefund 10^24 wei per account.
- Pin exact versions: `webevm@0.9.1`, `solc@0.8.38`, `@openzeppelin/contracts@5.6.1`. viem `^2.58.1`.
- Core and approach code must be browser-safe: no `fs`/`path`/`node:*` imports outside `packages/cli` and `packages/contracts/build.ts`. Workers are created with `new Worker(new URL('./x.ts', import.meta.url), {type: 'module'})`.
- Every approach declares `meta.tradeoffs` (`evm`, `stateRoot`, `log`, `sigVerify`, `execution`, optional `notes`), and has a README with: idea, data flow, trade-offs, how to run, results/lessons.
- Project docs live at the repo root: `docs/board/board.md` (strict format: see `node_modules/@pritzlaff/agile/spec.md`), `docs/risks/risks.md`, `docs/adr/decisions.md`. Each task moves its board card to Doing at its start and Done at its commit, adding a history line `  - <Column> @ <UTC ISO>Z by Claude` and setting `owner: Claude`. After editing any of the three, run `bunx agile card docs/board/board.md $TMPDIR/c && bunx adr card docs/adr/decisions.md $TMPDIR/c && bunx risk-register card docs/risks/risks.md $TMPDIR/c` from the repo root. Each must print `Wrote …`.
- The git repo is `chain-perf/` (the repo root). `besu-example/`, `chain-as-a-service/`, `nanochain/`, `node_modules/` and `evm-benchmarks/results/` are git-ignored.

## Review Focus

1. **One sender's transactions split across several `submit` calls or verify-worker chunks.** They must execute in submit order, so nonces never fail. Test in Task 7 (`preserves submit order across chunks`).
2. **A transaction that reverts, e.g. a transfer over balance.** It must come back `reverted`, the run gets `verified: false` and `tps: null`, and nothing crashes. Test in Task 5 (`reverted tx yields null tps`).
3. **A malformed or badly signed raw transaction.** It must come back `rejected` from both approaches, without throwing out of `submit` or hanging `awaitSettled`. Tests in Task 3 and Task 7.
4. **N not divisible by batch size, batch > N, and N = 1.** Every transaction must settle and be counted once. Test in Task 5 (`odd batch sizes`).
5. **Dispose then setup again in one process** (the CLI runs several runs back to back). There must be no leaked Workers or stale state, and the CLI process must exit. Test in Task 7 (`dispose then reuse`).

---

### Task 1: Repo, workspace, and webevm spike

Board: t-02, t-01.

**Files:**
- Create: `.gitignore` (repo root), `evm-benchmarks/package.json`, `evm-benchmarks/tsconfig.json`, `evm-benchmarks/README.md`
- Create: `evm-benchmarks/spike/webevm.test.ts`
- Modify: `docs/board/board.md`, `docs/adr/decisions.md`, `docs/risks/risks.md`

**Interfaces:**
- Produces: workspace with `workspaces: ["packages/*", "approaches/*"]`, root scripts `test` (`bun test`), `bench` (`bun packages/cli/src/main.ts bench`), `report` (`bun packages/cli/src/main.ts report`). Facts about webevm recorded in the ADR "Which EVM engine backs the sequencer".

- [ ] **Step 1:** `git init` at `chain-perf/`, write `.gitignore` per Global Constraints, create the workspace `package.json` and `tsconfig.json` (strict, `moduleResolution: bundler`, `types: ["bun"]`), and `bun add webevm@0.9.1 viem` in `evm-benchmarks`.
- [ ] **Step 2: Write the spike tests** in `spike/webevm.test.ts`. Each one signs EIP-1559 transfers with viem `privateKeyToAccount(...).signTransaction`:
  - `trusted sender executes via evm_sendRawTransactionAs`: a node with `senderMode: 'trusted'` and `initialBalances` funding the sender. `evm_sendRawTransactionSyncAs [raw, from]` returns a receipt with `status === '0x1'`.
  - `manual mining queues until mine()`: with `miningConfig: {type: 'manual'}`, send 3 transfers via `evm_sendRawTransactionAs`. `eth_getTransactionReceipt` is null before `await node.mine()` and `0x1` for all three after it. Record whether the 3 landed in one block.
  - `blockGasLimit allows 1000 transfers per block`: `blockGasLimit: 30_000_000n * 10n`, 1000 queued then one `mine()`. All receipts are `0x1`.
  - `revm engine loads in Bun`: `createNode({createEngine: () => createRevmEngine({wasm: <bytes read from require.resolve('revm-wasm/revm.wasm')>})})` (or the documented option name) runs one transfer. If it can't load in Bun, the test is `test.todo` with the error recorded.
  - `throughput probe`: 2000 transfers, timed for `recover`+auto vs `trusted`+manual(block 500). Log tx/s for each.
- [ ] **Step 3:** Run `bun test spike`. Expected: PASS (revm may be todo). Paste the logged tx/s into the spike file header comment.
- [ ] **Step 4:** Update the ADR "Which EVM engine backs the sequencer": add a `## Notes` section with the spike findings (features confirmed, measured tx/s). Set risk R01 likelihood from the outcome (1 if all features worked). Board: t-01 and t-02 → Done. Run the card check.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "chore: evm-benchmarks workspace and webevm spike"`

### Task 2: Contracts package

Board: t-03.

**Files:**
- Create: `evm-benchmarks/packages/contracts/{package.json, build.ts, index.ts}`, `src/MintableToken.sol`, `src/AtomicSwap.sol`, `artifacts/*.json` (generated, committed), `contracts.test.ts`

**Interfaces:**
- Produces: `import {MintableToken, AtomicSwap} from '@evmb/contracts'`, each `{abi: Abi, bytecode: Hex}` (viem types). MintableToken constructor `(string name, string symbol)`, owner = deployer (OZ `Ownable(msg.sender)`), `mint(address to, uint256 amount) onlyOwner`, plus OZ ERC20. AtomicSwap is copied verbatim from `chain-as-a-service/cntrcts/src/src/AtomicSwap.sol`.

- [ ] **Step 1: Write the failing test** `contracts.test.ts`:
  - `MintableToken abi has mint, transfer, approve, balanceOf` (filter abi by `type === 'function'` names).
  - `AtomicSwap abi has swap`.
  - `bytecode is non-empty hex` for both (`/^0x[0-9a-f]{100,}$/`).
- [ ] **Step 2:** Run `bun test packages/contracts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `build.ts`. It runs solc-js standard JSON with `optimizer: {enabled: true, runs: 200}`, `evmVersion: 'cancun'`, and an import callback resolving `@openzeppelin/` from `node_modules`. It writes `artifacts/<Name>.json` `{abi, bytecode}` and throws on any error-severity output. Script `build` runs `bun build.ts`. `index.ts` re-exports the JSON.
- [ ] **Step 4:** Run `bun run --cwd packages/contracts build && bun test packages/contracts`. Expected: PASS.
- [ ] **Step 5:** Board t-03 → Done. Commit `feat(contracts): MintableToken and AtomicSwap via solc-js`.

### Task 3: Core types and approach 01 (webevm-baseline)

Board: t-04 (types part), t-07.

**Files:**
- Create: `packages/core/{package.json, src/types.ts, src/index.ts}`
- Create: `approaches/01-webevm-baseline/{package.json, index.ts, README.md, approach.test.ts}`

**Interfaces:**
- Produces (in `@evmb/core` `types.ts`):
```ts
type Hex = `0x${string}`; type Address = Hex
interface Tradeoffs { evm: boolean; stateRoot: 'per-block'|'deferred'|'none'; log: 'none'|'memory'|'file'|'indexeddb'; sigVerify: 'inline'|'parallel-pre'|'trusted'; execution: 'serial'|'parallel'; notes?: string }
interface ApproachMeta { id: string; title: string; runsIn: ('bun'|'browser')[]; tradeoffs: Tradeoffs }
interface Receipt { hash: Hex; status: 'success'|'reverted'|'rejected'; settledAt: number /* performance.now() */; contractAddress?: Address; error?: string }
interface Approach {
  meta: ApproachMeta
  setup(opts: {prefund: Record<Address, bigint>}): Promise<void>   // fresh chain each call
  submit(rawTxs: Hex[]): Promise<void>
  awaitSettled(hashes: Hex[]): Promise<Receipt[]>                   // same order as hashes
  call(req: {to: Address; data: Hex}): Promise<Hex>
  getBalance(addr: Address): Promise<bigint>
  phases?(): Record<string, number>                                  // ms per phase since setup
  dispose(): Promise<void>
}
type ApproachFactory = (opts?: Record<string, string>) => Approach
```
  Transaction hash = `keccak256(raw)` (viem), computed by callers. Approaches must use the same hash.
- Produces: `approaches/01-webevm-baseline/index.ts` `export default (opts) => Approach` with `meta = {id: '01-webevm-baseline', runsIn: ['bun','browser'], tradeoffs: {evm: true, stateRoot: 'none', log: 'memory', sigVerify: 'inline', execution: 'serial', notes: 'one tx per block'}}`.

- [ ] **Step 1: Write the failing test** `approach.test.ts`:
  - `settles a signed transfer`: setup prefunds A. Submit one A→B 1 wei transfer. `awaitSettled([hash])` gives `[{status: 'success'}]`, and `getBalance(B) === 1n`.
  - `garbage raw tx is rejected`: `submit(['0x1234'])`, then `awaitSettled([keccak256('0x1234')])` gives `status: 'rejected'` with an `error` string.
  - `setup resets state`: after a second `setup`, `getBalance(B) === 0n`.
- [ ] **Step 2:** Run `bun test approaches/01-webevm-baseline`. Expected: FAIL.
- [ ] **Step 3:** Implement. `setup` disposes any previous node and calls `createNode({chainId: 31337, miningConfig: {type: 'auto'}, initialBalances})`. `submit` loops `eth_sendRawTransactionSync` serially, storing a Receipt per hash. An RpcError becomes `rejected`. `awaitSettled` resolves when every hash has a receipt (a map plus waiting promises).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Write the README (idea, data flow, trade-offs, how to run `bun run bench --approach 01-webevm-baseline`, results section left as "see REPORT.md"). Board t-07 → Done. Commit `feat: core types and approach 01 webevm-baseline`.

### Task 4: Scenarios

Board: t-05.

**Files:**
- Create: `packages/core/src/{accounts.ts, tx.ts, scenarios/index.ts, scenarios/eth-transfer.ts, scenarios/erc20.ts, scenarios/atomic-swap.ts}`, `packages/core/test/scenarios.test.ts`

**Interfaces:**
- Consumes: `Approach`, `Receipt` (Task 3). `MintableToken`, `AtomicSwap` (Task 2).
- Produces:
```ts
deriveAccounts(seed: string, count: number): PrivateKeyAccount[]   // pk_i = keccak256(toHex(`${seed}:${i}`))
signTx(acct, nonce: number, tx: {to?: Address; data?: Hex; value?: bigint; gas: bigint}): Promise<Hex>  // chainId/fees from Global Constraints
interface ScenarioParams { n: number; senders: number; seed: string }
interface Scenario {
  id: 'eth-transfer'|'erc20-disjoint'|'erc20-hot'|'erc20-mint'|'atomic-swap'
  prefund(p: ScenarioParams): Record<Address, bigint>
  setup(approach: Approach, p: ScenarioParams): Promise<void>        // untimed; deploys/mints/approves via signed txs; throws if any receipt !== success
  generate(p: ScenarioParams): Promise<Hex[]>                        // the N timed txs
  verify(approach: Approach, p: ScenarioParams): Promise<{ok: boolean; detail: string}>
}
scenarios: Record<Scenario['id'], () => Scenario>   // factory: fresh instance per run
```
  A Scenario instance is stateful across setup → generate → verify for one run. It keeps its own nonce counters and deployed addresses (`getContractAddress({from, nonce})`).
- Behaviour per scenario (default `senders` = 100):
  - `eth-transfer`: tx i is sender `i % S` → receiver `deriveAccounts(seed+':rx', n)[i]`, value 1. Verify: each receiver balance is 1.
  - `erc20-disjoint`: setup deploys MintableToken and mints `n` to each sender. Tx i transfers 1 from sender `i % S` to unique receiver i. Verify: each receiver `balanceOf` is 1, and `totalSupply === S*n`.
  - `erc20-hot`: like disjoint but receiver = one of 4 fixed receivers (`i % 4`). Verify: receiver balances sum to n, each is `ceil/floor(n/4)`.
  - `erc20-mint`: deployer mints 1 to unique receiver i, one sender with sequential nonces. Verify: each receiver is 1, and `totalSupply === n`.
  - `atomic-swap`: setup deploys TokenA, TokenB and AtomicSwap. A-party j gets n A, and B-party j gets n B (S pairs). Each party approves AtomicSwap for max. Tx i: A-party `i % S` calls `swap(tokenA, 1, bParty, tokenB, 1)`. Verify: the A balances of all B-parties sum to n, and the B balances of all A-parties sum to n.

- [ ] **Step 1: Write the failing test** `scenarios.test.ts`. For each of the 5 ids, with approach 01 and `{n: 40, senders: 8, seed: 'test'}`: `prefund → approach.setup → setup → generate → submit → awaitSettled` gives all `success`, and `verify().ok === true`. Plus:
  - `verify fails when txs not submitted` (erc20-disjoint: skip submit, `ok === false`).
  - `deriveAccounts is deterministic` (same seed gives the same addresses).
- [ ] **Step 2:** Run `bun test packages/core`. Expected: FAIL.
- [ ] **Step 3:** Implement per the Interfaces above.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Board t-05 → Done. Commit `feat(core): five benchmark scenarios`.

### Task 5: Runner and metrics

Board: t-04.

**Files:**
- Create: `packages/core/src/{runner.ts, metrics.ts}`, `packages/core/test/runner.test.ts`

**Interfaces:**
- Produces:
```ts
interface RunOptions { approach: Approach; scenario: Scenario; n: number; senders: number; batch: number /* default 1000 */; seed: string }
interface RunResult {
  approach: ApproachMeta; scenario: string; params: {n: number; senders: number; batch: number; seed: string}
  signingMs: number; durationMs: number; tps: number | null
  latencyMs: {p50: number; p99: number; max: number}
  statuses: Record<Receipt['status'], number>
  verified: boolean; verifyDetail: string; phases?: Record<string, number>
  env: {runtime: string; os: string; cpu: string; cores: number; webevm: string; startedAt: string}
}
runBenchmark(o: RunOptions): Promise<RunResult>
percentile(sortedMs: number[], p: number): number   // nearest-rank
```
  Flow: `approach.setup({prefund: scenario.prefund(params)})`, `scenario.setup`, then time `generate` (= signingMs). Then `t0 = performance.now()`, submit in chunks of `batch` while recording each tx's submit time, `awaitSettled(all hashes)`, `durationMs = max(settledAt) − t0`, latency = settledAt − submit time per tx, then `verify`. `tps = verified && statuses.success === n ? n / (durationMs/1000) : null`. `env` is filled from `navigator`/`process` when present (browser-safe guards).

- [ ] **Step 1: Write the failing test** `runner.test.ts` (approach 01, eth-transfer unless stated):
  - `happy path`: n=50. `verified`, `tps > 0`, `statuses.success === 50`, `p50 <= p99 <= max`.
  - `odd batch sizes`: for `[n, batch]` of `[1,1000]`, `[7,3]`, `[50,50]`, `statuses.success === n` and `verified`.
  - `reverted tx yields null tps`: wrap erc20-disjoint so `generate` appends one transfer of `10n**30n` from a sender. Then `statuses.reverted === 1`, `tps === null`, and no throw.
  - `percentile nearest-rank`: `percentile([1,2,3,4], 50) === 2`, `percentile([1,2,3,4], 99) === 4`.
- [ ] **Step 2:** Run `bun test packages/core/test/runner.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run `bun test packages/core`. Expected: PASS.
- [ ] **Step 5:** Board t-04 → Done. Commit `feat(core): benchmark runner and metrics`.

### Task 6: CLI `bench`

Board: t-06.

**Files:**
- Create: `packages/cli/{package.json, src/main.ts, src/approaches.ts, src/bench.ts}`, `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `runBenchmark`, `scenarios` (Tasks 4–5).
- Produces:
  - `loadApproaches(): Promise<Record<string, ApproachFactory>>` scans `evm-benchmarks/approaches/*/index.ts` and dynamically imports their defaults, keyed by `meta.id`. Adding an approach needs no CLI change.
  - `bun run bench --approach <id|all> --scenario <id|all> [--n 10000] [--senders 100] [--batch 1000] [--runs 3] [--warmup 1] [--seed <random>] [--opt key=value ...]`. Each timed run writes `evm-benchmarks/results/<ISO-ts>-<approach>-<scenario>-r<k>.json` (a RunResult). Warm-up runs are executed but not written. A console table shows approach, scenario, median TPS, p50 and p99, verified. `--opt` pairs go to the approach factory. The approach is disposed after each run. The process exits 0 even if a run fails verification (that's a result), and non-zero only on a crash.

- [ ] **Step 1: Write the failing test** `cli.test.ts`: spawn `bun packages/cli/src/main.ts bench --approach 01-webevm-baseline --scenario eth-transfer --n 20 --runs 1 --warmup 0` with `RESULTS_DIR` set to a temp dir. Exit code 0, exactly one JSON file whose `verified === true`, and the process ends within 30s.
- [ ] **Step 2:** Run `bun test packages/cli`. Expected: FAIL.
- [ ] **Step 3:** Implement with `util.parseArgs`. `RESULTS_DIR` env overrides the results path.
- [ ] **Step 4:** Run the test. Expected: PASS. Then run `bun run bench --approach 01-webevm-baseline --scenario all --n 2000 --runs 1` by hand and confirm all 5 rows say verified.
- [ ] **Step 5:** Board t-06 → Done. Commit `feat(cli): bench command`.

### Task 7: Approach 02 (seq-memory)

Board: t-08.

**Files:**
- Create: `approaches/02-seq-memory/{package.json, index.ts, ring.ts, sequencer.ts, verifyWorker.ts, README.md, approach.test.ts, ring.test.ts}`

**Interfaces:**
- Consumes: `Approach`, `Receipt`, `Hex` (Task 3). webevm `senderMode: 'trusted'`, `miningConfig: {type: 'manual'}`, `blockGasLimit`, `evm_sendRawTransactionAs`, `node.mine()` (confirmed in Task 1. If the spike found a gap, use its documented fallback and note it in the README).
- Produces:
  - `RingBuffer<T>(capacity: number)`: `tryPush(x): boolean`, `drain(max: number): T[]`, `size`. Fixed-size array with head/tail indices, no reallocation.
  - Approach factory options (string → parsed): `workers` (default `navigator.hardwareConcurrency - 1`, min 1), `block` (txs per block, default 500), `chunk` (txs per verify message, default 250).
  - `meta = {id: '02-seq-memory', runsIn: ['bun','browser'], tradeoffs: {evm: true, stateRoot: 'none', log: 'memory', sigVerify: 'parallel-pre', execution: 'serial'}}`.
  - `phases()` returns `{verifyMs, sequenceMs, executeMs, mineMs}` (summed wall time inside each stage).
- Data flow:
  1. `submit(raw[])` splits into chunks. Each chunk gets an increasing `seq` and is posted round-robin to the verify workers.
  2. A worker replies `{seq, items: {raw, hash, from | null, error?}[]}` (viem `parseTransaction` + `recoverTransactionAddress`).
  3. The sequencer holds a reorder map and releases chunks strictly in `seq` order into the RingBuffer (log = in-memory array of `{seq, raw, from}`). `from === null` gives a `rejected` receipt immediately.
  4. The executor loop drains up to `block` items, sends each with `evm_sendRawTransactionAs [raw, from]`, calls `node.mine()`, then reads each receipt (`eth_getTransactionReceipt`) and stamps `settledAt` after the mine. When the ring is empty it waits on a promise signalled by the sequencer, without spinning.

- [ ] **Step 1: Write the failing tests.**
  - `ring.test.ts`: push to capacity and `tryPush` returns false. `drain(3)` returns FIFO order. Wrap-around after interleaved push/drain keeps order.
  - `approach.test.ts` (options `{workers: '2', block: '10', chunk: '4'}`):
    - `runs all five scenarios verified`: n=60 senders=6 via `runBenchmark`. Each `verified`.
    - `preserves submit order across chunks`: one sender, 30 sequential-nonce transfers submitted as three `submit` calls of 10. All `success`.
    - `garbage raw tx is rejected`: as in Task 3, plus a valid tx in the same submit still succeeds.
    - `dispose then reuse`: run eth-transfer, `dispose()`, `setup` again, run again. Both verified. After the final `dispose()` no workers remain (track `Worker` instances, each has been `terminate()`d).
- [ ] **Step 2:** Run `bun test approaches/02-seq-memory`. Expected: FAIL.
- [ ] **Step 3:** Implement `ring.ts`, `verifyWorker.ts`, `sequencer.ts` and `index.ts` per the data flow.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then `bun run bench --approach all --scenario all --n 10000 --runs 3` and confirm everything is verified and 02 beats 01 on every scenario. If it doesn't, record it as a finding, not a failure.
- [ ] **Step 5:** README (idea, data-flow diagram in text, trade-offs, options, results/lessons from step 4). Board t-08 → Done. Update R02 (single executor) likelihood with the measured numbers. Commit `feat: approach 02 seq-memory`.

### Task 8: Report

Board: t-13.

**Files:**
- Create: `packages/cli/src/report.ts`, `packages/cli/test/report.test.ts`, `packages/cli/test/fixtures/*.json`
- Create (generated): `evm-benchmarks/REPORT.md`

**Interfaces:**
- Consumes: `RunResult` JSON files.
- Produces: `renderReport(results: RunResult[], notes: string): string` and the `bun run report` command. It groups by scenario, then approach (rows sorted by median TPS, highest first). Columns: approach, median TPS (verified runs only, `—` when none), p50 ms, p99 ms, runs (verified/total), evm, stateRoot, log, sigVerify, execution. Each table is followed by a line `Target: 1,000 TPS — ✅ met by: <ids>` or `❌ not met`. A header shows env (cpu, cores, runtime, webevm) from the newest result. The hand-written iteration log is kept: the text below `<!-- notes -->` in an existing REPORT.md is preserved verbatim.

- [ ] **Step 1: Write the failing test** `report.test.ts` with fixtures: two approaches × one scenario, one approach with a failed-verification run.
  - The median uses only verified runs (fixture TPS 900, 1100, 1000 → `1,000`).
  - An approach with zero verified runs shows `—`.
  - The target line lists only approaches with median ≥ 1000.
  - The notes below `<!-- notes -->` are preserved.
- [ ] **Step 2:** Run `bun test packages/cli/test/report.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then `bun run report` and check that REPORT.md has 5 scenario tables.
- [ ] **Step 5:** Write the first entry in the REPORT.md iteration log (what 01 vs 02 showed). Close or update the ADRs/risks the results inform. Board t-13 → Done. Commit `feat(cli): report generator and first results`.
