# evm-benchmarks playground — design (plan 3)

Date: 2026-11-19 · Status: draft for approval · Parent spec: `2026-11-19-evm-benchmarks-design.md`

## Intent

A zero-install, in-browser app where anyone can try the architectures from the benchmark project:
- create signing accounts
- write an ERC-20 in Solidity, then compile and deploy it
- create or pick an in-browser chain of a chosen type
- send transactions
- browse balances and a chain explorer
- run the benchmark scenarios in the browser and see TPS for themselves

## Goals

- **One static site, no backend.** Everything runs in the browser, including compilation (solc-js in a Web Worker) and chains (webevm with the revm engine).
- **Chain types are a choice made at creation:**
  - **plain:** approach 01 style, one tx per block, auto-mined.
  - **sequencer:** approach 02, parallel sig-verify Workers → sequencer → batched blocks.

  Both run on revm.
- **Separate pages per job:** Accounts, Chains, Studio, Transact, Explorer, Benchmark.
- **Reuse, not rebuild:**
  - Plan 1's approaches, scenarios and `runBenchmark` run unchanged in the browser, so browser numbers mean the same thing as CLI numbers.
  - UI patterns are copied from `chain-as-a-service/app` (React, Tailwind, the ERC20Card and deploy-form shapes).
- **State survives a reload:** accounts, chains, and deployed-contract records.

## Non-goals

- Browser wallets (MetaMask etc.), real networks, any server.
- Sharing state between users or devices.
- Moving chains into their own Worker. That was approach B, deferred until UI stutter during benchmarks proves to matter.
- Mobile-first polish. It must be usable at phone width, but is optimised for desktop.
- Approaches 03–06 (plan 2). Plan 2 adds them as more chain types later.

## Anti-goals

- **Playground numbers that differ in meaning from CLI numbers.** The Benchmark page must call the same `runBenchmark` + scenarios + verification, and show trade-offs the same way.
- **Key handling that looks real.** Keys are throwaway playground keys stored in the browser, and the UI says so plainly. There is no "import your real key" flow encouraged.
- **A UI that hangs without feedback.** Compiling, signing N txs and benchmarks all show progress.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | New `packages/web` in evm-benchmarks. Chains run on the page behind one `ChainHandle` interface | Least plumbing, reuses plan-1 code directly. The page stutters while 500-tx blocks mine during benchmarks |
| B | Same app, but each chain in its own Worker | Smooth UI. Every call becomes a message, 02's workers become nested, timing moves into the worker. A later step if needed |
| C | Convert chain-as-a-service/app in place | Built around a server, carries ERC-3643/messaging/swap, separate repo. More removing than building |

## Architecture

```
packages/web (React + Tailwind, Bun-built static site, HashRouter)
  pages:  Accounts | Chains | Studio | Transact | Explorer | Benchmark
  stores: accounts (localStorage) · chains + contracts registry (IndexedDB)
  ChainHandle ──wraps──▶ approach 01 or 02 factory (engine=revm)
  solc Worker  ◀── Studio (compile requests; soljson + OpenZeppelin sources served as static assets)
```

### ChainHandle

The UI only ever talks to chains through this:

```ts
interface ChainHandle {
  id: string; name: string; type: 'plain' | 'sequencer'
  send(raw: Hex): Promise<Receipt>                       // submit + awaitSettled for one tx
  request(method: string, params?: unknown[]): Promise<unknown>   // EIP-1193 reads (blocks, receipts, logs, balances, eth_call)
  dispose(): Promise<void>
}
```

