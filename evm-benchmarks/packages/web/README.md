# @evmb/web: browser EVM playground

A static, in-browser playground: create accounts and chains, write and deploy Solidity, send transactions, browse blocks, and run the benchmark scenarios. Everything runs client-side (revm-wasm, solc in a worker); there is no server and the built site works from any static host and path.

    make dev     # Vite dev server, http://localhost:5173
    make build   # static site -> packages/web/dist

**Keys:** Playground keys only. They are stored unencrypted in this browser's localStorage. Never use a real key.

Address inputs suggest your accounts and the contracts deployed on the selected chain; free text still works.

## Chain types

- **plain** (approach `01-webevm-baseline`): a stock webevm node. Each transaction is checked (signature recovered), executed and mined into its own block as it arrives, one tx per block. Simple and immediately consistent, but throughput is limited because every tx pays for signature recovery plus a block on a single thread.
- **sequencer** (approach `02-seq-memory`): signatures are verified in parallel in background Web Workers. A single-writer sequencer puts the transactions in a fixed order (an in-memory log feeding a ring buffer), and one executor runs them in batches, mining many transactions per block. Execution trusts the sender recovered by the workers, so signatures are not re-checked.

Measured with the CLI (n=10000, median of 3 runs, `REPORT.md`): ERC-20 transfers (erc20-disjoint) about 3.2k TPS on sequencer vs about 1.3k TPS on plain; eth-transfer about 315 vs 273. These figures are from webevm's default engine, while the playground runs revm, so browser numbers will differ. Trade-offs of the sequencer: each tx waits for its batch, so per-tx latency is higher under load; the ordering log is in memory, so transactions not yet mined are lost on reload.

Both are real EVMs running unmodified Solidity bytecode; in this playground both run on the revm engine. The full comparison, and other architectures to come, are in `evm-benchmarks/REPORT.md`.

## Chains page and explorer

The sidebar links every page and holds the theme switcher; the app bar shows the page title, breadcrumbs and page actions (on Chains, Refresh); the View toggle (table, chain, timeline, fisheye) sits in the explorer card header. **Chains** (`/chains`) combines the chain list and the explorer. Pick a chain on the left (the filter box and tabs narrow the list); the **+** button opens a dialog to create one (Esc closes it and focus returns to **+**), and Delete removes a chain. Below the `lg` breakpoint the list becomes a compact picker above the pane, without the filter box and tabs. The selected chain drives the context box, Studio and Transact. Old `/explorer/...` links redirect to the matching `/chains/...` route.

Chains are either running (they hold an engine in this tab) or stopped. The list shows the **last known height** of a stopped chain, saved whenever it changes, so you can see it without opening the chain. At most 8 chains can run at once: the page warns at 4 and refuses to start more at 8. Nothing is closed automatically; delete one or reload.

The explorer pane has four views on a linear chain, remembered in `localStorage` (`evmb.explorerView`, default Table):

- **Table**: the latest blocks, paged.
- **Chain**: the selected block (or the tip) with up to 3 parents and 3 children, Parent/Child buttons and the left/right arrow keys; when the selection is beyond the head the Parent button becomes "Go to tip".
- **Timeline**: blocks laid out along a time axis.
- **Fisheye**: a magnified list of blocks around the selection; up/down arrows move and Enter opens.

Timeline and Fisheye use the latest 500 blocks; a selected older block still shows in the selected-block panel and Chain view, and the Timeline and Fisheye captions say it is older than the latest 500. The panel lists the block's transactions ("All N transactions" opens the full list).

**Filter:** digits match the block number exactly; hex (with or without `0x`) matches a block-hash prefix. Table hides non-matches within the latest 500 blocks (a caption says so); Chain, Timeline and Fisheye dim non-matches. Enter navigates to a full tx hash, address or block number; other input shows "Not found".

Fork views come later, when there is real fork data to show. The data now exists: see the next section.

## Snapshots, restore, import/export

Four app-bar actions on **Chains** work on the selected chain (Import needs none):

