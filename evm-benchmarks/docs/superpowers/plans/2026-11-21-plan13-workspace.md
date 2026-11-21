# Top app bar and workspace files: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A permanent top bar (brand, File menu, breadcrumb/title, page actions, chain picker, profile menu) and workspace files: New clears everything, Open replaces it all-or-nothing, Save downloads one `evm.fun/workspace` file.

**Architecture:** The bar replaces the per-page AppBar header and the sidebar's Active context card (pages keep calling `useAppBar`). Workspace logic is UI-free in `src/workspace/` (build, validate, clear, load with backup/restore), built on the chain registry (keep-id `createFrom`, one-at-a-time open/close), the kv stores, accounts, walkthrough runs and `@evmb/orderbook`'s new `Store.entries`.

**Tech Stack:** React 19, react-router 7, Tailwind 4, Bun tests on real webevm chains.

**Spec:** `evm-benchmarks/docs/superpowers/specs/2026-11-21-workspace-appbar-design.md` (its "Settled after the builder check" is binding). ADR-0020. Board t-92.

## Global Constraints

- File: `{ format: 'evm.fun/workspace', version: 1, savedAt, engine, accounts, chains: (ChainFile & { id })[], selection?, snapshots, walkthroughs: { edits, runs }, activeWalkthrough?, orderbook: { table, key, value }[] }`; bigint encoding as `encodeChainFile`; each chain validated with `decodeChainFile`; any error refuses the whole file.
- Not workspace data (kept per browser, never saved/cleared/overwritten): theme, dismissed notices, explorer view, fisheye, walkthrough layout/focus, auto speed.
- Benchmark (ephemeral) chains are not saved.
- Open: validate → confirm → build an in-memory backup → clear → load; on any failure: clear → load the backup → show the error with "Download the file that failed" and "Download your previous workspace".
- Copy: menu items "New", "Open…", "Save", "Import chain…", "Export chain"; New confirm "Start a new workspace? This clears every account, chain, record and walkthrough in this browser." with "Save first" / "Clear" / "Cancel" (Open: "Save first" / "Replace" / "Cancel"); Save file name `workspace-YYYY-MM-DD.json`; first-Save notice "This file contains your accounts' private keys. Playground keys only — never real ones."
- Profile menu: initial avatar, label, ETH balance; account list with balances; "Create account…"; "Manage accounts". Sidebar: navigation only. Swap's in-page "Acting as" stays.
- Phone width: the bar shows brand, File, chain, profile (breadcrumb and actions hidden or wrapped below).
- Tokens only, three themes, contrast tests; keyboard-usable menus (Escape closes, arrows move, focus returns to the trigger); `?chain=&as=` links keep working.
- Every task end: `bun test` from `evm-benchmarks` (R11 exit crash may follow passing tests — rerun until a summary line, max 3), `make build`, tsc on changed files (`bunx --package typescript@5 tsc --noEmit --strict --jsx react-jsx --moduleResolution bundler --module esnext --target es2022 --skipLibCheck --resolveJsonModule <files>`, ignore TS5097 and the known Studio/templates errors).
- Git: `git commit --only -m … -- <paths>` (new files `git add -N`); commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; git writes need `dangerouslyDisableSandbox: true`; never commit `design/`.

## Review Focus

1. **Round trip.** Save → New → Open restores accounts (keys), every chain's state and id, contracts, assets, snapshots, walkthrough edits/runs/active, order-book rows and the selection — a `?chain=` link and a resumed walkthrough still work.
2. **Failed Open.** A file whose third chain fails to load leaves the previous workspace fully restored.
3. **More than 8 chains** on both Save and Open.
4. **Every page still renders** with the bar (titles, crumbs, chips, page actions incl. Swap's Acting as, Trade's venue switch).
5. **Per-browser settings untouched** by New and Open.

---

### Task 1: Top app bar and profile menu

**Files:** Create `src/components/TopBar.tsx`, `src/components/Menu.tsx` (accessible menu), `src/components/ProfileMenu.tsx`, `src/components/ChainPicker.tsx` (from ContextBox's chain select); modify `App.tsx` (bar above the sidebar+main; sidebar navigation only), `components/AppBar.tsx`/`state/appBar.tsx` (the page config renders inside the bar), remove `ContextBox`/`ContextStrip` usage; tests `test/topbar.test.ts`.
- File menu present with its items wired to no-op placeholders that Task 3 fills (disabled, not hidden) — or leave a typed hook for Task 3.
- [ ] Failing tests: SSR of the shell shows brand, File, a page title from `useAppBar`, the chain picker and the profile trigger; the profile menu lists accounts with labels and "Create account…" / "Manage accounts"; the Menu component's keyboard behaviour (pure reducer); pages' app-bar configs still render (Review Focus 4 for a few representative pages).
- [ ] RED → implement → GREEN. Commit.

### Task 2: Workspace file — build and validate

**Files:** Create `src/workspace/{types,build,validate}.ts`; modify `packages/orderbook/src/store.ts` (+ `entries(table)` on Store, memory and IndexedDB, conformance test), `src/chain/registry.ts` (keep-id `createFrom`, a way to open→dump→close a chain that isn't live, without breaking LIVE_MAX); tests `test/workspace.test.ts`.
**Interfaces — Produces:** `buildWorkspace(env): Promise<WorkspaceFile>`; `encodeWorkspace(f): string`; `validateWorkspace(text, opts): { ok: WorkspaceFile } | { errors: string[] }`.
- [ ] Failing tests on real chains: build includes everything listed (non-ephemeral chains only) with ids; 9 chains build without tripping LIVE_MAX (Review Focus 3); validation refuses a bad envelope and a bad chain with a message naming it; orderbook `entries` in both stores.
- [ ] RED → implement → GREEN. Commit (bun.lock alone if it changes).

### Task 3: New / Open / Save, File menu wiring

**Files:** Create `src/workspace/{clear,load}.ts`, `src/components/WorkspaceDialogs.tsx`; modify `TopBar.tsx` (File menu actions; Import/Export chain reuse the Chains page functions), `state.tsx` (selection after load beats a stale `?chain=`); tests extend `test/workspace.test.ts`.
**Interfaces — Produces:** `clearWorkspace(env)`; `loadWorkspace(f, env)` (one chain at a time; keep ids); `openWorkspace(text, env) → { ok } | { error, previous: string }` (backup/restore).
- [ ] Failing tests: Review Focus 1 (save → clear → load round trip, then a walkthrough resumes and a link's chain resolves); Review Focus 2 (inject a failure on the third chain → previous workspace restored exactly); Review Focus 3 on load; Review Focus 5 (per-browser keys untouched); New with "Save first" produces the same file as Save.
- [ ] RED → implement → GREEN. Commit.

### Task 4: Docs and checklist

Web README (File menu, workspace file contents, what's per-browser, keys warning), ADR-0020 consequences, risks (file contains keys; size with snapshots/history; Open replaces), board t-92 Done. Browser checklist in the report: menus by keyboard, phone width, three themes, Save → New → Open, a failed Open, Import/Export chain from the menu.
- [ ] Write, regenerate cards, full test + build. Commit.
