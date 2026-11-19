# Assets as first-class objects: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `@evmb/assets` package (asset identity, a metadata registry over a KV interface, live chain reads, calldata) and a playground Assets page that follows `design/step1/`.

**Architecture:**
- The package is engine-neutral and stores only identity and metadata. Live values are read on demand through an EIP-1193 `request` function and are never cached.
- The web app plugs its existing `kv` into the package.
- Asset records travel with snapshots, forks and files like contract records do.
- The Assets page composes the package with the existing `signAndSend` tx path.

**Tech Stack:** Bun 1.3.13 workspace, TypeScript, viem, webevm 0.9.1 (tests), solc 0.8.38 + OpenZeppelin 5.6.1 (artifacts), React 19 + Tailwind 4.

**Spec:** `evm-benchmarks/docs/superpowers/specs/2026-11-19-assets-design.md`. Its "Settled after the builder check" section is binding. The mockup is `evm-benchmarks/design/step1/` (Step1.png, Assets.dc.html); it is git-ignored, never commit it, and its look wins over this plan.

## Global Constraints

- **`@evmb/assets` boundaries:**
  - It imports nothing from `packages/web`, and nothing touching the DOM, React or IndexedDB.
  - Its runtime dependency is `viem` only. `webevm` and `@evmb/contracts` are devDependencies.
- **Identity:**
  - `AssetId` is `` `${chainId}:native` `` or `` `${chainId}:${address.toLowerCase()}` ``.
  - `chainId` is the playground `ChainInfo.id` (a UUID), never the EVM chain id 31337.
- **Storage:** the namespace is `assets:<chainId>`, keyed by the lowercase address.
- **Native:** it is never stored. It is listed last, with symbol `ETH`, name `Native coin`, 18 decimals, origin `native`, issuer text `genesis` and address text `native — no contract`.
- **Live values** (supply, balances, allowances) are never written to the store.
- **Web constraints:**
  - tokens only (no raw colours), and the contrast tests keep passing
  - no new runtime dependencies in `packages/web` beyond the workspace `@evmb/assets`
- **Data:** no invented data; every number shown comes from a chain read or a stored record.
- **Ephemeral (benchmark) chains** get no asset writes.
- **Copy, verbatim from the mockup:**
  - "An allowance lets a spender move up to that much of the owner's {SYM}. Swaps, pools and order books will need one."
  - "No allowances on {SYM} yet."
  - "ETH is the chain's native coin, not an ERC-20, so it has no allowances. Contracts receive it as msg.value attached to a call."
  - "Unlimited (max uint256)"
  - "Currently allowed: …"
  - "read with balanceOf() at latest block" (native: `eth_getBalance`)
  - "Assets on {chain} · {n}"
- **Every task end:**
  - the full `bun test` (run unsandboxed if Bun crashes in the sandbox, and say so)
  - `make build`
  - tsc on the changed files: `bunx --package typescript@5 tsc --noEmit --strict --jsx react-jsx --moduleResolution bundler --module esnext --target es2022 --skipLibCheck <files>` (ignore TS5097)
- **Docs:**
  - Board `docs/board/board.md` (repo root), cards t-54…t-60: Doing at start, Done at commit, with real `date -u` timestamps, edited by hand.
  - ADR and risks live in `docs/adr/decisions.md` and `docs/risks/risks.md`.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Git writes need `dangerouslyDisableSandbox: true`.
- **Workers:** every test disposes every chain or node it creates (R11: a leaked sequencer chain crashes Bun at exit).

## Review Focus

1. **Spent allowance.** After `transferFrom` spends part of an allowance, the table shows the *remaining* amount (OZ 5 emits no Approval on spend). Pinned by a Task 3 test.
2. **Fork identity.** After open-as-new-chain or import, the new chain's assets carry the new chain id in both `id` and `chainId`, and the parent's list is unchanged. Pinned by a Task 4 test.
3. **Hostile `assets` in an imported file.** Bad entries are rejected with "Invalid file" or a field message, never a throw. A missing `assets` imports fine. Pinned by Task 4 tests.
4. **Importing a non-token address.** An EOA, a non-ERC-20 contract or garbage gives "Not an ERC-20 at 0x…" and adds nothing. Pinned by a Task 3 test.
5. **Decimal input.** Amounts with more fractional digits than the token's decimals, negative values or non-numbers are refused inline, before any signing. Pinned by a Task 5 test of the pure parser.

---

### Task 1: AssetToken contract

**Files:**
- Create: `packages/contracts/src/AssetToken.sol`
- Modify: `packages/contracts/build.ts` (`names`), `packages/contracts/index.ts` (export `AssetToken`)
- Regenerate: `packages/contracts/artifacts/AssetToken.json`
- Test: `packages/contracts/contracts.test.ts` (extend)