- **Snapshot** saves the chain's current state under a name (default `<chain name> @ block <n>`) in this browser (IndexedDB, `kv` namespace `snapshots`). A snapshot holds webevm's `dumpState` output and the chain's contract records, so blocks, hashes, receipts, balances and deployed contracts all come back exactly.
- **Snapshots** lists the chain's snapshots with block height, time and size in KB. A "large" badge shows above 20 MB. Each row has **Open as new chain**, **Restore this chain...**, **Export** and **Delete**. Deleting a chain deletes its snapshots.
- **Export** downloads the chain as `<chain name slug>-<height>.evmfun.json`.
- **Import** reads such a file as a new chain.

Chains whose approach cannot dump state refuse with "This chain type can't be snapshotted".

**Restore** rewinds the selected chain to a snapshot: the chain's node is replaced by a fresh one loaded from the snapshot, so anything created after it (accounts funded, contracts deployed) is gone. A confirm dialog says blocks after the snapshot's height will be discarded and offers **Save current state as a snapshot first**, checked by default; the saved snapshot is named in the confirmation. After a restore the app goes to `/chains`, the block window, cached height and balance refresh, and the chain's contract records are replaced by the snapshot's. A persisted chain stays restored after a reload.

**Pending guard:** a sequencer chain may hold transactions that are submitted but not yet mined, and restoring would drop or mix them with the restored state. Restore is refused while any are pending: the dialog shows "Wait for N pending transactions to settle", disables Restore, and re-enables it as the count reaches 0. Plain chains mine each tx as it arrives and never have any. The pending guard is unit-tested; in the UI it shows only during an in-flight send.

