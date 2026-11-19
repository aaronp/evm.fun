# evm-benchmarks Plan 6: Snapshots, restore, import / export

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chains in the playground can be snapshotted, restored to a snapshot (with save-first), opened from a snapshot as a new chain (a fork), exported to a `.evmfun.json` file, and imported from one.

**Architecture:**
- The approaches expose `snapshot()` and `restore(dump)` over webevm's `dumpState`/`loadState`. `setup({dump})` starts a chain from a dump.
- A pure `chainFile` module encodes, decodes and validates the file format.
- The registry gains `createFrom` and `restoreTo`.
- A kv-backed snapshot store holds dumps plus contract records.
- The UI hangs off the Chains page app bar, with native `<dialog>`s.

**Tech Stack:** TypeScript/Bun, webevm 0.9.1 (+revm), React 19, Tailwind 4. No new runtime deps.

**Spec:** `evm-benchmarks/docs/superpowers/specs/2026-11-19-snapshots-design.md`. Its "Settled after the builder check" section is binding.

## Global Constraints

- Colour tokens only (the raw-colour guard and contrast tests stay green). No new runtime dependencies. No invented data.
- **Plan-1 behaviour unchanged.** New approach options and methods are optional. Without them, setup, CLI results and `RunResult` are identical. The CLI is untouched.
- **File format:**
  - `{format:"evm.fun/chain", version:1, exportedAt, chainId, engine, chain:{name,type}, dump, contracts:[…], source?}`
  - BigInts are encoded as `{"$bigint":"<decimal>"}` and must round-trip exactly.
  - Import rejects: invalid JSON, a wrong `format`, missing or ill-typed fields, `version > 1`, `chainId !== 31337`, and an engine mismatch if the spike says dumps don't cross engines.
  - On any rejection, nothing is created.
  - No private keys.
- **File name:** `<slug(chain name)>-<height>.evmfun.json`.
- **Default snapshot name:** `"<chain name> @ block <n>"`.
- **Restore:**
  - A confirm dialog shows "Save current state as a snapshot first", checked by default.
  - Restore is refused while the sequencer has pending txs: show "Wait for N pending transactions to settle" and disable the action.
  - After a restore: navigate to `/chains`, refresh the block window, the cached height and the balance, and replace the chain's contract records with the snapshot's.
- **Snapshots** store `{id, chainId, name, height, createdAt, dump, contracts}` in `kv` namespace `snapshots`. Deleting a chain deletes its snapshots. The UI shows each snapshot's size in KB and warns above 20 MB.
- **Provenance:** `source` is `{kind:'snapshot', snapshotName, fromChainName, height}` or `{kind:'import', fileName, height}`, shown in the chain header.
- **The running-chain cap** (warn 4 / refuse 8) applies to open-as-new and import.
- **Project docs and git:**
  - **Board:** `docs/board/board.md` (strict format). Real `date -u` timestamps, `owner: Claude`, edited by hand. The controller runs the card check.
  - **Branch:** `plan3-playground`. Git writes need the sandbox disabled.
  - **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - **Checks at every task end:** the full `bun test` from evm-benchmarks/, `make build`, and tsc on the changed files:

    `bunx --package typescript@5 tsc --noEmit --strict --jsx react-jsx --moduleResolution bundler --module esnext --target es2022 --skipLibCheck <files>`

    Ignore TS5097 errors and errors that were already there.

## Review Focus

1. **A corrupt or hostile file leaves no trace.** Truncated JSON, wrong format, version 2, chainId 1, missing `dump`, or `dump` of the wrong shape: each gives a clear error and creates no chain, kv row or IndexedDB database. Tests in Task 3 (validation) and Task 4 (`createFrom` atomicity).
2. **Restore then reload.** A persisted chain restored to a snapshot reopens after a reload at the snapshot's height, with the snapshot's contract records. Test in Task 4.
3. **Restore while transactions are pending** on a sequencer chain is refused and loses nothing. Test in Task 2 (`pending()`) and Task 5 (UI guard).
4. **Fork correctness.** Open-as-new from a snapshot gives a chain whose blocks up to the snapshot height have the same hashes as the original's, assuming the spike confirms hash stability. After new txs on each, they diverge. Test in Task 4.
5. **BigInt and size edge cases.** Balances above 2^53, an empty chain at genesis only, and a 2,000-block benchmark chain all round-trip. Tests in Task 3, and the 2k case in Task 1's spike.

---

### Task 1: Spike — dump/load fidelity

Board: add cards t-48…t-53 for Tasks 1–6 (To Do). Then move t-48 through Doing to Done.

