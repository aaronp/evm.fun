# evm-benchmarks Plan 3: Browser playground

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-install static site (`packages/web`) with six pages:
- **Accounts**
- **Chains:** create or select; plain or sequencer; on revm
- **Studio:** Solidity editor, then solc-js compile, then deploy
- **Transact**
- **Explorer**
- **Benchmark:** plan-1 scenarios in the browser

**Architecture:** React + Tailwind built by Bun's HTML bundler, with HashRouter. Chains run on the page behind a `ChainHandle` that wraps the plan-1 approaches (01 = plain, 02 = sequencer) created with the revm engine and webevm IndexedDB persistence. solc-js runs in a Web Worker. Its `soljson.js` and the OpenZeppelin `.sol` tree are served as static assets.

**Tech Stack:** Bun 1.3.x, React 19, Tailwind 4, react-router-dom 7 (HashRouter), CodeMirror 6, viem, webevm 0.9.1 (+ `webevm/revm`, revm-wasm 0.3.1), solc 0.8.38, @openzeppelin/contracts 5.6.1.

**Spec:** `evm-benchmarks/docs/superpowers/specs/2026-11-19-playground-design.md` (parent: `2026-11-19-evm-benchmarks-design.md`)

## Global Constraints

- Everything runs in the browser. No server code, and no `SharedArrayBuffer`. The site must work from any static host and any path: HashRouter, relative asset URLs.
- Pinned versions: `webevm@0.9.1`, `revm-wasm@0.3.1`, `solc@0.8.38` (soljson copied from that npm package), `@openzeppelin/contracts@5.6.1`.
- **Browser-safe code:** `packages/core`, the approaches, and `packages/web/src` (except build scripts) never import `node:*`/`fs`.
- Workers are created with `new Worker(new URL('./x.ts', import.meta.url), {type: 'module'})`.
- **Plan-1 behaviour must not change.** `bun test` stays green. `setup()` still resets a chain. The CLI and `runBenchmark` results keep their meaning. New options default to today's behaviour.
- **Playground chains:**
  - Created with `engine=revm`.
  - Prefund is 10n**21n wei (1,000 ETH) for each selected account.
  - chainId 31337.
  - Benchmark default N = 2000, senders 100.
- **Compiler settings** are identical to `packages/contracts/build.ts`: optimizer enabled with runs 200, evmVersion `cancun`.
- **Keys:** stored as plaintext in localStorage. Every page that shows keys displays: "Playground keys only — stored unencrypted in this browser. Never use a real key."
- **Storage access:** every localStorage/IndexedDB access is wrapped. When storage is unavailable, the app runs in memory and shows a dismissible notice: "Storage unavailable — nothing will be saved."
- **Project docs** live at the repo root: `docs/board/board.md` (strict format: `node_modules/@pritzlaff/agile/spec.md`), `docs/risks/risks.md`, `docs/adr/decisions.md`.
  - Each task moves its board card to Doing at start and Done at commit.
  - History timestamps are the real UTC time (`date -u +%Y-%m-%dT%H:%M:%SZ`), never invented.
  - Set `owner: Claude`.
  - After editing those files, run `bunx agile card docs/board/board.md $TMPDIR/c && bunx adr card docs/adr/decisions.md $TMPDIR/c && bunx risk-register card docs/risks/risks.md $TMPDIR/c` from the repo root. Each must print `Wrote …`.
- **Git and install:** branch `plan3-playground` (from `plan1-harness`). Git writes and `bun install` need the sandbox disabled. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Reload.** After a reload, accounts, chains (both types) and the contracts registry come back. The Explorer still lists blocks mined before the reload. Test in Task 4 (`reopens chain with history`).
2. **Storage blocked.** If localStorage throws or IndexedDB is unavailable, the app works in memory with the notice and nothing crashes. Test in Task 3 (`falls back to memory when storage throws`).
3. **Bad Solidity.** Syntax errors, a missing OpenZeppelin import, empty source, or several contracts in one file must give clear errors or a contract picker, never a crash or hang. Tests in Task 5.
4. **Bad ABI arguments.** For a non-address, a negative or fractional uint, a uint above 2^53 (must stay exact via bigint), bool `"yes"` or a malformed bytes value, the user gets a validation error before anything is signed. Test in Task 6.
5. **Explorer edge cases.** A block with 500+ txs is paginated. Searching an unknown hash or address shows "Not found", not an exception. Tests in Task 7.