**Interfaces:**
- Produces:
  - `AssetToken: Contract` from `@evmb/contracts`.
  - Constructor: `(string name_, string symbol_, uint8 decimals_, uint256 initialSupply, address issuer)`. It is `Ownable(issuer)`, mints `initialSupply` (base units) to `issuer`, and `decimals()` returns `decimals_`.
  - `mint(address,uint256)` is onlyOwner.

- [ ] Write the failing tests, following the existing contracts.test.ts style against webevm. Deploy with ("British Pound", "GBP", 2, 1_000_000_000n, issuer) and assert:
  - `decimals()` is `2`
  - `totalSupply()` and `balanceOf(issuer)` are `1_000_000_000n`
  - `owner()` is the issuer
  - `mint` from a non-owner reverts
  - `mint` from the issuer raises `totalSupply`
- [ ] Run and see RED (the AssetToken export is missing).
- [ ] Implement the contract, add it to `names`, add the export, and run `bun run --cwd packages/contracts build`.
- [ ] GREEN. Board t-54. Commit.

### Task 2: `@evmb/assets` registry, identity, detection, calldata

**Files:**
- Create:
  - `packages/assets/package.json` (`@evmb/assets`, `main: src/index.ts`, dep `viem`, devDeps `webevm`, `@evmb/contracts`)
  - `packages/assets/src/{index.ts,types.ts,store.ts,registry.ts,abi.ts,calls.ts}`
- Test: `packages/assets/test/registry.test.ts`, `packages/assets/test/abi.test.ts`
- Modify: root workspace includes `packages/*`; run `bun install`, which updates the lockfile.

**Interfaces:**
- Produces, all from `@evmb/assets`:
  - `type AssetId = string`
  - `type Asset = { id; chainId; kind: 'native'|'erc20'; address?: Address; symbol; name; decimals: number; origin: 'native'|'launched'|'imported'|'deployed'; issuer?: Address; mintable: boolean; addedAt: string }`
  - `interface KeyValueStore { get<T>(ns,key); set(ns,key,value); del(ns,key); list<T>(ns) }` (all return Promises)
  - `memoryStore(): KeyValueStore`
  - `assetId(chainId: string, address?: Address): AssetId`, where no address means native
  - `nativeAsset(chainId: string): Asset`
  - `createAssetRegistry(store)`, returning `{ list(chainId): Promise<Asset[]>; get(id): Promise<Asset|undefined>; add(a: Asset): Promise<void>; remove(id): Promise<void>; replace(chainId, assets: Asset[]): Promise<void>; removeChain(chainId): Promise<void> }`
  - `isErc20Abi(abi): boolean` (7 functions: totalSupply, balanceOf, transfer, approve, allowance, decimals, symbol)
  - `isMintable(abi): boolean` (`mint(address,uint256)`)
  - `MAX_UINT256: bigint`
  - `transferCall(asset, to, amount)` and `approveCall(asset, spender, amount)`, each returning `{to: Address; data: Hex}`
  - `mintCall(asset, to, amount)`, returning the same shape
  - `rebase(asset, newChainId): Asset`, which rewrites `id` and `chainId`
- Registry semantics:
  - `list` returns stored tokens by `addedAt`, then native.
  - `add` is idempotent per id: the first record is kept.
  - `remove` of native throws "The native asset can't be removed".
  - `replace` writes first, then prunes stale records, like `contracts.replace`. It ignores native entries.
  - `get` of a native id returns `nativeAsset`.
- Calldata helpers throw "Native asset has no contract" for a native asset.

- [ ] Write the failing tests:
  - `list` on an empty chain is `[native]`.
  - `add` twice keeps one record.
  - The same address on two chains gives two assets.
  - A mixed-case address gives the same id.
  - `replace` prunes and ignores native.
  - `removeChain` empties the chain.
  - Removing native throws.
  - `rebase` changes both fields.
  - `isErc20Abi` is true for viem `erc20Abi` and for the `AssetToken` ABI, and false for an `AtomicSwap` ABI.
  - `isMintable` is true for AssetToken and false for `erc20Abi`.
  - `approveCall(…, MAX_UINT256)` decodes back with viem.
  - `transferCall` on native throws.
- [ ] RED, implement, GREEN. Board t-55. Commit.

### Task 3: Live reads

**Files:**
- Create: `packages/assets/src/read.ts`
- Test: `packages/assets/test/read.test.ts` (a real webevm node; deploy `AssetToken` from `@evmb/contracts`; dispose the node in `finally`)

