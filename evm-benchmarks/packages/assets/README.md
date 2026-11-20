# @evmb/assets

Asset registry for the playground: **identity and metadata only**. Supply, balances and allowances are read live from the chain and never stored.

Runtime dependency: `viem` only. No DOM, React or IndexedDB; storage is injected as a `KeyValueStore` (`memoryStore()` for tests, the web `kv` in the app).

- **Identity:** `assetId(chainId, address?)` gives `` `${chainId}:native` `` or `` `${chainId}:${address.toLowerCase()}` ``. `chainId` is the playground `ChainInfo.id` (a UUID), not the EVM chain id 31337. `rebase(asset, newChainId)` re-keys an asset for a fork or import.
- **Registry:** `createAssetRegistry(store)` has `list(chainId)` (stored tokens by `addedAt`, native last), `get`, `add` (first record wins), `remove`, `replace(chainId, assets)`, `removeChain`. `replace` keeps only the known `Asset` fields (imported files are untrusted). The web app adopts ERC-20s recorded as contracts (including Studio deploys) as `deployed` assets, never on benchmark chains. Records live in namespace `assets:<chainId>`, keyed by lowercase address. Native (`nativeAsset(chainId)`: ETH, 18 decimals) is never stored.
- **Reads** (all take a `request(method, params)` function): `readTokenInfo` (throws `Not an ERC-20 at 0x…` for an EOA, a non-token contract or garbage), `totalSupply`, `balances` (`balanceOf` at `latest`, `eth_getBalance` for native), `allowances`.
- **Allowances:** `Approval` logs from block 0 give the (owner, spender) pairs; each pair is re-read with `allowance()`, because OpenZeppelin 5 `transferFrom` emits no `Approval` when it spends. Zeros are dropped. The scan grows with chain history (risk R16).
- **Calls:** `transferCall`, `approveCall`, `mintCall`, `MAX_UINT256`. `isErc20Abi` / `isMintable` classify an ABI.

Tests: `bun test packages/assets`.