---

### Task 1: Spike — persistence and revm

Board: add cards t-19…t-27 for Tasks 1–9 of this plan (To Do, real timestamps). Then t-19 goes through Doing to Done.

**Files:**
- Create: `evm-benchmarks/spike/playground.test.ts`
- Modify: `docs/board/board.md`, `docs/adr/decisions.md`, `docs/risks/risks.md`

**Interfaces:**
- Produces findings, recorded in a new ADR "Chain persistence in the playground" (status accepted, with the outcome).
- Adds risks:
  - R08: solc bundle size and load time
  - R09: revm-wasm and workers through Bun's HTML bundler
  - R10: data loss in webevm IndexedDB persistence

- [ ] **Step 1: Write the spike tests.**
  - `persistence restores blocks and receipts`: build a node with an in-memory object implementing webevm's persistence interface (read the type in `node_modules/webevm`). Mine 3 transfers and dispose. Then create a second node with the same persistence and assert:
    - `eth_blockNumber` is 3
    - `eth_getBlockByNumber(2, true)` lists the tx
    - `eth_getTransactionReceipt` returns status `0x1`
    - balances match
  - `initialBalances do not override restored state`: on reopen, a restored balance wins over `initialBalances`.
  - `revm engine via engine option`: `createNode({engine: await createRevmEngine({wasm: <bytes of revm-wasm/revm.wasm>})})` runs one transfer.
- [ ] **Step 2:** Run `bun test spike/playground.test.ts`. Record the outcomes in the ADR. If blocks or receipts don't survive, set the ADR decision to the fallback: `dumpState`/`loadState` plus a saved block/receipt list in our own IndexedDB store. Later tasks follow whatever the ADR says.
- [ ] **Step 3:** Board and card check. Commit `spike: webevm persistence and revm for playground`.

### Task 2: Core and approach extensions

Board: t-20.

**Files:**
- Modify: `packages/core/src/types.ts`, `packages/core/src/runner.ts`, `packages/core/src/scenarios/*.ts`, `approaches/01-webevm-baseline/index.ts`, `approaches/02-seq-memory/index.ts`, `packages/cli/src/bench.ts`
- Test: `packages/core/test/progress.test.ts`, `approaches/01-webevm-baseline/approach.test.ts`, `approaches/02-seq-memory/approach.test.ts`

**Interfaces:**
- Produces (types.ts):
```ts
interface ApproachHost {
  createEngine?: () => Promise<unknown>   // e.g. () => createRevmEngine({wasm})
  persistence?: unknown                   // webevm persistence object (or per Task 1 ADR fallback)
}
type ApproachFactory = (opts?: Record<string, string>, host?: ApproachHost) => Approach
interface Approach {
  // …existing…
  open?(): Promise<void>                                          // load persisted chain, no reset; throws if nothing persisted
  request?(method: string, params?: unknown[]): Promise<unknown>  // EIP-1193 read pass-through to the node
}
```
  - `RunOptions.onProgress?(phase: 'setup'|'signing'|'running'|'verifying', done: number, total: number): void`
  - `Scenario.generate(p, onSigned?: (done: number) => void)`
- Behaviour:
  - Both approaches pass `host.createEngine` (if given) as `engine: await host.createEngine()` and `host.persistence` (if given) to `createNode`.
  - `meta.engine` becomes `'webevm@0.9.1+revm'` when an engine is injected.
  - The CLI: `--opt engine=revm` makes bench.ts pass `host.createEngine` that loads `revm-wasm/revm.wasm` bytes.
  - `onProgress` fires at least at each phase start/end. During signing it fires at least every 100 txs.

