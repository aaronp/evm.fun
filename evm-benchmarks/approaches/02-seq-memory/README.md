# 02 seq-memory

## Idea
The core architecture: take signature recovery off the critical path, then feed one executor big batches. Workers recover senders in parallel, a single-writer sequencer puts the verified txs back into submit order in a ring buffer, and one executor loop mines a block of up to `block` txs at a time on webevm in trusted-sender mode (no recovery on the executor). No state root, in-memory log.

## Data flow
```
submit(raw[]) --split into chunks, seq 0,1,2..--> round-robin
   |                                               |
   v                                               v
 verify worker 1 .. W  (viem recoverTransactionAddress = parseTransaction + recover; hash = keccak256(raw))
   |  reply {seq, items: {raw, hash, from|null, error?}[]}   (any order)
   v
 sequencer (main thread, single writer)
   reorder map -> release strictly in seq order
   from === null -> 'rejected' receipt now
   else -> log.push({seq, raw, from}) + ring.tryPush   (ring full: stop, resume after next drain)
   v
 RingBuffer (capacity 4 * block)
   v
 executor loop (sleeps on a promise when the ring is empty)
   drain(block) -> evm_sendRawTransactionAs [raw, from] each -> node.mine()
   -> settledAt = performance.now() (main thread) -> eth_getTransactionReceipt each
```

## Trade-offs
- evm: yes (webevm@0.9.1 default engine, `senderMode: 'trusted'`, `miningConfig: {type: 'manual'}`, `blockGasLimit = block * 3M` so a full block of the heaviest tx always fits)
- stateRoot: none, log: memory, sigVerify: parallel-pre, execution: serial
- Order: chunks are released only in `seq` order, so one sender's txs split across `submit` calls or chunks keep nonce order.
- Trust: the executor believes the `from` the workers recovered. Fine in-process; it would need a signed/attested handoff across a trust boundary.
- Backpressure: the ring is bounded; verified chunks wait in the reorder map until the executor drains. Workers are not throttled, so the reorder map is the unbounded part.
- Workers and the node are created in `setup()`; `dispose()` terminates the workers and disposes the node. The factory allocates nothing.
- No webevm fallback was needed: every spike-confirmed path worked.

## Options
`--opt k=v`: `workers` (default `navigator.hardwareConcurrency - 1`, min 1), `block` (txs per block, default 500), `chunk` (txs per verify message, default 250).

Phases (`phases()`, ms, main-thread clock): `verifyMs` wall time with at least one chunk outstanding at a worker (includes time a reply waits for the busy main thread), `sequenceMs` reorder + ring pushes, `executeMs` sending txs + reading receipts, `mineMs` inside `node.mine()`.

## Run
`bun run bench --approach 02-seq-memory --scenario all`

## Results / lessons
`bun run bench --approach all --scenario all --n 10000 --runs 3` (100 senders, batch 1000, Apple M4 Pro 12 cores, Bun 1.3.13, webevm@0.9.1), median TPS, all runs verified:

| scenario | 01 baseline | 02 seq-memory | x |
| --- | --- | --- | --- |
| eth-transfer | 280 | 318 | 1.1 |
| erc20-disjoint | 1300 | 2566 | 2.0 |
| erc20-hot | 1300 | 2606 | 2.0 |
| erc20-mint | 1432 | 3135 | 2.2 |
| atomic-swap | 817 | 1215 | 1.5 |

- 02 beats 01 on every scenario, but by 1.1-2.2x, not the ~10x the spike measured (16.9k tx/s for single-sender transfers to one recipient).
- `node.mine()` dominates. Per 10k-tx run: erc20 ~1.6-2.3 s mine vs ~1.3 s send+receipts; atomic-swap ~6.8 s mine.
- eth-transfer sends to 10,000 fresh recipients and mine time is ~30 s, ~3 ms per newly created account. Block size makes no difference (block=500 and block=2000 both ~300 TPS), so the cost is per new account in webevm's mine, not per block. The engine is the bottleneck here, not the pipeline; the revm approach (05) is the test of that.
- Latency is higher than 01 (p50 2-9 s) because all 10k txs are queued up front and settle in blocks.
- `sequenceMs` is under 1 ms per run: the sequencer is not a bottleneck.
