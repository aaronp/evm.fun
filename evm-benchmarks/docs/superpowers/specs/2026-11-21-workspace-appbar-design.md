# Top app bar, profile menu and workspace files — design

## Intent

A permanent top bar with a File menu (New, Open, Save) and a profile menu for accounts, so the whole playground can
be reset, saved to one file, and opened again — on this machine or someone else's.

## Decided with Aaron

- A file is the **whole workspace** (A): every account (with keys), every chain with its state, contract and asset
  records, walkthrough edits and runs, and the off-chain order books — one `.json` file.
- **New** clears everything (offering to Save first); **Open…** replaces the current workspace (same offer);
  **Save** downloads it, with a one-time warning that it contains private keys.
- Layout (as sketched and approved): one permanent bar across the top — left: brand, **File ▾**, the page's
  breadcrumb/title; right: the page's actions, the **chain** picker, the **profile** menu. The sidebar becomes
  navigation only (the Active context card goes). Swap's in-page "Acting as" stays (mockup).
- File menu also carries **Import chain… / Export chain** (today's per-chain functions for the selected chain; the
  Chains page keeps its own buttons too).
- Profile menu: the acting account's initial, label and ETH balance; the account list (switch, with balances);
  "Create account…"; "Manage accounts" (the Accounts page).
- Phone width: the bar collapses to brand, File, chain and profile.

## The workspace file

```ts
type WorkspaceFile = {
  format: 'evm.fun/workspace'; version: 1; savedAt: string; engine: string
  accounts: { label: string; address: Address; privateKey: Hex }[]
  chains: ChainFile[]               // each exactly today's evm.fun/chain export (dump, contracts, assets, source), plus its id
  selection?: { chain?: string; account?: Address }
  snapshots: Snapshot[]             // the chains' saved snapshots
  walkthroughs: { edits: Walkthrough[]; runs: Run[] }
  orderbook: { table: string; key: string; value: unknown }[]   // every row of the off-chain order-book store
  activeWalkthrough?: string        // the walkthrough in progress, if any
}
```

- Reuses `encodeChainFile`'s bigint encoding and `decodeChainFile`'s validation per chain; the workspace validator
  checks the envelope and each part, and refuses the whole file on any error (nothing is half-opened).
- **Chain ids are kept** on Open so `?chain=` links, walkthrough runs and order-book scopes stay valid. Opening
  replaces the workspace entirely, so there's nothing to collide with.
- Benchmark (ephemeral) chains are not saved.

## New / Open / Save behaviour

- **New:** confirm dialog "Start a new workspace? This clears every account, chain, record and walkthrough in this
  browser." with **Save first**, **Clear**, **Cancel**. Clear disposes live chains, deletes their persisted state,
  clears the kv stores, the order-book store, accounts and walkthrough data, then reloads to an empty app.
- **Open…:** a file picker; validate first (errors listed, nothing changed); then the same confirm (Save first /
  Replace / Cancel); then clear as New and load: accounts, then each chain via the existing `createFrom` path keeping
  its id, snapshots, records, walkthroughs, order-book rows, prefs, selection; then reload.
- **Save:** downloads `workspace-YYYY-MM-DD.json`. First time per browser: a notice "This file contains your
  accounts' private keys. Playground keys only — never real ones." (Accounts page already says the same).

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **Whole workspace file (chosen)** | One file with everything | Complete, shareable, matches "File" semantics; contains keys |
| Current chain only | Today's export/import | Small; New wouldn't reset accounts or walkthroughs |
| Per-store export | Separate files per area | Flexible, but Open becomes a multi-step chore |

## Non-goals

- Merging a workspace into the current one (Open replaces).
- Encrypting the file or keys.
- Cloud sync.

## Constraints

Tokens only, three themes, contrast tests, phone width; real data only; never commit `design/`; commit with
`git commit --only`; links (`?chain=&as=`) keep working; walkthroughs, Get started and all pages keep working with
the bar.

## Left to the builder

- Menu component details (keyboard: Escape closes, arrow keys move, focus returns to the trigger).
- How each page's existing `useAppBar` config maps into the bar (title/crumbs/chip/actions), without changing pages
  more than needed.

## The approved layout sketch

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣ EVM Playground   File ▾   dave / Swap · GBP/USD          [page actions]   ⛓ dave ▾   (B) bob ▾ │
├──────────┬───────────────────────────────────────────────────────────────────┤
│ Setup    │                                                                   │
│ Build    │   page                                                            │
│ Markets  │                                                                   │
└──────────┴───────────────────────────────────────────────────────────────────┘
```

## Settled after the builder check (Claude's calls)

1. **Open is all-or-nothing.** Before clearing, Open builds the current workspace file in memory (the Save path). If
   loading the new file fails at any point, it clears again and restores that backup, then shows the error with a
   "Download the file that failed / Download your previous workspace" choice. New does the same only if its own
   clear fails (it can't half-fail otherwise).
2. **More than 8 chains works.** Save and Open handle chains one at a time: open (or create) → dump/load → close
   unless it is the chain to select. The registry gains whatever close/keep-id options that needs.
3. **Per-browser settings are not workspace data.** Theme, dismissed notices (incl. the private-key warning), explorer
   view, fisheye, walkthrough layout/focus and the auto speed stay in the browser: not saved, not cleared by New, not
   overwritten by Open. Workspace data = accounts, chains, snapshots, records, walkthrough edits/runs and the active
   walkthrough id, order-book rows, and the selection.
4. **`@evmb/orderbook` gains `entries(table)`** on the `Store` interface (memory and IndexedDB), returning
   `{ key, value }[]`, tested in its conformance suite; Save/Open use it (and `put`) for every table.
5. **Chain ids kept** via a keep-id option on `createFrom`; on reload after Open the file's selection wins over a stale
   `?chain=` in the address.
