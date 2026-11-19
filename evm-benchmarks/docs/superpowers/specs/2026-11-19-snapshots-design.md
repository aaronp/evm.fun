# Playground: snapshots, restore, import / export (roadmap step 2)

Date: 2026-11-19 · Status: approved in conversation; written up for the builder check.
Builds on: `2026-11-19-explorer-design.md` (roadmap). Branch: `plan3-playground`.

## Intent

Save and load chain state in the playground. The main purpose is to **demonstrate forks** on purpose:
1. Snapshot a chain.
2. Make more transactions.
3. Restore the chain to the snapshot, or open the snapshot as a second chain.

The two chains then share history up to the snapshot and diverge after it. That is a real fork, which step 3 will visualise.

## Goals

- **Engine.** Each chain approach (01 plain, 02 sequencer) gains two methods:
  - `snapshot(): Promise<ChainDump>`, which returns webevm's `dumpState()`.
  - `restore(dump): Promise<void>`, which calls `loadState()` into the running node.

  For persisted chains, restore also saves the restored state, so a reload keeps it.
- **Snapshots** live in the browser, per chain.
  - Each has: id, chain id, name (default `"<chain name> @ block <n>"`), block height, created time, and the dump.
  - **Snapshot** in the Chains page app bar takes one, with an editable name.
  - **Snapshots** in the app bar opens a list (a native `<dialog>` or side panel) for the selected chain.
  - Each row shows the name, height and time, with these actions:
    - **Open as new chain.** Creates a saved chain of the same type from the dump, named `"<snapshot name> (fork)"`, and selects it.
    - **Restore this chain.** A confirm `<dialog>` warns that blocks after #n will be discarded. It has a checkbox, **checked by default**, labelled "Save current state as a snapshot first", plus Restore and Cancel.
    - **Export** and **Delete**.
- **Export** downloads `<chain-name>-<height>.evmfun.json` from the app bar or a snapshot row:
  ```json
  {"format":"evm.fun/chain","version":1,"exportedAt":"…","chain":{"name":"…","type":"plain|sequencer"},
   "chainId":31337,"engine":"webevm@0.9.1+revm","dump": <webevm dumpState>, "contracts":[{address,name,abi,deployer,txHash}], "source":{…optional}}
  ```
  - BigInt values are encoded as decimal strings with a `"$bigint"` marker. The encoding round-trips exactly.
  - Account keys are **not** included.
- **Import** (app bar, `<input type="file" accept=".json">`) creates a **new saved chain** from a file.
  - The new chain gets the file's chain type and its contract records.
  - These files are rejected with a clear message: invalid JSON, wrong `format`, missing fields, `version` newer than supported, or a chainId mismatch with 31337.
- **Provenance.** Chains created from a snapshot or an import record `source`:
  - `{kind:'snapshot', snapshotName, fromChainName, height}`, or
  - `{kind:'import', fileName, height}`.

  The chain header shows it, e.g. "from snapshot 'before swap' of demo @ #42". Step 3 can use this to group families.
- **Benchmark (ephemeral) chains** can be snapshotted and exported. Opening their snapshot gives a normal saved chain.
- **The running-chain cap applies.** Opening as a new chain and importing go through the registry, so the warn-at-4 / refuse-at-8 cap and its messages apply.

## Non-goals

- Fork visualisation (step 3).
- Automatic or periodic snapshots.
- Sharing between browsers except via files.
- Changing chain type on import.
- Importing foreign formats (anvil, hardhat).
- Including private keys in exports.

## Anti-goals

- **Silent data loss.** Restoring discards blocks only after an explicit confirm, and the default saves first.
- **A file that half-imports.** Validate fully before creating anything. On any failure, nothing is created.
- **A restore that leaves UI state stale.** After a restore, every view, the selected-block URL (navigate to `/chains`), the cached height and the balance refresh.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Build on webevm `dumpState`/`loadState` via new approach methods | Exact state, including blocks and receipts. Small code |
| B | Replay recorded transactions | Slow, and needs a tx log we don't keep |
| C | Copy the IndexedDB database | Only works for persisted chains, and the format is opaque |

## Spike (first task)

Prove these on both chain types, on revm and on the default engine:

1. After `dumpState` → `loadState` into a fresh node, these are identical:
   - `eth_blockNumber`
   - every block's `hash`, `parentHash` and tx hashes
   - receipts
   - balances
2. The dump survives the JSON round trip through our encoding unchanged.
3. Restoring into a running node discards later blocks.

Record the outcome in an ADR. **If block hashes don't survive**, step 3 matches shared history by height plus tx hashes instead. Note that in the ADR. This design is unaffected.

## Constraints

As before:
- tokens only (no raw colours)
- contrast tests
- no new runtime dependencies
- DOM-free unit tests for pure parts: encode/decode, validation, default names, provenance text, snapshot store
- no invented data
- board, ADR and risks kept current
- the full `bun test`, `make build` and tsc on changed files at every task end

## Calls made by Claude (correct if wrong)

- **Snapshot storage.** Snapshots live in IndexedDB through the existing `kv` store (namespace `snapshots`), falling back to memory when storage is unavailable. Deleting a chain also deletes its snapshots. Opened-as-new chains are independent of the original.
- **Restore in place.** The approach's `restore()` calls `loadState` on the live node, then `persistence.save`. The playground then:
  - navigates to `/chains`
  - refreshes the window, the cached height and the balance

  Sequencer chains drop anything still in their in-flight queue.
- **File naming:** `<chain-name>-<height>.evmfun.json`, with the name slugified.
- **Snapshot size.** There is no hard cap. The UI shows each snapshot's size in KB, and a warning appears above 20 MB.

### Settled after the builder check (Claude's calls)

- **Engines.**
  - The playground always runs revm.
  - The file records `engine` (e.g. `webevm@0.9.1+revm`), and the spike tests whether a dump loads across engines.
    - If it does, import accepts any engine.
    - If not, import rejects a mismatch with a clear message.
  - Record the result in the ADR.
- **Keys on import.**
  - Imports never carry keys. An imported chain is usable at once only if you already hold keys for funded addresses.
  - After an import, if none of your accounts has a non-zero balance on the new chain, the header shows a Notice:

    > "None of your accounts has funds on this imported chain — create an account and fund it to send transactions."

  - That check is one `eth_getBalance` per account; it shows a Notice and changes nothing.
  - No extra funding UI in this step.
- **Sequencer restore.**
  - Restore is refused while the sequencer has transactions in flight. Approach 02 exposes `pending(): number`.
  - The confirm dialog shows "Wait for N pending transactions to settle" and disables Restore.
  - There's no cancel or drain path.
- **Contracts travel with state.**
  - A snapshot record also stores the chain's contract records at snapshot time.
  - **Restore** replaces the chain's contract records with the snapshot's.
  - **Open as new chain** copies them.
  - **Export** includes them, and **import** sets them.
  - **Deleting a chain** deletes its snapshots.
- **Starting from a dump.**
  - `Approach.setup` gains an optional `{dump}`. When it is given, the approach loads the dump instead of applying prefund, and persists it before returning.
  - The registry gets a `createFrom(dump, {name, type, contracts, source})` path that uses it, under the same cap.
  - The shared `@evmb/core` type change is allowed. Defaults keep plan-1 behaviour unchanged, and the CLI is untouched.
- **chainId.** The file carries `chainId`, taken from the dump if present, otherwise 31337. Import rejects anything other than 31337.

## Left to the builder

The panel-vs-dialog choice for the snapshot list, exact layout, icon choices, and how the export download is triggered (a Blob URL is fine).