**The file** (`.evmfun.json`) is JSON: `format: "evm.fun/chain"`, `version: 1`, `exportedAt`, `chainId` (31337), `engine`, `chain` (name and type), `dump` (webevm's state dump), `contracts` (address, deployer, tx hash, name, ABI) and an optional `source`. BigInts are written as `{"$bigint":"<decimal>"}` and read back exactly. It contains **no private keys**; accounts stay in this browser and are not part of a chain. The `engine` is informational: dumps load across engines both ways.

**Import validation:** the whole file is checked before anything is created. These are rejected with a message: invalid or truncated JSON, a wrong `format`, a `version` above 1, a `chainId` other than 31337, missing or wrongly typed fields (including malformed contracts and a `dump` that is not the expected shape), an invalid `{"$bigint": …}` value, and a chain or contract name longer than 200 characters (the name inputs are capped at 200, so exports always re-import). An invalid `source` is rejected; a valid one is ignored (see Provenance). A rejected import shows "Import failed: <reason>" and creates nothing: no chain, no stored row, no database. Opening a snapshot or file as a new chain also fails cleanly (and leaves nothing behind) if the engine cannot load it. New chains count toward the running-chain cap (warn at 4, refuse at 8).

**Provenance:** the chain header shows where a chain came from: `from snapshot '<name>' of <chain> @ #<height>` for an opened snapshot, or `imported from <file name> @ #<height>` for an import. For imports the app builds this from the real file name and the dump's height; a `source` inside the file is ignored.

**No funds:** an imported chain only has the balances in its dump. If none of your accounts holds funds on it, a notice says so: create an account and fund it before sending transactions.

### Demonstrate a fork

1. On a chain, click **Snapshot** and save it (say "before").
2. Send a few transactions (Transact), so the chain moves ahead.
3. Open **Snapshots** and choose **Restore this chain...** on "before". Keep "Save current state as a snapshot first" checked and confirm. The chain is back at the earlier height with the earlier contracts, and the later state is kept as a new snapshot (the "future").
4. Open **Snapshots** again and choose **Open as new chain** on the saved "future". You now have two chains: the original at the earlier height and a new one named "<snapshot name> (fork)" carrying the future, whose header shows its provenance.

Both chains share the same blocks up to the "before" snapshot's height. Send different transactions to each and they diverge. Equal block hashes at a height don't imply equal transactions (webevm's block hash doesn't cover tx content), so compare tx hashes to tell where they split.

## Assets

The **Assets** page lists the selected chain's tokens with the native coin (ETH) last. The header shows name, symbol, address, decimals, issuer and live total supply; the balances card shows every account's balance (read with `balanceOf()` at the latest block, `eth_getBalance` for ETH) and **Send** moves tokens between accounts.

- **Registry:** only identity and metadata are stored (IndexedDB `kv` namespace `assets:<chain id>`, keyed by lowercase address), by `@evmb/assets` (see [packages/assets/README.md](../assets/README.md)). Supply, balances and allowances are always read live.
- **Allowances card:** lists each (owner, spender) with the amount currently allowed, found from `Approval` logs and re-read with `allowance()`. **Approve** sets an allowance (including "Unlimited (max uint256)"); **Revoke** sets it to 0 and is disabled when the owner isn't one of your accounts (it can't sign). ETH has no allowances.
- **Import token by address:** reads the address and adds it if it is an ERC-20 (`symbol`, `decimals`, `totalSupply` answer; `name` falls back to the symbol). An EOA, a non-token contract or garbage gives "Not an ERC-20 at 0x…" and adds nothing. Decimals 0 to 255 are accepted. An imported token also gets a contract record (tx hash zero, deployer = `owner()` or the zero address) if none exists for that address.
- **Auto-adoption:** opening the page on a non-benchmark chain adopts, once per chain per visit, each ERC-20 already recorded as a contract (including those deployed in Studio) as a `deployed` asset. Benchmark (ephemeral) chains never adopt or write assets.
- **Launch asset:** deploys a mintable ERC-20 from an account with a chosen name, symbol, decimals and initial supply, and registers it.
- **Amounts:** typed amounts go through a custom `parseAmount`, which refuses more fractional digits than the token has decimals, negatives and non-numbers inline before anything is signed.
- **Chains:** assets travel with snapshots, exports, forks and imports (the fork's assets carry its own chain id; the parent is unchanged). Benchmark (ephemeral) chains keep no asset records, so Import and Launch are disabled there.

## Swap

**Swap** is a same-chain, escrowed token exchange (`Swap.sol`, helpers in `@evmb/swap`, see [packages/swap/README.md](../swap/README.md); ADR-0016). One Swap per chain.

- **Deploy:** "Deploy Swap.sol" in Studio, or "Deploy Swap.sol?" on the Swap page of a chain that has none. The newest contract record named `Swap` with a Swap ABI is the chain's Swap. Benchmark (ephemeral) chains keep no contract records, so both are disabled there ("Benchmark chains keep no contract records").
- **Page:** pick a base and a quote from the chain's ERC-20s ("Acting as" chooses the account). The book shows asks and bids at four decimals with the spread; click an offer to take it. Make an offer (sell or buy) escrows the give amount ("Create offer & escrow"); a crossing offer gets an advisory note, Swap does not match offers. "Your offers" lists the account's offers in the selected pair only, every status, and can cancel open ones. Offers, balances and allowances are always read from the chain.
- **Taking:** a take is always sendable. A take with too little allowance or balance lands reverted and moves nothing. The page stays put and shows a flash with "View report →".
- **Reports:** the report page explains a take from the chain alone (what happened, balance changes, on-chain record, Download JSON), for a success, a missing allowance and an already taken or cancelled offer. Report links carry the pair (`&base=…&quote=…`), so the price reads quote per base as on the Swap page. Failures are replayed at the parent block while it is inside the playground chain's 256-block state history; older ones fall back to the latest state and say so. A swap's Activity lists offers, takes, cancels, reverted takes and approvals.
- **Chains:** offers live in the contract, so they travel with snapshots, exports, forks and imports; a fork shows the parent's offers and its own Swap record.
- **Limits:** ERC-20 only (no native ETH), each offer fills whole, no named markets, the book, "your offers" and Activity reads grow with chain history (risks R17, R19, R20).

## Themes

Three themes: **dark**, **light** and **paper** (warm off-white). Colours are CSS custom properties (`--c-*`) defined once per theme in `src/theme/tokens.css` and mapped to Tailwind colours in `src/index.css`; components use only those tokens.

The sidebar switcher calls `setTheme()` (`src/theme/theme.ts`), which sets `data-theme` on `<html>` (instant, no reload) and saves the choice in `localStorage` under `evmb.theme`. With nothing stored, the OS `prefers-color-scheme` picks dark or light. A small inline script in `index.html` applies the theme before first paint (keep it in sync with `initialTheme()`). If storage is blocked the choice lasts for the session only.

**Add a theme:** (1) add one `:root[data-theme="name"] { ... }` block to `tokens.css` defining every `--c-*` token; (2) add `'name'` to `THEMES` in `src/theme/theme.ts` (the `Theme` type and the switcher options follow); (3) add its label to the `label` map in `src/components/ThemeSwitcher.tsx`; (4) add `'name'` to the allowed names in the inline script in `index.html`. Then run `bun test`: the contrast test discovers themes from `tokens.css`, fails if they differ from `THEMES`, checks each theme's contrast pairs, and fails if `index.html` misses a name.

Two guard tests:

- `test/contrast.test.ts` checks WCAG contrast ratios for every theme block in `tokens.css`, and that `tokens.css`, `THEMES` and `index.html` list the same themes.
- `test/no-raw-colours.test.ts` fails if any file in `src/` (other than `tokens.css`) contains a hex, `rgb()`/`hsl()` or Tailwind palette colour. Its allowlist is empty and must stay so.

## Links and fix-it actions

Every page's address carries `?chain=<registry id>&as=<persona>` (with the page's own params: `base`, `quote`, `venue`, `auto`, `asset`, …), so a URL reproduces what you were looking at and as whom. `src/components/UrlSync.tsx` keeps them in step both ways (`syncDecision` in `src/links.ts`): opening a link selects the chain and account; switching in the app rewrites the address (replace, no history entry); a navigation that drops them (sidebar, the walkthrough ribbon) gets them re-added. Spec: `docs/superpowers/specs/2026-11-21-links-and-fixes-design.md`.

