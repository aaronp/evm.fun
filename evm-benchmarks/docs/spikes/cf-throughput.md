# Submit throughput baseline (t-132)

`make throughput-node` (in-process) or `make throughput-node ARGS='--url http://127.0.0.1:8799'` (local wrangler worker). Script: `packages/node/scripts/throughput.ts`.

Setup: fresh chain, 10 fresh sender keys, each owns a `MintableToken` and has minted itself a pile. A batch of N is N pre-signed `transfer(sink, 1)` txs spread round-robin over the 10 senders (N=1 rotates sender per round; N=100 is 10 sequential nonces per sender), one `POST /submit` per batch, 20 rounds per size. Signing is outside the timed region. Latency is the whole HTTP round trip on localhost. Every batch is one block.

Writers: the admin signs every request and the 10 senders were added as chain writers (`addWriter`), because `ChainService.submit` still requires every tx sender to be a writer (Task 2 removes that).

Machine: Apple M4 Pro, 12 cores, macOS, Bun 1.3.13; worker = `wrangler dev` (workerd, local SQLite DO).

| target | batch | txs | txs/s | p50 ms | p95 ms | ms/tx |
|---|---|---|---|---|---|---|
| in-process | 1 | 20 | 340 | 3 | 4 | 2.9 |
| in-process | 10 | 200 | 731 | 14 | 16 | 1.4 |
| in-process | 100 | 2000 | 1104 | 90 | 100 | 0.9 |
| local worker | 1 | 20 | 191 | 5 | 8 | 5.2 |
| local worker | 10 | 200 | 489 | 20 | 26 | 2.0 |
| local worker | 100 | 2000 | 755 | 133 | 142 | 1.3 |

One run each, 20 samples per size (p95 is nearly the max for N=1); treat as order of magnitude.

## Where the time goes

Latency is roughly `fixed + N * per_tx`:

- In-process: about 2 ms fixed + 0.9 ms per tx.
- Local worker: about 4 ms fixed + 1.3 ms per tx. The extra ~2 ms fixed is HTTP + DO hop; the extra ~0.4 ms per tx is body parse and the larger JSON.
- Fixed part per submit: request signature check, ACL reads (`canWrite` per sender and signer: contract calls), block seal and state root, store write. Per-tx part: EVM execution in revm-wasm (a token transfer is cheap) plus signature recovery.
- Batching amortizes the fixed part: 1 to 10 gives 2.6x throughput, 10 to 100 only 1.5x more at 6.6x the latency.

## Recommendation

`DEFAULT_BATCH = 25`. At that size the model gives roughly 35 ms per submit and ~700 txs/s on the worker, already ~90% of the batch-100 throughput, while a refused tx (nonce gap) invalidates at most 24 followers, and one block holds 25 txs (small blocks keep other devices' sync cheap). A device on a phone generates far less than this, so the batch is mostly about draining a backlog after being offline; 25 per submit is fine there. 100 per submit is safe on the server (133 ms) but gains little.

## Notes

- Submit body cap today is 64 KiB: 100 transfers (~23 KB) fit, a contract deploy (~10 KB hex) does not fit 10 per request. Task 3 raises it to 1 MiB.
- Not measured: remote Cloudflare (network RTT adds directly to the fixed cost; DO SQLite writes are not local files), concurrent writers (writes are serialized per chain), cold start.