**Files:**
- Create: `evm-benchmarks/spike/snapshots.test.ts`
- Modify: `docs/adr/decisions.md` (new ADR "Chain snapshots via webevm dumpState/loadState", with the outcome), `docs/risks/risks.md` (a new risk if anything doesn't hold)

- [ ] **Step 1: Write spike tests.** For each of {plain-like node (auto mining), manual-mined node} × {default engine, revm}:
  - Mine about 5 txs, `dumpState`, then `loadState` into a fresh node with the same options. Every block's `hash`, `parentHash` and tx hashes, the receipts, `eth_blockNumber` and the balances are identical.
  - `JSON.stringify` the dump with a `$bigint` replacer, then parse with the matching reviver. The result deep-equals the original.
  - **Restore into a running node:** dump at height 3, mine 2 more, then `loadState(dump3)`. `eth_blockNumber` is 3, and block 4 is gone (null).
  - **Cross-engine:** dump from the default engine and load into revm, and the reverse. Record whether it works, as a `test.todo` if not.
  - **2,000-block chain:** dump, encode and decode; record the size in KB and the time taken.
- [ ] **Step 2:** Run `bun test spike/snapshots.test.ts`. Record the outcomes, sizes and times in the ADR, including the cross-engine and hash-stability verdicts.
- [ ] **Step 3:** Board. Commit `spike: webevm dump/load fidelity for snapshots`.

### Task 2: Approach snapshot/restore and setup from a dump

Board: t-49.

**Files:**
- Modify: `packages/core/src/types.ts`, `approaches/01-webevm-baseline/index.ts`, `approaches/02-seq-memory/index.ts`
- Tests: each approach's `approach.test.ts`

**Interfaces:**
```ts
type ChainDump = unknown                         // webevm dumpState() result, opaque to core
interface Approach {
  // …existing…
  snapshot?(): Promise<ChainDump>
  restore?(dump: ChainDump): Promise<void>       // loadState into the live node; persists if persistence given
  pending?(): number                             // txs submitted but not yet settled (02: ring + verify in flight; 01: 0)
}
setup(opts: {prefund: Record<Address, bigint>; dump?: ChainDump})   // dump given → load it instead of prefund, persist before returning
```

- [ ] **Step 1: Write failing tests.** For each approach:
  - Snapshot after 3 txs, then 2 more txs, then `restore`: `eth_blockNumber` is back at the snapshot height, and balances match the snapshot.
  - `setup({prefund:{}, dump})` on a new instance gives the same head, hash and balances.
  - **With in-memory persistence:** after a restore and a reopen via `open()`, the chain is at the restored height.
  - **02 only:** `pending()` is greater than 0 between `submit` and `awaitSettled`, and 0 afterwards.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the checks. Also run `bun run bench --approach all --scenario eth-transfer --n 200 --runs 1` and confirm it is still verified.
- [ ] **Step 5:** Board. Commit `feat: approach snapshot/restore and setup from dump`.

### Task 3: Chain file format (pure)

Board: t-50.

**Files:**
- Create: `packages/web/src/chain/chainFile.ts`, `packages/web/test/chainFile.test.ts`

**Interfaces:**
```ts
interface ChainFile { format: 'evm.fun/chain'; version: 1; exportedAt: string; chainId: number; engine: string; chain: {name: string; type: ChainType}; dump: unknown; contracts: ContractRecord[]; source?: ChainSource }
encodeChainFile(f: ChainFile): string            // JSON with {"$bigint": "..."} for every bigint
decodeChainFile(text: string, opts: {engine: string; crossEngineOk: boolean}): {ok: true; file: ChainFile} | {ok: false; error: string}
fileNameFor(chainName: string, height: number): string     // slug + '-' + height + '.evmfun.json'
defaultSnapshotName(chainName: string, height: number): string
provenanceText(src?: ChainSource): string | null           // e.g. "from snapshot 'before swap' of demo @ #42" / "imported from x.evmfun.json @ #42"
```

- [ ] **Step 1: Write failing tests:**
  - a round trip with nested bigints (including 2^64) deep-equals the original
  - each Review Focus 1 rejection gives `ok:false`, with a message naming the problem
  - `fileNameFor("My Chain #1", 42)` gives `my-chain-1-42.evmfun.json`
  - `defaultSnapshotName` works
  - `provenanceText` covers both kinds and `undefined`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. `crossEngineOk` comes from the Task 1 ADR, as a constant in `chainFile.ts`.
- [ ] **Step 4:** Run the checks.
- [ ] **Step 5:** Board. Commit `feat(web): chain file format`.

### Task 4: Snapshot store and registry createFrom / restoreTo

Board: t-51.

**Files:**
- Create: `packages/web/src/chain/snapshots.ts`, `packages/web/test/snapshots.test.ts`
- Modify: `packages/web/src/chain/registry.ts` (`ChainInfo.source?`, `createFrom`, `restoreTo`, `remove` also deletes snapshots), `packages/web/src/contracts/registry.ts` (`replace(chainId, records)`, if not already there)

**Interfaces:**
```ts
interface Snapshot { id: string; chainId: string; name: string; height: number; createdAt: string; dump: unknown; contracts: ContractRecord[]; bytes: number }
createSnapshotStore(kv): { list(chainId): Promise<Snapshot[]>; take(handle: ChainHandle, name?: string): Promise<Snapshot>; get(id); remove(id); removeForChain(chainId) }
registry.createFrom(dump: unknown, o: {name: string; type: ChainType; contracts: ContractRecord[]; source: ChainSource}): Promise<ChainHandle>   // cap-checked; on any failure nothing persisted
registry.restoreTo(id: string, snap: Snapshot, o: {saveFirst: boolean}): Promise<{saved?: Snapshot}>   // refuses if handle.approach.pending?.() > 0
```

- [ ] **Step 1: Write failing tests**, using an in-memory host and kv:
  - take a snapshot: its height and contracts are recorded, and `bytes` is greater than 0
  - `createFrom` gives a new chain whose block hashes up to the height equal the original's (if the spike confirmed hash stability; otherwise compare heights and tx hashes)
  - after 1 new tx on each, the chains diverge
  - **atomicity:** `createFrom` with a bad dump throws, and `list()` and kv are unchanged
  - `restoreTo` with `saveFirst` saves a snapshot of the pre-restore state, rewinds the chain, and replaces its contract records
  - after a restore, a fresh registry and `open` give the restored height
  - `restoreTo` is refused while a stubbed `pending()` returns 3
  - `remove(chainId)` deletes that chain's snapshots
  - `createFrom` at the cap throws the cap message
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the checks.
- [ ] **Step 5:** Board. Commit `feat(web): snapshot store and registry createFrom/restoreTo`.

### Task 5: Snapshot, restore, import and export UI

Board: t-52.

**Files:**
- Create: `packages/web/src/components/SnapshotsDialog.tsx`, `packages/web/src/components/RestoreDialog.tsx`, `packages/web/src/components/ImportButton.tsx`
- Modify: `packages/web/src/pages/ChainsPage.tsx` (app-bar actions and provenance in the header), `packages/web/src/ui/icons.tsx` (camera/snapshot, history/list, download, upload icons)

**Behaviour:**
- **App-bar actions on Chains:**
  - **Snapshot:** a small dialog with a name field, prefilled with the default, then take.
  - **Snapshots:** opens SnapshotsDialog for the selected chain.
  - **Export:** downloads the current chain via a Blob URL.
  - **Import:** a hidden `<input type=file accept=".json,application/json">`.
  - Refresh is kept.
  - The actions are disabled, with a reason in `title`, when no chain is selected.
- **SnapshotsDialog:**
  - Each row shows the name, `#height`, time and size in KB, with a warn Badge above 20 MB.
  - Row actions: Open as new chain, Restore this chain…, Export, Delete (with confirm).
  - An empty state shows when there are no snapshots.
- **RestoreDialog:**
  - Text: "Blocks after #n will be discarded."
  - A checkbox "Save current state as a snapshot first", checked by default.
  - Restore and Cancel buttons. Restore is disabled with "Wait for N pending transactions to settle" while `pending() > 0`.
  - After a restore: navigate to `/chains`, refresh the window, cached height and balance, and show a success Notice.
- **Import:**
  - Read the file, then `decodeChainFile`, then `registry.createFrom`, then select the new chain.
  - Errors show in an alert Notice. A cap error shows the cap message.
  - After an import, if none of the user's accounts has a balance above zero on the chain, show the spec's no-funds Notice in the chain header.
- **Provenance:** `provenanceText(info.source)` appears under the chain name.
- All dialogs are native `<dialog>` with `showModal`. Esc closes them and focus returns to the trigger.

- [ ] **Step 1:** Implement. Pure helpers are already tested, so add a test for any new pure logic, e.g. `restoreBlockedReason(pending)`.
- [ ] **Step 2:** Run the checks.
- [ ] **Step 3:** Board. Commit `feat(web): snapshots, restore, import and export UI`.

### Task 6: README, ADR and the browser checklist

Board: t-53.

- [ ] **Step 1:**
  - Add a "Snapshots, restore, import/export" section to `packages/web/README.md`. It must be accurate to the code. Explain the fork demo: snapshot, transact, restore or open as new chain.
  - Close the ADR and update risks.
  - Run the checks.
- [ ] **Step 2: Browser checklist** (for the controller to give the user):
  - **Snapshot and restore:** snapshot a chain, then transact. Restore with save-first and confirm the height rewinds, the views update and the contracts are right. Reload and confirm it's still restored.
  - **Fork:** open the saved "future" snapshot as a new chain, so you have two chains.
  - **Export and import:** export, then import the file as a new chain, and check the provenance line. Import a bad file and check the error.
  - **Sequencer guard:** on a sequencer chain, try to restore mid-benchmark and check that it's refused.
  - **Accessibility and themes:** check all three themes, phone width, and keyboard use of the dialogs.
- [ ] **Step 3:** Commit `docs(web): snapshots and import/export`.
