# Assets as first-class objects (exchange roadmap, step 1)

Date: 2026-11-19 · Status: approach A chosen in conversation; written up for the builder check.
Design reference: `design/step1/` (Assets.dc.html, Step1.png). It is git-ignored, and the mockup wins on look.
Branch: `plan3-playground`.

## Intent

This is the first step of an exchange roadmap:
1. assets
2. same-chain swap
3. cross-chain swap (HTLC)
4. liquidity pool (x·y = k)
5. on-chain order book
6. signed orders with off-chain matching
7. cross-chain order book

Every later step names assets, reads balances and needs allowances. So this step gives assets a **stable identity and a small, clean API in its own package**, and adds an **Assets page** in the playground that shows them, following the step-1 mockup.

Keep it pragmatic and simple.

## Goals

- **Package `@evmb/assets`** (`packages/assets`). It is engine-neutral and has no DOM, React or IndexedDB code. Its only runtime dependency is viem, which is already in the workspace.
- **Identity.** An asset is identified by its chain plus its contract.
  - `AssetId` is `"<chainId>:native"` or `"<chainId>:<lowercase address>"`.
  - The same symbol on two chains is two assets, which is what the HTLC step needs.
- **Persistence through a tiny store interface,** defined in the package:
  ```ts
  interface KeyValueStore {
    get<T>(ns: string, key: string): Promise<T | undefined>
    set(ns: string, key: string, value: unknown): Promise<void>
    del(ns: string, key: string): Promise<void>
    list<T>(ns: string): Promise<T[]>
  }
  ```
  - The package ships `memoryStore()` for tests and the CLI.
  - The web app passes its existing `kv` store, which already has this shape.
- **What is stored:** only facts the chain can't answer, one record per asset, in the namespace `assets:<chainId>`:
  ```ts
  type Asset = {
    id: AssetId; chainId: string; kind: 'native' | 'erc20'
    address?: `0x${string}`             // erc20 only
    symbol: string; name: string; decimals: number
    origin: 'native' | 'launched' | 'imported' | 'deployed'
    issuer?: `0x${string}`              // launched/deployed: deployer; imported: owner() if the token answers it
    mintable: boolean                   // ABI has mint(address,uint256)
    addedAt: string                     // ISO time
  }
  ```
  - Symbol, name and decimals are copied from the chain when the asset is added. They are immutable in standard ERC-20s.
  - The native asset (ETH, 18 decimals) is **implicit**. `list(chainId)` always returns it last, matching the mockup, and it is never stored.
- **Registry API:**
  ```ts
  createAssetRegistry(store: KeyValueStore) => {
    list(chainId): Promise<Asset[]>           // tokens by addedAt, native last (mockup order)
    get(id): Promise<Asset | undefined>
    add(asset): Promise<void>                 // idempotent per id
    remove(id): Promise<void>                 // native can't be removed
    replace(chainId, assets): Promise<void>   // snapshot restore/import; write-then-prune like contracts.replace
    removeChain(chainId): Promise<void>
  }
  ```
- **Live reads.** Each read is a pure function taking `request(method, params)` (EIP-1193 style; `ChainHandle.request` already fits). **Nothing live is cached**, so a restore, fork or import can't leave a stale balance.
  - `readTokenInfo(request, address)` returns `{name, symbol, decimals, totalSupply, owner?}`. If the address has no code, or does not answer `symbol`, `decimals` and `totalSupply` like an ERC-20, it throws "Not an ERC-20 at 0x…".
  - `totalSupply(request, asset)`: native gives `undefined`.
  - `balances(request, asset, holders)` returns a Map from holder to bigint. It calls `eth_getBalance` for native and `balanceOf` for ERC-20, one call per holder.
  - `allowances(request, asset)` returns `{owner, spender, amount}[]`.
    - It collects the distinct (owner, spender) pairs from the token's `Approval` logs, using `eth_getLogs` from block 0.
    - It then reads the current `allowance(owner, spender)` for each pair and drops zeros.
    - The re-read matters: OpenZeppelin 5's `transferFrom` spends an allowance without emitting `Approval`, so the log values alone go stale.
- **Calldata only, no signing.** The package returns `{to, data}` for `transfer`, `approve` (revoke is `approve(spender, 0)`) and `mint`. The app signs and sends through its existing tx path.
- **Detection:**
  - `isErc20Abi(abi)` is true when the ABI has `totalSupply`, `balanceOf`, `transfer`, `approve`, `allowance`, `decimals` and `symbol`.
  - `isMintable(abi)` is true when it has `mint(address,uint256)`.