- [ ] **Step 1: Write failing tests.**
  - `progress.test.ts`: `runBenchmark` with approach 01, eth-transfer, n=250. The `onProgress` calls include `signing` with done reaching 250, and phases in order setup → signing → running → verifying.
  - In each approach test: `request('eth_blockNumber')` after one tx returns `0x1`. With an in-memory persistence, `setup` + 2 txs, then a new instance with the same persistence and `open()`, gives `getBalance` and `request('eth_getTransactionReceipt')` matching. With `host.createEngine` (revm bytes), a transfer succeeds and `meta.engine` ends in `+revm`.
- [ ] **Step 2:** Run `bun test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun test`. Expected: all pass, including every plan-1 test. Then run `bun run bench --approach 02-seq-memory --scenario erc20-disjoint --n 2000 --runs 1 --opt engine=revm` and check it is verified. Put that TPS in the report.
- [ ] **Step 5:** Board t-20 → Done. Commit `feat: approach host (engine, persistence), open/request, progress callback`.

### Task 3: Web scaffold, layout and stores

Board: t-21.

**Files:**
- Create in `packages/web/`:
  - `package.json` (`@evmb/web`)
  - `index.html`
  - `src/main.tsx`
  - `src/App.tsx` (HashRouter, nav: Accounts, Chains, Studio, Transact, Explorer, Benchmark; each a stub page)
  - `src/ui/*` (button, card, notice)
  - `src/store/kv.ts`
  - `src/store/accounts.ts`
  - `build.ts`
  - `test/store.test.ts`
- Modify: `evm-benchmarks/package.json` scripts `web:dev`, `web:build`

**Interfaces:**
- Produces:
  - `kv` = `{get<T>(store, key): Promise<T|undefined>, set(store, key, value), del(store, key), list<T>(store): Promise<T[]>, persistent: boolean}`. It is backed by IndexedDB (db `evmb-playground`) and falls back to a Map when IndexedDB is missing or throws.
  - `accounts` = `{list(): Account[], create(label): Account, remove(address), persistent: boolean}` with `Account = {label, address, privateKey}` in localStorage key `evmb.accounts`, falling back to memory.
  - A `<StorageNotice/>` component shows the Global Constraints text when `!kv.persistent || !accounts.persistent`.
  - `build.ts` runs `Bun.build` on `index.html` into `dist/` with relative asset URLs, using `bun-plugin-tailwind`.
  - `web:dev` serves with hot reload: `bun --hot index.html` or equivalent.
- Ruling for the implementer: if Bun's HTML bundler can't emit the Worker entry or `.wasm`/`soljson` assets correctly (check by building a throwaway worker that posts back `'ok'`), switch the web package to Vite. Record an ADR "Web bundler" either way.

- [ ] **Step 1: Write failing tests** in `store.test.ts`:
  - `kv round-trips in memory`
  - `falls back to memory when storage throws`: stub `globalThis.localStorage` and `indexedDB` with throwing getters. `create('a')` still works and `persistent === false`.
  - `accounts.create derives address from key`
- [ ] **Step 2:** Run `bun test packages/web`. Expected: FAIL.
- [ ] **Step 3:** Implement the stores, layout and build. Copy the Tailwind/button patterns from `chain-as-a-service/app/src/ui/components/ui/` where useful.
- [ ] **Step 4:** Tests pass. `bun run web:build` produces `dist/index.html`, and the throwaway-worker check passes in a real browser (served via `bunx serve dist` or `web:dev`, opened by the implementer if a browser tool is available, otherwise noted for Task 9).
- [ ] **Step 5:** Board and ADR. Commit `feat(web): scaffold, layout, storage`.

### Task 4: ChainHandle, Chains and Accounts pages

Board: t-22.

**Files:**
- Create: `packages/web/src/chain/handle.ts`, `src/chain/registry.ts`, `src/chain/revm.ts`, `src/pages/Accounts.tsx`, `src/pages/Chains.tsx`, `src/state.tsx` (selected chain and account context), `test/chain.test.ts`

