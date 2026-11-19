# 01 webevm-baseline

## Idea
The control: a stock webevm node with signature recovery and auto-mining, fed one transaction at a time. Everything else is measured against it.

## Data flow
`submit(raw[])` -> for each tx, serially: `eth_sendRawTransactionSync` (recover sender, execute, mine one block) -> store a `Receipt` keyed by `keccak256(raw)`. An RPC error becomes a `rejected` receipt. `awaitSettled(hashes)` resolves once every hash has a receipt.

## Trade-offs
- evm: yes (webevm default engine)
- stateRoot: none, log: memory, sigVerify: inline, execution: serial
- One tx per block, so per-tx block overhead dominates. Spike measured ~1.7k tx/s for recover + auto mining.
- Runs in Bun and the browser (no Node-only APIs).

## Run
`bun run bench --approach 01-webevm-baseline`

## Results / lessons
See REPORT.md.