- **Launch token:** a new contract `packages/contracts/src/AssetToken.sol`.
  - It is ERC20 + Ownable.
  - The constructor is `(name, symbol, decimals_, initialSupply, issuer)`. It mints `initialSupply` to `issuer` and overrides `decimals()`.
  - It has an owner-only `mint`.
  - It is precompiled into `artifacts/` by the existing build, so no solc runs in the browser.
- **Playground Assets page** (`/assets`), following the mockup:
  - **Sidebar:** a new **Markets** group containing only **Assets**.
  - **App bar:** a breadcrumb `<chain> / Assets`, plus two actions:
    - **Import token by address:** a dialog takes the address and runs `readTokenInfo`. It shows the result, or the error, before adding the token.
    - **Launch asset:** a dialog takes name, symbol, decimals (default 18), initial supply in whole units, and the issuer account. It deploys AssetToken and registers the token as `launched`.
  - **Asset list:** "Assets on `<chain>` · n". Each card shows the glyph badge, symbol, and kind (`ERC-20 · Mintable`, `ERC-20` or `Native`).
  - **Header card:** big badge, symbol, name, address (native shows "native — no contract"), total supply, decimals, and issuer. The issuer shows your account's name if it is yours, otherwise a short address, or "—" if unknown.
  - **Balances:** one row per account of yours, with the name and short address.
    - A bar shows that account's share of the total across the rows. The amount is formatted with the token's decimals; native is shown to 8 dp.
    - Each row has **Send** (transfer, signed by that row's account; for ETH a value transfer). The "to" picker lists your accounts or takes another address.
    - The caption reads "read with balanceOf() at latest block", or "eth_getBalance" for native.
  - **Allowances** (ERC-20 only):
    - The explanatory line from the mockup, then an Owner / Spender / Allowance table built from `allowances()`.
    - Max uint256 shows as "Unlimited".
    - Each row has **Revoke**, signed by the owner, which must be one of your accounts; otherwise it is disabled with a reason.
    - The "Approve a spender" panel has: Owner (your accounts), Spender (your accounts or "Other address…"), Amount, an "Unlimited (max uint256)" checkbox, "Currently allowed: …", and **Approve**.
    - When there are none, it shows "No allowances on X yet."
    - For native, the allowances card is replaced by the mockup's ETH note ("ETH is the chain's native coin, not an ERC-20…").
  - **Refresh:** after any tx the page sends, it re-reads, using the existing `balanceTick`.
- **Discovery of existing tokens:**
  - Studio's deploy path also calls `assets.add` (origin `deployed`) when the deployed ABI passes `isErc20Abi`.
  - Opening the Assets page reconciles once: any recorded contract that passes `isErc20Abi` and is not yet an asset is added, with its info read from the chain. Chains created before this step therefore show their tokens.
- **State travels with chains:**
  - Snapshots store `assets` beside `contracts`.
  - Open-as-new-chain and import copy them, and restore replaces them.
  - Export writes an optional `assets` field and keeps `version: 1`, because the field is additive. Import validates it under the same hostile-input rules as `contracts`; if it is missing, discovery reconciles from contracts.
  - Deleting a chain calls `removeChain`.

## Non-goals

- Listing every holder of a token. That needs Transfer-log indexing (approach B), deferred until the order book needs it.
- Markets pages beyond Assets: New market, Trade and Settlement in the mockup's sidebar are later steps.
- Mint UI. The calldata helper exists for the swap and pool steps; the page doesn't expose minting.
- Token logos, prices and USD values.
- Non-standard tokens (fee-on-transfer, rebasing, ERC-777 hooks).
- A user-editable glyph or colour. Both are derived; see "Left to the builder".

## Anti-goals

- **Stale state.** A balance or allowance shown after a restore, fork or switch must never be one that the current chain doesn't hold. Because live values are never cached, this holds by construction.
- **Duplicate identities.** The same token never appears twice, and different chains never collide. Addresses are lowercased and the chain id is part of the identity.
- **Invented data.** Every number shown comes from a chain read or a stored record, and nothing is a placeholder.
- **A web dependency in the package.** `@evmb/assets` must import nothing from `packages/web`.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | A small package over a KV interface. The registry stores only identity and metadata; live values are read on demand | Simple and can't go stale. Later steps reuse the identity and read functions. "Every holder" is not possible yet |
| B | A + an indexer caching balances, holders and allowances in the store | Fast holder lists, but cache invalidation on restore, fork and import. It can be added later behind the same API |
| C | No registry: filter the existing contract records for ERC-20s | Smallest now, but nowhere for imports, issuer or native, and no identity for swaps. Step 2 would rebuild A |

## Constraints

As in earlier steps:
- tokens only (no raw colours)
- contrast tests
- no new runtime dependencies
- DOM-free unit tests for the package; it runs against a real webevm node in tests, as the approaches do
- the mockup's look wins over this brief
- board, ADR and risks kept current
- the full `bun test`, `make build`, and tsc on changed files at every task end
- an ADR records "Assets: identity + metadata registry, live reads, no cache"

## Calls made by Claude (correct if wrong)

- **AssetId** is a string (`chainId:address`), not an object, so it can be a key and travel through URLs and files unchanged.
- **The native asset is implicit,** not stored, so it can't be deleted or drift.
- **Decimals default to 18 in Launch,** matching ERC-20 convention. The mockup's GBP uses 2, and the field is editable.
- **Allowance discovery** scans `Approval` logs from block 0 on every page open. Playground chains are small, and paging it is a later concern (noted as a risk).
- **Send and Approve** reuse the existing tx path and account keys. Only accounts you hold appear as signers.
- **The `assets` field in chain files** is optional within version 1. Older files import fine and are reconciled from contracts.
- **The issuer of an imported token** comes from `owner()` if the token answers it, otherwise it shows "—".

### Settled after the builder check (Claude's calls)

- **`chainId` means the playground chain's id** (`ChainInfo.id`, a UUID), not the EVM chain id. Every playground chain is EVM 31337, so only the UUID tells chains apart.
  - Open-as-new-chain and import **rewrite** each copied asset's `id` and `chainId` to the new chain.
  - A token on a fork is therefore a different asset from the same address on its parent. That is what the HTLC step needs.
- **Native header text follows the mockup:** name "Native coin", issuer "genesis", supply "—", address "native — no contract".
- **Launched and imported tokens are also contract records,** so Transact, Explorer names and reconcile all see them.
  - A launched token records the AssetToken ABI.
  - An imported token records viem's standard `erc20Abi` and has `mintable: false`, so its kind shows as "ERC-20".
- **Deleting a chain removes its contract records and its assets,** closing an existing gap: `registry.remove` never deleted `contracts:<id>`.
- **Chain-layer changes:**
  - `createFrom`, `restoreTo`, `Snapshot` (including the `bytes` estimate), `ChainFile` (with an `assetError` validator beside `contractError`), `ImportButton`, `SnapshotsDialog` and `exportFile` all gain `assets`.
  - `createFrom`'s rollback also clears the assets.
  - Older snapshots and files have no `assets`; treat that as `[]`, and reconcile rebuilds it from contracts.
- **Ephemeral (benchmark) chains** get no asset writes, as with `recordHeight`.
- **Reconcile** runs once per chain per page mount. The issuer comes from the contract record's `deployer`.
- **Signers:** "your accounts" means the global `accounts.list()`.
- **Amounts:** Send and Approve take decimal units, parsed by a custom `parseAmount` (not viem `parseUnits`; see the ADR) against the token's decimals, with an inline error if invalid. Decimals 0 to 255 are accepted.
- **"Other address…"** works as a spender: a checksum-validated address input.
- **Test dependency:** `@evmb/assets` has webevm as a **devDependency** only, for tests against a real node.
- **`isErc20Abi`** is the package's 7-function check. Transact's own `isErc20` (Erc20Card.tsx) is left alone.
- **Routing:** `/assets?asset=<id>`, following Transact's `?contract=` pattern.
- **Breadcrumb:** the page passes `<chain> / Assets` itself.
- **`AssetToken`** is added beside `MintableToken`, which the swap tests use. It is registered in `packages/contracts` `build.ts` and `index.ts`.

## Left to the builder

- **Glyph and colour:**
  - The glyph is derived from the symbol: £ for GBP, $ for USD, € for EUR, Ξ for ETH, otherwise its first letter.
  - The colour comes from a small fixed set of token pairs, chosen by hashing the AssetId.
- The exact dialog layouts.
- Whether the Assets page lives under `/assets/:assetId` or keeps the selection in state.
- How the reconcile-on-open is debounced.