**Interfaces:**
- Consumes: `ApproachHost`, `open`, `request` (Task 2), `kv` and `accounts` (Task 3).
- Produces:
```ts
type ChainType = 'plain' | 'sequencer'   // plain → approach 01, sequencer → approach 02
interface ChainInfo { id: string; name: string; type: ChainType; createdAt: string; ephemeral?: boolean }
interface ChainHandle { info: ChainInfo; send(raw: Hex): Promise<Receipt>; request(m: string, p?: unknown[]): Promise<unknown>; approach: Approach; dispose(): Promise<void> }
createChainRegistry(deps: {kv; host: (chainId: string) => ApproachHost}): {
  list(): Promise<ChainInfo[]>
  create(name: string, type: ChainType, prefund: Address[]): Promise<ChainHandle>   // setup() with 10n**21n each
  open(id: string): Promise<ChainHandle>                                            // approach.open()
  remove(id: string): Promise<void>                                                 // dispose + delete persisted data
  addEphemeral(handle: ChainHandle): void                                           // benchmark chains, not persisted
}
```
  - `revm.ts` exports the browser `host(chainId)`. It builds `createEngine` via `createRevmEngine({wasm: <bundled revm.wasm URL>})` and per-chain persistence per the Task 1 ADR.
  - Tests inject a host with no engine and in-memory persistence.
- Pages:
  - **Accounts:** list, create with a label, copy address, ETH balance on the selected chain, delete, and the key warning.
  - **Chains:** list, create (name, type radio, prefund checkboxes defaulting to all accounts), select, delete with confirm.

- [ ] **Step 1: Write failing tests** in `chain.test.ts`, for both types:
  - `create, send, balance`
  - `reopens chain with history`: create, send 2 txs, drop the handle, then a new registry on the same kv/persistence `open(id)`. `eth_blockNumber` and a receipt from before are still there.
  - `remove deletes persisted data`
  - `send returns rejected for garbage`
- [ ] **Step 2:** Run `bun test packages/web`. Expected: FAIL.
- [ ] **Step 3:** Implement the handle, registry, revm host and both pages.
- [ ] **Step 4:** Tests pass, and `bun test` overall stays green.
- [ ] **Step 5:** Board. Commit `feat(web): chains and accounts`.

### Task 5: Compiler worker and Studio

Board: t-23 (the existing t-14 "web: Studio" also goes to Done).

**Files:**
- Create: `packages/web/src/solc/compile.ts`, `src/solc/worker.ts`, `src/solc/client.ts`, `src/solc/templates.ts`, `src/contracts/registry.ts`, `src/pages/Studio.tsx`, `test/solc.test.ts`
- Modify: `packages/web/build.ts` (copies `soljson.js` and the OpenZeppelin `contracts/**/*.sol` tree into `dist/assets/`)

**Interfaces:**
- Produces:
  - `compile(solc, sources: Record<string,string>, readImport: (path) => Promise<string|null>): Promise<{contracts: {file, name, abi, bytecode}[]; errors: {severity, message, line?: number}[]}>` in `compile.ts`. It is pure apart from the passed-in `solc` and `readImport`, and is shared by the worker and the tests. Imports are resolved by pre-walking the `import` statements (recursively), because solc-js's import callback is synchronous.
  - `client.ts` → `compileInWorker(source: string): Promise<…same…>`, lazily starting `worker.ts`. The worker loads `assets/soljson.js` and fetches `assets/@openzeppelin/contracts/...` on demand.
  - `templates`: MintableToken.sol (verbatim from `packages/contracts/src`), a plain fixed-supply ERC-20, and AtomicSwap.sol.
  - `contractsRegistry`: `{list(chainId), add(chainId, {address, name, abi, deployer, txHash}), remove(chainId, address)}` on `kv`.
- **Studio page:**
  - CodeMirror 6 editor (`@codemirror/lang-javascript` is not acceptable; use a Solidity mode such as `@replit/codemirror-lang-solidity`, or a minimal StreamLanguage), with a template picker.
  - Compile button with a spinner. Errors are listed with line numbers and clicking one jumps to the line.
  - Contract picker when there are several contracts, and an ABI view.
  - Deploy form: deployer account, plus constructor inputs from the ABI using the Task 6 `encodeArgs`. Ruling: Task 5 implements `abi/args.ts` minimal enough for constructor args, and Task 6 extends it.
  - Deploying records the contract in the registry and links to it in Transact.