**Interfaces:**
- Consumes `type Request = (method: string, params: unknown[]) => Promise<unknown>`, exported.
- Produces:
  - `readTokenInfo(request, address)`, returning `{ name, symbol, decimals: number, totalSupply: bigint, owner?: Address }`.
    - It throws `Not an ERC-20 at ${address}` when there is no code (`eth_getCode` is `0x`), or when `symbol`, `decimals` or `totalSupply` revert or fail to decode.
    - `owner` is set only if `owner()` answers.
  - `totalSupply(request, asset)`, returning `bigint | undefined` (native gives `undefined`).
  - `balances(request, asset, holders: Address[])`, returning `Map<Address, bigint>`. Native uses `eth_getBalance`; ERC-20 uses `balanceOf`.
  - `allowances(request, asset)`, returning `{ owner: Address; spender: Address; amount: bigint }[]`.
    - It collects the distinct pairs from `eth_getLogs` (the token address plus the Approval topic, `fromBlock: '0x0'`).
    - It then re-reads `allowance(owner, spender)` for each pair and drops zeros.
    - The order is by first appearance. Native gives `[]`.

- [ ] Write the failing tests:
  - `readTokenInfo` on AssetToken gives its name, symbol, 2 decimals and supply, and `owner` equals the issuer.
  - `readTokenInfo` on an EOA and on the `AtomicSwap` contract each throw `Not an ERC-20 at …`.
  - `balances` for native and for the token match `eth_getBalance` and `balanceOf`.
  - `allowances` after `approve(B, 500)`: B's `transferFrom` of 200 leaves `[{A, B, 300n}]`.
  - `approve(B, 0)` drops the pair.
  - `approve(B, MAX_UINT256)` returns `MAX_UINT256`.
  - `allowances` on native is `[]`.
- [ ] RED, implement, GREEN. Board t-56. Commit.

### Task 4: Assets travel with chains (web chain layer)

**Files:**
- Create: `packages/web/src/assets/registry.ts`, holding `assetRegistry = createAssetRegistry(kv)` and a `createWebAssets(kv)` factory for tests
- Modify:
  - `packages/web/package.json` (dep `@evmb/assets: workspace:*`)
  - `src/chain/chainFile.ts`: optional `assets?: Asset[]` in `ChainFile` and decoded output, plus an `assetError` validator beside `contractError`. Each entry needs: `id` and `chainId` strings ≤ 200; `kind` `erc20` only (native entries are rejected); a valid address; `symbol` and `name` ≤ 200; `decimals` an integer 0–36; `origin` in the set; `mintable` boolean; `addedAt` string; `issuer` an optional address.
  - `src/chain/snapshots.ts`: `Snapshot.assets: Asset[]`, taken with the snapshot and counted in `bytes`.
  - `src/chain/registry.ts`:
    - `createFrom(dump, {…, assets})` writes `assets.map(a => rebase(a, newId))`, and its rollback clears them.
    - `restoreTo` replaces the assets with the snapshot's (`[]` if the snapshot has none).
    - `remove(id)` also calls `contracts.replace(id, [])` and `assets.removeChain(id)`.
  - `src/components/exportFile.ts`, `ImportButton.tsx`, `SnapshotsDialog.tsx`: pass `assets` through.
  - `src/pages/Studio.tsx`: after a deploy, if `isErc20Abi(abi)`, read the info with `readTokenInfo` and `assetRegistry.add({origin: 'deployed', issuer: deployer, mintable: isMintable(abi), …})`. Skip ephemeral chains.
- Test: `packages/web/test/assets-chain.test.ts`, and extend `chainFile.test.ts`

- [ ] Write the failing tests:
  - Snapshot, then fork: the fork lists the token under the fork's id, the parent is unchanged, and the token's id prefix is the fork's id.
  - Restore drops an asset added after the snapshot.
  - `remove` deletes `contracts:<id>` and `assets:<id>`.
  - `createFrom`'s storage-failure rollback leaves no `assets:<id>` rows.
  - Encode/decode round-trips `assets`.
  - A file without `assets` decodes with `assets` undefined.
  - Each bad field is rejected without throwing: a native entry, a bad address, `decimals: 99`, a 201-character symbol, and `{"toString":1}`.
- [ ] RED, implement, GREEN. Board t-57. Commit.

### Task 5: Assets page — list, header, balances, Send

**Files:**
- Create:
  - `src/pages/Assets.tsx`
  - `src/assets/ui.ts` (pure: `glyphFor(symbol)`, `badgeTone(id)` from a fixed set of token pairs, `formatAmount(v: bigint, decimals, dp?)`, `parseAmount(text, decimals)` returning `{ok: bigint} | {error}`, `shares(values: bigint[])` returning a percentage per value, `issuerText(asset, accounts)`)
  - `src/components/SendDialog.tsx`
- Modify:
  - `src/App.tsx`: add a **Markets** group containing only **Assets**, with an icon added to the existing icon set.
  - `src/routes.ts`: `/assets`, with selection via `?asset=<id>`.
  - `src/index.css`: badge tone tokens for all three themes, if needed.
- Test: `packages/web/test/assets-ui.test.ts`