- **`chain`:** a registry id. An unknown one is ignored with "No chain {id} in this browser". Benchmark chain ids end up in the URL too, but benchmark chains aren't persisted, so after a reload that link warns.
- **`as`:** the account's label when no other account has it, else its checksummed address; either is read (label case-sensitive, address any case). Unknown: "No account {as} in this browser".
- **`back`:** a URI-encoded in-app path (`/swap?…`) to return to after a fix; anything else (a scheme, a host, `//`) is dropped.
- **Back/Forward** switches chain and persona to the ones in that history entry, by design: the address is the source.
- **Fix actions:** a balance shortfall ("Not enough GBP — you have 0.00.") on Swap (make, take), Trade (order form) and Pool (swap, add) offers **Request {amount} {SYM} from {issuer}** when the token's issuer is one of this browser's accounts, isn't you, and holds the shortfall (`requestFix` in `src/fix.ts`). It opens `/assets?chain=&as=<issuer>&asset=&send=<you>&amount=<shortfall>&back=<this page>`: the Send dialog acting as the issuer, prefilled. After the transfer lands it goes back to `back` (as you again) with "Received {amount} {SYM} from {issuer}". In a walkthrough the same fix shows under the step's error in the ribbon.
- **ETH for fees:** `signAndSend` refuses a tx its sender can't pay fees for (gas limit × max fee + value) and throws the node's "insufficient funds for gas …" message; `gasShortfall` (`src/tx/send.ts`) recognises it wherever it is shown, and `<GasFix>` next to each send error (or the ribbon) offers **Request {amount} ETH from {account}**: the native asset's Send from the local account with the most ETH (not you), amount the shortfall rounded up to 0.01 ETH (1 ETH when unknown), none when nobody else holds more; same round trip and notice as tokens.

## Known limits

- The UI stutters during benchmarks: the EVM runs on the main thread.
- In-flight sequencer transactions are lost on reload.
- Benchmark chains are in memory only and are not persisted. Playground chains are persisted (IndexedDB), and the whole chain is re-saved on every change, which is fine at playground scale.
- The dev server must exclude `revm-wasm` from Vite `optimizeDeps` (already set in `vite.config.ts`). Pre-bundling breaks the URL the package uses to locate its `.wasm` file.
- soljson is 10.3 MiB; it loads lazily on the first Compile.
- If storage is blocked the app runs in memory and shows a notice.
