---
version: 1
theme: paper
---
# evm-benchmarks

## To Do

### core: Approach interface, trade-off schema, metrics
- id: t-04
- owner:
- tags: core
- history:
  - To Do @ 2026-11-19T09:38:00Z

### core: five scenarios (generator + verifier each)
- id: t-05
- owner:
- tags: core
- history:
  - To Do @ 2026-11-19T09:38:00Z

```md
eth-transfer, erc20-disjoint, erc20-hot, erc20-mint, atomic-swap
```

### cli: bench command writing results JSON
- id: t-06
- owner:
- tags: cli
- history:
  - To Do @ 2026-11-19T09:38:00Z

### Approach 01: webevm-baseline
- id: t-07
- owner:
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

### Approach 02: seq-memory
- id: t-08
- owner:
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

```md
Parallel sig pre-verify, single-writer sequencer, ring buffer, batched blocks, no state root, in-memory log.
```

### Approach 03: seq-stateroot
- id: t-09
- owner:
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

```md
Per-block and deferred state root. Closes ADR "State root per block, deferred, or none".
```

### Approach 04: seq-durable
- id: t-10
- owner:
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

```md
Append-only replayable log: file (Bun), IndexedDB (browser).
```

### Approach 05: seq-revm
- id: t-11
- owner:
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

### Approach 06: rpc (anvil / Besu)
- id: t-12
- owner:
- tags: approach
- history:
  - To Do @ 2026-11-19T09:38:00Z

### cli: report command generating REPORT.md
- id: t-13
- owner:
- tags: cli, report
- history:
  - To Do @ 2026-11-19T09:38:00Z

### web: Studio (solc-js compile, deploy, call)
- id: t-14
- owner:
- tags: web
- history:
  - To Do @ 2026-11-19T09:38:00Z

### web: in-browser Benchmark
- id: t-15
- owner:
- tags: web
- history:
  - To Do @ 2026-11-19T09:38:00Z

### web: static deploy (GitHub Pages)
- id: t-16
- owner:
- tags: web, infra
- history:
  - To Do @ 2026-11-19T09:38:00Z

### Later: parallel execution approaches
- id: t-17
- owner:
- tags: approach, later
- history:
  - To Do @ 2026-11-19T09:38:00Z

### Later: native-erc20 approach (evm: false)
- id: t-18
- owner:
- tags: approach, later
- history:
  - To Do @ 2026-11-19T09:38:00Z

## Doing

## Done

### contracts: MintableToken + AtomicSwap compiled with solc-js
- id: t-03
- owner: Claude
- tags: contracts
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T10:00:44Z by Claude
  - Done @ 2026-11-19T10:04:25Z by Claude

### Design evm-benchmarks
- id: t-00
- owner: Claude
- tags: design
- history:
  - Doing @ 2026-11-19T08:30:00Z by Claude
  - Done @ 2026-11-19T09:38:00Z by Claude

```md
evm-benchmarks/docs/superpowers/specs/2026-11-19-evm-benchmarks-design.md
```

### Spike: confirm webevm trusted sender, manual mining, revm
- id: t-01
- owner: Claude
- tags: spike, engine
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T09:58:20Z by Claude
  - Done @ 2026-11-19T09:58:20Z by Claude

```md
Confirm the features approaches 02-05 rely on. Record outcome in ADR "Which EVM engine backs the sequencer" and risk R01.
```

### Scaffold evm-benchmarks Bun workspace
- id: t-02
- owner: Claude
- tags: infra
- history:
  - To Do @ 2026-11-19T09:38:00Z
  - Doing @ 2026-11-19T09:58:20Z by Claude
  - Done @ 2026-11-19T09:58:20Z by Claude