**Behaviour:**
- **Reconcile:** on mount, run once per chain id (guarded by a ref). For each contract record with `isErc20Abi(abi)` that isn't yet an asset, call `readTokenInfo` and add it with origin `deployed`, issuer `deployer`, and `mintable` from the ABI. Errors per record are skipped. Not run on ephemeral chains.
- **Layout:** as in the mockup.
  - App-bar breadcrumb `<chain> / Assets`; the actions (Import, Launch) come in Task 6.
  - The left column is "Assets on {chain} · n" with cards.
  - The header card shows supply, decimals and issuer.
  - The balances card has one row per account from `accounts.list()`: share bar, amount, and Send.
  - The native ETH note card appears where the allowances card would be.
- **Refresh** on `balanceTick`. With no chain selected, the page shows the existing "select a chain" pattern.
- **Send dialog:** a "to" picker (your accounts or "Other address…", with checksum validation) and an amount (`parseAmount`). It signs with that row's account through `signAndSend` (`transferCall`, or `{to, value}` for native), then calls `bumpBalance()`.

- [ ] Write the failing tests for `ui.ts`:
  - `glyphFor`: GBP→£, USD→$, EUR→€, ETH→Ξ, `abc`→A.
  - `formatAmount(999000n, 2)` is `"9,990.00"`. Native at 8 dp.
  - `parseAmount`: `'1.5'` at 2 decimals is `150n`. `'1.555'` at 2 decimals, `'-1'`, `'abc'` and `''` are errors.
  - `shares([0n, 0n])` is `[0, 0]`. `shares([3n, 1n])` is `[75, 25]`.
  - `issuerText`: your account gives its label, a foreign address gives the short form, none gives `—`, native gives `genesis`.
- [ ] RED, implement, GREEN. Port the mockup's layout structurally: sizes, spacing, radii and type, translated to tokens. Board t-58. Commit.

### Task 6: Allowances, Import token, Launch asset

**Files:**
- Create: `src/components/ApprovePanel.tsx`, `src/components/ImportTokenDialog.tsx`, `src/components/LaunchAssetDialog.tsx`
- Modify: `src/pages/Assets.tsx`
- Test: extend `packages/web/test/assets-ui.test.ts` with any new pure helper. A likely one is `allowanceLabel(amount, decimals, symbol)`, where `MAX_UINT256` gives "Unlimited".

**Behaviour:**
- **Allowances card:**
  - A table from `allowances()`.
  - **Revoke** sends `approveCall(spender, 0)`, signed by the owner. It is disabled with a `title` reason if the owner isn't your account.
  - The **Approve a spender** panel has: Owner (your accounts), Spender (your accounts plus "Other address…"), Amount, the Unlimited checkbox (`MAX_UINT256`), "Currently allowed: …" (live `allowance` for the chosen pair), and Approve.
  - There is an inline flash on success and an inline error on failure, and the empty state.
- **Import token by address:** a native `<dialog>`.
  - Enter an address, run `readTokenInfo`, and show symbol, name, decimals and supply, or the error.
  - **Add** writes the asset (origin `imported`, `mintable: false`, issuer `owner` if known) and a contract record `{address, name, abi: erc20Abi, deployer: owner ?? zeroAddress, txHash: '0x'}`.
  - An already-registered token shows "Already in assets".
- **Launch asset:** a native `<dialog>` with name, symbol, decimals (default 18), initial supply in whole units (via `parseAmount`), and issuer (your accounts).
  - It deploys `AssetToken` with `signAndSend` (deploy data via viem `encodeDeployData`).
  - On success it writes the contract record and the asset (origin `launched`, `mintable: true`, issuer), then selects the new asset.
- **Dialogs** follow the snapshot dialogs: Esc closes, focus returns to the trigger, and state resets on close.

- [ ] Tests for any new pure helper (RED, then GREEN). Build the components to the mockup. Board t-59. Commit.

### Task 7: Docs, ADR, risks, browser checklist

**Files:**
- Modify:
  - `packages/web/README.md`: an "Assets" section.
  - `evm-benchmarks/README.md`: one line pointing at the package.
  - Create `packages/assets/README.md`, a short API overview.
  - `docs/adr/decisions.md`: a new ADR "Assets: identity + metadata registry, live reads, no cache". It covers the A/B/C choice, UUID chain identity, and Approval-log discovery plus the `allowance()` re-read.
  - `docs/risks/risks.md`: a new risk for allowance discovery scanning all logs from block 0 on every open, which grows with chain history. Controls: playground scale, and paging or the indexer (approach B) when needed.
  - Board t-60.

- [ ] Write the docs. Run the card checks (`node_modules/.bin/{agile,adr,risk-register} card …`) and delete the card JSON. The browser checklist goes in the report. Board t-60. Commit.