It's built on the plan-1 `Approach`. Both approaches gain:
- a `request()` pass-through to their webevm node, for explorer reads
- an `engine` option (`ejs` default, `revm`)
- a way to persist and restore state (`dumpState`/`loadState` or webevm's `persistence` option)

The playground always creates chains with `engine=revm`.

### Pages

- **Accounts:**
  - Create (viem `generatePrivateKey`) with a label, list them, copy the address.
  - Show the ETH balance on the selected chain.
  - A plain "playground keys only" notice.
- **Chains:**
  - Create with name, type (plain | sequencer) and which accounts to prefund (default: all, 1,000 ETH each).
  - List and select the current chain, then delete.
  - The selected chain is global app state.
- **Studio:**
  - Solidity editor (CodeMirror 6 with Solidity highlighting), pre-filled with MintableToken.sol, with other templates selectable (plain ERC-20, AtomicSwap).
  - Compile in the solc Worker. Errors appear inline with line numbers.
  - Contract picker for multi-contract output, plus ABI view.
  - Deploy form: chain, deployer account, and constructor args generated from the ABI.
  - Deployed contracts are recorded per chain (address, name, ABI, deployer, tx hash).
- **Transact:**
  - Pick account and target.
  - For a recorded ERC-20: an ERC-20 card (name, symbol, supply, balances of all accounts, transfer, mint if the account is the owner).
  - For any recorded contract: a generic function list from the ABI, with read (`eth_call`) and write (signed tx).
  - Also plain ETH transfer.
  - Results show the receipt (status, gas, block, decoded logs).
- **Explorer**, per selected chain:
  - Block list, newest first, paginated.
  - Block detail: header and tx list, paginated for 500+ tx blocks.
  - Tx detail: receipt, plus decoded input and logs when the ABI is known.
  - Address page: ETH balance, nonce, code yes/no, and ERC-20 balances for recorded tokens.
  - A search box for block number, tx hash or address.
- **Benchmark:**
  - Pick chain type, scenario (the 5 from core), N (default 2,000 in browser) and senders.
  - Runs on a fresh throwaway chain, because `runBenchmark` calls `setup` and that resets the chain.
  - Shows phases: setup → signing (progress, untimed) → running → verifying.
  - Then shows TPS, p50/p99, verified, statuses, phases and trade-offs.
  - Keeps a session table of runs for side-by-side comparison.
  - After a run, the benchmark chain can be opened in the Explorer until the page is reloaded. It isn't persisted.

### Compilation

- solc-js runs in a dedicated Web Worker, which loads `soljson.js` (same compiler version as plan 1, 0.8.38) from the site's own static assets. The page paints first, and the worker loads after.
- `@openzeppelin/contracts` 5.6.1 sources are served as static assets (only the files imports need, gathered at build time). The worker's import callback fetches them.
- The settings match plan 1's `build.ts` (optimizer 200 runs, evmVersion cancun). The same source must therefore produce the same bytecode as `@evmb/contracts`.

### Persistence

- **Accounts:** localStorage, with keys stored in plaintext. They're throwaway, and the UI says so.
- **Chains:** IndexedDB holds the config and chain state, so the chain is restored on reload.
- **Contracts registry:** IndexedDB, keyed by chain.
- Every read/write is wrapped so a blocked-storage browser still works in memory, with a notice.

## Constraints

- **Code location:**
  - TypeScript/Bun.
  - Lives in `evm-benchmarks/packages/web`.
  - Uses `@evmb/core` and the approach packages as workspace deps.
  - Core, approaches, viem and webevm are bundled for the browser, so they must stay browser-safe, as plan 1 required.
- **Build and run:**
  - `bun run web:dev` serves it.
  - `bun run web:build` emits a static `dist/` that works when served from any path (HashRouter, relative asset URLs).
- **Versions:** pinned, as in plan 1: webevm 0.9.1, revm-wasm 0.3.1, solc 0.8.38, OZ 5.6.1.
- **Project docs:**
  - The board gets plan-3 tasks: t-14 to t-16 already exist, and new ones are added.
  - New decisions go in the ADR log (CodeMirror vs Monaco, persistence mechanism) and new risks in the register (solc bundle size, nested workers, revm in browser).

## Decided by the user

- Plan 3 next, before plan 2.
- Accounts, Solidity editor with compile/deploy, create-or-select chains, transactions, balances and explorer.
- Chain type is chosen at creation, and the in-browser benchmark is included.
- Separate pages per job.
- Approach A: new `packages/web`, chains on the page.

## Calls made by Claude (correct if wrong)

- Both chain types run on revm in the playground, via a new `engine` option on approaches 01 and 02. Plan 2's approach 05 (seq-revm) then becomes "02 with `engine=revm`", which the report already separates by options.
- The Benchmark page always uses a fresh throwaway chain. It never runs against your own chains, because benchmarks reset state.
- Browser default N is 2,000, so signing and running take seconds, not minutes.
- Prefund is 1,000 ETH per selected account at chain creation, and there's no faucet in v1.
- The editor is CodeMirror 6, not Monaco, because it's far smaller.
- Routing uses HashRouter, so any static host works.
- Keys are plaintext in localStorage, with a clear "playground only" label.
- Explorer reads go through EIP-1193 `request` on the chain's webevm node. There's no separate indexer, and webevm's `eth_getLogs` linear scan is fine at playground scale.
- Testing:
  - Non-UI modules (ChainHandle, stores, ABI form encoding, solc worker logic, persistence round-trip) get `bun test` unit tests.
  - Pages get a browser smoke check driven by the builder (load, create account and chain, compile, deploy, transfer, explore, benchmark N=200).

### Settled after the builder check (Claude's calls)

- **Persistence means full chain history.** Blocks, txs, receipts and logs come back after a reload, so the Explorer still works.
  - Use webevm's own `persistence: createIndexedDBPersistence(...)`, one store per chain id. webevm documents that state, balances and `eth_getLogs` survive a real reload.
  - The approach factories get a `persistence` option that is passed to `createNode`. Re-opening a chain means building it with the same persistence and calling a new `Approach.open?()` that loads instead of resetting. `setup()` still resets, so the CLI and `runBenchmark` are unchanged.
  - First build task: a spike that confirms blocks and receipts (not just state) survive. If they don't, fall back to `dumpState`/`loadState` plus a saved block/receipt list, and record that in the ADR.
  - 02's in-flight ring is not persisted. Txs not yet mined at reload are lost, and the UI says so.
- **`send()` on a sequencer chain** goes through the full pipeline: worker verify, then sequencer, then a one-tx block. That is intended, because it's the architecture being shown off. The sequencer's worker verification is the signature check (trusted execution), which is the declared `sigVerify: 'parallel-pre'` trade-off. No batch-send UI is planned: the Benchmark page covers volume.
- **Hosting:** no `SharedArrayBuffer` is used (checked in 02 and webevm), so no COOP/COEP headers are needed. Any static host works. Publishing (e.g. GitHub Pages, t-16) is a later, separate step.
- **Block shapes:** plain chains give one tx per block, and only sequencer and benchmark chains have 500+ tx blocks. Expected.
- **Benchmark progress:** add an optional `onProgress?(phase: 'setup'|'signing'|'running'|'verifying', done: number, total: number)` to core's `RunOptions` (and pass it to `Scenario.generate`). The CLI ignores it. It runs on the page's main thread, and 02's verify Workers are ordinary page workers, not nested.
- **OpenZeppelin:** ship the whole `@openzeppelin/contracts` 5.6.1 `.sol` tree as static files, fetched lazily, one file per import. So any OZ import works and only the imported files are downloaded. A missing import shows a clear error naming the path.
- **Compiler:** `soljson.js` is copied from the same npm `solc@0.8.38` package plan 1 uses. A unit test asserts the worker's compile of MintableToken.sol produces the same bytecode as `@evmb/contracts`' artifact.

## Left to the builder

Component structure, styling details, pagination sizes, exactly how OZ sources are gathered at build time, how the persistence hook is wired into 01/02, and the progress UI.