- [ ] **Step 1: Write failing tests** in `solc.test.ts`, which load solc from npm in Bun and `readImport` from `node_modules/@openzeppelin`:
  - `same bytecode as @evmb/contracts`: compile MintableToken.sol and assert bytecode === `MintableToken.bytecode`.
  - `syntax error has line`: a missing semicolon gives an error-severity entry with a line number.
  - `missing import names the path`: `import "@openzeppelin/contracts/Nope.sol"` gives an error containing `Nope.sol`.
  - `empty source` gives a clear error, with no throw.
  - `multi-contract`: two contracts in one file gives 2 entries.
- [ ] **Step 2:** Run `bun test packages/web/test/solc.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the compiler code, build copying, the contracts registry and the Studio page.
- [ ] **Step 4:** Tests pass. `bun run web:build` emits `dist/assets/soljson.js` and the OZ tree.
- [ ] **Step 5:** Board and risk R08 (record the soljson size). Commit `feat(web): solc worker and Studio`.

### Task 6: Transact

Board: t-24.

**Files:**
- Create or extend: `packages/web/src/abi/args.ts`, `src/pages/Transact.tsx`, `src/components/Erc20Card.tsx`, `src/components/FunctionForm.tsx`, `src/components/ReceiptView.tsx`, `test/args.test.ts`

**Interfaces:**
- Produces:
  - `parseArg(type: string, input: string): {ok: true; value: unknown} | {ok: false; error: string}`. It supports `address`, `bool` (`true`/`false` only), `uint<N>`/`int<N>` (bigint, range-checked), `string`, `bytes`, `bytes<N>`, and `T[]` (JSON array input).
  - `encodeArgs(inputs: AbiParameter[], raw: string[])` collects every error.
  - `signAndSend(handle, account, {to?, data?, value?})` gets the nonce via `request('eth_getTransactionCount', [addr, 'pending'])`. It uses the chainId and fees from core's `signTx`, with gas from `eth_estimateGas` (×1.2, falling back to 3,000,000).
- **Transact page:** account picker and target picker (recorded contracts on the selected chain, plus "ETH transfer").
  - For an ERC-20 ABI (it has `transfer`, `balanceOf`, `decimals`): an Erc20Card showing name, symbol, supply and every account's balance, plus a transfer form, and a mint form when `owner()` equals the account.
  - For any ABI: a FunctionForm per function. View/pure functions use `eth_call` and show the decoded result. Others sign and send.
  - ReceiptView shows status, gas used, block (linking to the Explorer), and logs decoded with the ABI when known.

- [ ] **Step 1: Write failing tests** in `args.test.ts`:
  - address: valid passes, `0x123` fails
  - uint256: `"-1"` fails, `"1.5"` fails, `"9007199254740993"` gives exactly `9007199254740993n`
  - uint8: `"256"` fails
  - bool: `"yes"` fails
  - bytes: `"0xzz"` fails
  - `uint256[]`: `"[1,2]"` gives `[1n,2n]`
  - `encodeArgs` collects 2 errors for 2 bad inputs
  - Plus one integration test: `signAndSend` deploys MintableToken on a plain chain handle (Task 4 test host), mints, and transfers, and balances match.
- [ ] **Step 2:** Run `bun test packages/web/test/args.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. The Studio deploy switches to `signAndSend` and the shared `args.ts`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Board. Commit `feat(web): Transact`.

### Task 7: Explorer

Board: t-25.

**Files:**
- Create: `packages/web/src/explorer/data.ts`, `src/pages/Explorer.tsx` (routes `/explorer`, `/explorer/block/:n`, `/explorer/tx/:hash`, `/explorer/address/:addr`), `test/explorer.test.ts`

**Interfaces:**
- Produces (in `data.ts`, all taking a `ChainHandle`):
  - `latestBlocks(h, page, size=20)` → `{number, hash, timestamp, txCount}[]`, newest first
  - `block(h, n, txPage, size=50)` → `{header, txs: {hash, from, to, value}[], txTotal}` or `null`
  - `tx(h, hash, abis)` → `{tx, receipt, decodedInput?, decodedLogs}` or `null`
  - `address(h, addr, tokens)` → `{balance, nonce, isContract, tokenBalances}`
  - `classify(query)` → `'block' | 'tx' | 'address' | 'invalid'`
- **Explorer page:** search box (`classify`, then navigate, or show "Not found"), latest blocks with paging, block detail with paged txs, tx detail, address detail. Contract names come from the registry when known.

- [ ] **Step 1: Write failing tests** against a sequencer chain handle with `block=600`, after one benchmark-style batch of 600 transfers:
  - `block(h, 1, 0)` has 50 txs and `txTotal === 600`, and page 11 has 50
  - `tx(h, unknownHash)` → null
  - `address(h, unknownAddr)` → balance 0, `isContract` false
  - `classify` covers all 4 outcomes
  - `latestBlocks` is newest first
- [ ] **Step 2:** Run `bun test packages/web/test/explorer.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Board. Commit `feat(web): Explorer`.

### Task 8: Benchmark page

Board: t-26 (the existing t-15 "web: in-browser Benchmark" also goes to Done).

**Files:**
- Create: `packages/web/src/bench/run.ts`, `src/pages/Benchmark.tsx`, `test/bench.test.ts`

**Interfaces:**
- Consumes: `runBenchmark` with `onProgress`, `scenarios`, the registry `addEphemeral`.
- Produces: `runInBrowser({type, scenario, n, senders, host}, onProgress) => Promise<{result: RunResult; handle: ChainHandle}>`. It builds the approach with the host (revm, **no** persistence), runs `runBenchmark`, and returns a handle wrapping the same approach. The page registers that handle as an ephemeral chain named `bench <scenario> <type> #k`.
- **Benchmark page:** form for type, scenario, N (default 2000) and senders (default 100). A phase progress bar (signing shows done/total). The result card shows TPS (`—` when null), p50/p99, verified, statuses, phases and trade-offs. A session table of all runs, and a link to "Open in Explorer".

- [ ] **Step 1: Write failing test** in `bench.test.ts`: `runInBrowser` for plain and sequencer, eth-transfer, n=200, using the test host. The result is verified, `onProgress` reaches signing 200, and `handle.request('eth_blockNumber')` > 0 after the run.
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Board. Commit `feat(web): in-browser Benchmark`.

### Task 9: Browser smoke check, README, docs

Board: t-27.

**Files:**
- Create: `packages/web/README.md`
- Modify: `evm-benchmarks/README.md` (link and how to run), `docs/board/board.md`, `docs/risks/risks.md`, `docs/adr/decisions.md`

- [ ] **Step 1:** Run `bun run web:build`, serve `dist/` statically from a sub-path (e.g. copy it to `$TMPDIR/site/playground/` and serve `$TMPDIR/site`), and run this smoke script in a real browser:
  1. Create 2 accounts.
  2. Create a sequencer chain.
  3. Compile the MintableToken template, deploy it, and mint 100 to account 2.
  4. Transfer 10 to account 1.
  5. In the Explorer, find the transfer tx and see decoded Transfer logs.
  6. Reload the page and check the accounts, chain, contract and blocks are still there.
  7. Run the Benchmark with erc20-disjoint on sequencer, N=2000, and see a verified result.
  8. Open the benchmark chain in the Explorer.

  Record each step as pass or fail with a note, and the browser TPS.

  If no browser tool is available to the implementer, report NEEDS_CONTEXT with the exact steps and URL so the controller can run them.
- [ ] **Step 2:** Fix any failures. Each fix gets a regression test where it can be tested outside the browser.
- [ ] **Step 3:** README (what it is, `web:dev`/`web:build`, the key warning, known limits: the UI stutters during benchmarks, in-flight sequencer txs are lost on reload). Update the risks (R08–R10) with what was observed, and add the browser TPS row to REPORT.md's iteration log.
- [ ] **Step 4:** `bun test` is fully green. Board t-27 → Done. Commit `docs(web): smoke-checked playground, README`.
