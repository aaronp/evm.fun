# Onboarding codes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins issue, list and revoke access codes in an `Onboarding` contract on root; anyone redeems one to get a grant, and the worker creates a chain only when root says `isDeployAllowed(signer, chainId)`; a new app (from the prototype) and a headless test drive it through shared `@evmb/keys` and `@evmb/workspace` libraries.

**Architecture:** Contracts (`IAllows`, `AllowList`, `Onboarding`) on root, found via root's Aliases (`onboarding`). The worker gains a `redeem` form of `POST /chains` (precheck + mine the redeem on root, then introspect the grant, then create). `@evmb/keys` hides signers behind `KeyStore`/`KeyScope` with passphrase-encrypted storage; `@evmb/workspace` is the UI-free app layer; `@evmb/app` is thin React over it.

**Tech Stack:** Solidity 0.8.38 (solc build in packages/contracts), Bun, TypeScript, viem, webevm 0.9.1 / revm-wasm 0.3.1, WebCrypto, IndexedDB, React 19 + Vite.

**Spec:** `docs/superpowers/specs/2026-11-25-onboarding-codes-design.md`

## Global Constraints

- The worker trusts only root's Onboarding (the address `Aliases.get("onboarding")` on root). evm.fun (`packages/web`) and the existing `claim` form of `POST /chains` are unchanged.
- Code format on chain: 4–16 chars of `A–Z 0–9`; `codeHash = keccak256(bytes(code))`. Apps normalise: drop spaces and `-`, upper-case. Generated codes: 6 digits. Shown as `205 117` (6 digits split 3+3), else as stored.
- `uses` 1–1000. Valid-for options: 1 minute, 10 minutes, 1 hour, 1 day, 1 week (default 1 hour). Vouch code: 1 use, 10 minutes.
- `chainId`: lowercase UUID, `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`.
- Revert/refusal reasons (exact): `no such code`, `code expired`, `code used up`, `code revoked`, `bad code`, `bad chain id`, `chain id taken`, `issuers only`, `not allowed to create this chain`.
- Keys: AES-256-GCM; AES key = HKDF-SHA256(grant.secret, salt, info `"vault-key-encryption"`, 32 bytes); passphrase secret = PBKDF2-SHA256(passphrase, its own salt, 600000 iterations, 32 bytes). WebCrypto only; no new crypto dependency. Wrong passphrase → `WrongPassphrase` error, message `Wrong passphrase`.
- `@evmb/keys` depends on viem only; `@evmb/workspace` on node, contracts, keys; neither holds UI copy or React. `packages/node/src/*` and `packages/keys/src/*` use no `bun:*`/`node:*`.
- The app follows the prototype (`design/prototype/Prototype.dc.html`) faithfully: its tokens, spacing, radii, copy. `design/` is never committed. Local only (dev worker `http://127.0.0.1:8799`, overridable by `VITE_WORKER_URL`).
- Commit with `git commit --only -m … -- <paths>` from the git root (`chain-perf`), messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `design/`, `.env.*`, `.run/`, root `package.json`, `relay/`, `_site/`, `docs/adr/card.json`, `docs/schedule/card.json`. `bun.lock` changes may be committed. Tests per package (web/app files individually if Bun segfaults, R11).

## Review Focus

1. **A non-issuer's redeem form `POST /chains` for a `chainId` someone else was granted** → 403 `not allowed to create this chain`; the granted owner can still create it.
2. **A create that fails after the redeem was mined** (e.g. a bad dump) → the grant stays; resending without `redeem` creates the chain; the use is spent only once.
3. **A code typed as `let-sue-in` / ` 205-117 `** → normalised to `LETSUEIN` / `205117` and accepted; `ab` or 17 chars → `bad code`, refused before any tx.
4. **A wrong passphrase, then the right one** → first throws `Wrong passphrase` and leaves storage untouched; second signs.
5. **The last issuer removing themselves from the AllowList** → refused (the list would lock).

---

### Task 1: Contracts — IAllows, AllowList, Onboarding

**Files:**
- Create: `packages/contracts/src/IAllows.sol`, `src/AllowList.sol`, `src/Onboarding.sol`
- Modify: `packages/contracts/build.ts` (`names` += `AllowList`, `Onboarding`; IAllows compiles as an import), `packages/contracts/index.ts` (export `AllowList`, `Onboarding` artifacts like the others)
- Test: `packages/contracts/onboarding.test.ts` (style of `chainaccess.test.ts`: webevm node, `blockEnv.timestamp` to move time)

**Interfaces (Produces):**
```solidity
interface IAllows { function allows(address caller, bytes16 subject, address owner) external view returns (bool); }
contract AllowList is IAllows {
  uint8 constant KIND_KEY = 1;
  struct Entity { uint8 kind; bytes32 value; }           // KEY: value = bytes32(uint256(uint160(addr)))
  constructor(Entity[] memory initial);                   // ≥1 entity, all KIND_KEY
  function add(Entity calldata e) external;               // only when allows(msg.sender,0,0), else "not a member"
  function remove(Entity calldata e) external;            // refuses removing the last: "last entity"
  function entities() external view returns (Entity[] memory);
}
contract Onboarding {
  struct Code { bytes32 hash; string label; address issuer; uint64 issuedAt; uint64 expiresAt; uint32 uses; uint32 usesLeft; bool revoked; }
  struct Grant { address by; string chainId; bytes32 codeHash; uint64 at; }
  constructor(IAllows issuers_);
  function issuers() external view returns (IAllows);
  function issue(bytes32 codeHash, string calldata label, uint64 expiresAt, uint32 uses) external;
  function revoke(bytes32 codeHash) external;
  function whyNot(string calldata code, string calldata chainId) public view returns (string memory); // "" = would succeed
  function redeem(string calldata code, string calldata chainId) external;
  function isDeployAllowed(address signer, string calldata chainId) external view returns (bool);
  function codes() external view returns (Code[] memory);
  function grants(bytes32 codeHash) external view returns (Grant[] memory);
  event Issued(bytes32 indexed codeHash, address indexed issuer, uint64 expiresAt, uint32 uses);
  event Revoked(bytes32 indexed codeHash);
  event Redeemed(bytes32 indexed codeHash, address indexed by, string chainId);
}
```
AllowList refusals: `not a member` (add/remove by a non-member), `unknown kind`, `last entity`, `already present`. Onboarding: `issuers only` (issue/revoke), `code exists` (a hash ever issued), `bad uses` (outside 1–1000), `bad expiry` (`expiresAt <= block.timestamp`). `whyNot` checks in order: `bad code` (format), `bad chain id`, `no such code`, `code revoked`, `code expired` (`block.timestamp > expiresAt`), `code used up`, `chain id taken`; `redeem` requires `whyNot == ""` and reverts with that string.

- [ ] **Step 1: Failing tests** in `onboarding.test.ts`: `allowlist: member adds and removes a key`, `allowlist: non-member add reverts "not a member"`, `allowlist: removing the last entity reverts "last entity"`, `allowlist: unknown kind reverts`, `issue by issuer; by outsider reverts "issuers only"`, `issue: uses 0 and 1001 revert "bad uses"; reused hash reverts "code exists"`, `redeem records grant; isDeployAllowed true for redeemer only`, `redeem: each refusal reason` (one case per reason string above, asserting the exact revert text and `whyNot` returning the same string), `revoke stops redeems; an earlier grant stays allowed`, `uses 2: two chains then "code used up"`, `codes() and grants() list status (usesLeft, revoked, grant chainIds)`.
- [ ] **Step 2:** `cd packages/contracts && bun build.ts && bun test onboarding.test.ts` → FAIL.
- [ ] **Step 3:** Implement the three contracts. Code format check in Solidity: length 4–16, each byte `0-9` or `A-Z`. UUID check: length 36, hyphens at 8/13/18/23, else `0-9a-f`.
- [ ] **Step 4:** `bun build.ts && bun test` (whole contracts package, incl. the layout test) → PASS.
- [ ] **Step 5:** Commit `feat(contracts): AllowList and Onboarding — codes, grants, isDeployAllowed (t-151)` (sources, build.ts, index.ts, artifacts, test).

### Task 2: Worker — onboarding on root, the redeem form of POST /chains

**Files:**
- Create: `packages/node/src/onboarding.ts` (tx builders + `ensureOnboarding`)
- Modify: `packages/node/src/service.ts` (`onboarding()`, `redeemGrant`, `isDeployAllowed`), `src/router.ts` (`#createChain` third form, `RootInfo.onboarding`), `src/client.ts` (`CreateChainRequest` gains `chainId?`, `redeem?`; `RemoteChainInfo`/health root gains `onboarding: Address | null`), `src/index.ts` (export onboarding), `packages/node/scripts/bootstrap.ts` (call `ensureOnboarding`)
- Test: `packages/node/test/router-onboarding.test.ts` (in-process `Bun.serve` + `ChainHost`, as `router-devices.test.ts`)

**Interfaces (Produces):**
```ts
// onboarding.ts
export const CHAIN_ID_RE: RegExp                      // the UUID regex from Global Constraints
export function issueTx(account: LocalAccount, nonce: number, onboarding: Address, code: string, label: string, expiresAt: number, uses: number): Promise<Hex>
export function revokeTx(account: LocalAccount, nonce: number, onboarding: Address, codeHash: Hex): Promise<Hex>
export function redeemTx(account: LocalAccount, nonce: number, onboarding: Address, code: string, chainId: string): Promise<Hex> // fixed gas 500000, like claimTx's helper
/** Root admin: if root's Aliases has no "onboarding", deploy AllowList([admin]) + Onboarding and register the alias. Idempotent. */
export function ensureOnboarding(client: NodeClient, admin: LocalAccount): Promise<{ onboarding: Address; allowList: Address }>
// client.ts
export interface CreateChainRequest { dump: SerializedState; setup: [Hex, Hex]; claim?: Hex; chainId?: string; redeem?: Hex }
```
Router `POST /chains` with `chainId` set (and no `claim`): `checkSetup`; `chainId` matches `CHAIN_ID_RE` else 400 `bad chain id`; if `cfg.chain(chainId)` already exists → 409 `chain already exists` (before mining anything); if `redeem`: under `#limited(r.ip)`, precheck like `#invite` — to root's onboarding, decodes as `redeem(code, chainId)` with `chainId` equal to the body's (else 400 `bad redeem tx: …`), sender = signer (403), no value/access list, then `whyNot(code, chainId)` non-empty → 403 with that reason (counts as a failed code), `eth_estimateGas` ok, mine alone; then `isDeployAllowed(signer, chainId)` false → 403 `not allowed to create this chain`; then the existing create with id `chainId`; if that create fails (throws or non-201), reply **502** `chain not created: <reason>` (the grant stays; this status means "retry without redeem"). No SQL `redeems` row for this form. Root with no Onboarding → 503 `onboarding not set up on root`.

- [ ] **Step 1: Failing tests:** `health shows root.onboarding after ensureOnboarding; ensureOnboarding twice deploys once`, `redeem form: Sue creates her chain and is its admin`, `failed create after the redeem → 502 "chain not created: …"; retry without redeem creates it; code spent once`, `Bob with Sue's chainId and no redeem → 403 "not allowed to create this chain"`, `refusals: expired / used up / revoked / unknown / bad code → 403 with the exact reason, nothing mined`, `redeem tx chainId ≠ body chainId → 400`, `existing chainId → 409 before mining`, `old claim form still works` (one case).
- [ ] **Step 2:** `cd packages/node && bun test test/router-onboarding.test.ts` → FAIL.
- [ ] **Step 3:** Implement; `ChainService.onboarding()` reads `Aliases.get("onboarding")` (null if unregistered; cache once found).
- [ ] **Step 4:** `bun test` (node package) → PASS; `make e2e-node` → PASS (existing cases; bootstrap now ensures onboarding).
- [ ] **Step 5:** Commit `feat(node): onboarding on root — redeem form of POST /chains, grant introspection (t-151)`.

### Task 3: `@evmb/keys`

**Files:**
- Create: `packages/keys/package.json` (`@evmb/keys`, `main: src/index.ts`, deps: viem), `src/types.ts`, `src/crypto.ts`, `src/passphrase.ts`, `src/persistence.ts`, `src/browserKeyStore.ts`, `src/index.ts`
- Test: `packages/keys/test/keys.test.ts`

**Interfaces (Produces):**
```ts
export type UnlockRef = { readonly mechanism: 'passkey-prf'; readonly credentialId: string } | { readonly mechanism: 'passphrase'; readonly passphraseId: string } | { readonly mechanism: 'unused' }
export type Grant = { readonly ref: UnlockRef; readonly secret: Uint8Array; readonly salt?: Uint8Array }
export type WithGrantOptions = { readonly salt?: Uint8Array; readonly purpose?: string }
export type UnlockProvider = { readonly ref: UnlockRef; readonly mechanism?: UnlockRef['mechanism']
  withGrant<A>(fn: (g: Grant) => Promise<A>): Promise<A>; withGrant<A>(o: WithGrantOptions, fn: (g: Grant) => Promise<A>): Promise<A> }
export type KeyScope = { withSigner<A>(fn: (signer: LocalAccount) => Promise<A>): Promise<A> }
export type KeyStore = { readonly id: string; hasKey(a: Address): Promise<boolean>; list(): Promise<Address[]>; resolve(a: Address, purpose: string): Promise<KeyScope> }
export type KeyGenerator = { readonly id: string; generate(): Promise<Address> }
export type StoredKey = { address: Address; encryptedPrivateKey: Uint8Array; iv: Uint8Array; ref: UnlockRef; createdAt: number }
export type KeyPersistence = { store(e: StoredKey): Promise<void>; list(): Promise<StoredKey[]>; getMeta(k: string): Promise<Uint8Array | undefined>; setMeta(k: string, v: Uint8Array): Promise<void> }
export class MemoryKeyPersistence implements KeyPersistence
export class IndexedDbKeyPersistence implements KeyPersistence   // db "evmb-keys"; not unit-tested in Bun
export class KeyNotFound extends Error; export class WrongPassphrase extends Error  // message "Wrong passphrase"
/** ask(purpose) returns the passphrase or null (cancelled → throws Error "cancelled"). Stores its PBKDF2 salt under meta "passphrase-salt". */
export function passphraseProvider(o: { persistence: KeyPersistence; ask(purpose: string): Promise<string | null>; id?: string }): UnlockProvider
export class BrowserKeyStore implements KeyStore, KeyGenerator {
  constructor(o: { persistence: KeyPersistence; provider: UnlockProvider; idleLockMs?: number /* default 15 min */ })
  importKey(privateKey: Hex): Promise<Address>   // idempotent for a held address
  lock(): void                                   // forget decrypted signers
}
```
The store's HKDF salt is a random 32 bytes under meta `"wallet-salt"`, created on first use. A decrypted `LocalAccount` is cached per address until `lock()` or `idleLockMs` without use. A wrong passphrase is detected by AES-GCM decrypt failure of a held key; with no keys held yet, the first passphrase is accepted (and is what later decrypts).

- [ ] **Step 1: Failing tests:** `generate → list/hasKey; resolve signs a message recoverable to the address`, `persistence holds no plaintext (the private key bytes don't appear in any stored field)`, `import is idempotent and the imported key signs`, `wrong passphrase → WrongPassphrase, storage unchanged; right one signs`, `cancelled prompt → rejects "cancelled"`, `lock() makes the next resolve prompt again; within the session no second prompt`, `unknown address → KeyNotFound`, `two stores with different wallet salts produce different ciphertexts for the same key`.
- [ ] **Step 2:** `cd packages/keys && bun install && bun test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `bun test` → PASS.
- [ ] **Step 5:** Commit `feat(keys): @evmb/keys — KeyStore/KeyScope, passphrase-encrypted browser store (t-151)` (+ `bun.lock`).

### Task 4: `@evmb/workspace` — local chains, deploy with a code, retry, follow

**Files:**
- Create: `packages/workspace/package.json` (`@evmb/workspace`; deps `@evmb/node`, `@evmb/contracts`, `@evmb/keys`, viem, webevm, revm-wasm), `src/codes.ts`, `src/storage.ts`, `src/workspace.ts`, `src/index.ts`
- Test: `packages/workspace/test/codes.test.ts`, `test/workspace.test.ts` (in-process worker as in `packages/node/test/router-devices.test.ts`; reuse its `bunSql`/`wasm` helpers by relative import)

**Interfaces (Produces):**
```ts
// codes.ts
export const normalizeCode: (s: string) => string           // drop spaces and "-", upper-case
export const isValidCode: (s: string) => boolean            // after normalising: /^[A-Z0-9]{4,16}$/
export const formatCode: (c: string) => string              // "205117" → "205 117", else unchanged
export function generateCode(): string                       // 6 digits, crypto.getRandomValues
export const VALID_FOR: readonly { key: '1m' | '10m' | '1h' | '1d' | '1w'; label: string; seconds: number }[]
export const VOUCH_SECONDS = 600
// storage.ts
export type ChainRecord = { id: string; name: string; desc: string; createdAt: number
  status: 'local' | 'unfinished' | 'deployed'; dump?: SerializedState; deployedAt?: number; error?: string }
export type WorkspaceStorage = { load(): Promise<ChainRecord[]>; save(c: ChainRecord): Promise<void> }
export class MemoryWorkspaceStorage implements WorkspaceStorage; export class IndexedDbWorkspaceStorage implements WorkspaceStorage // db "evmb-workspace"
// workspace.ts
export type CodeSource = { code: string } | { vouch: true }
export class Workspace {
  static open(o: { workerUrl: string; keys: KeyStore; me: Address; storage: WorkspaceStorage; wasm: NodeConfig['wasm'] }): Promise<Workspace>
  chains(): ChainRecord[]
  createChain(name: string, desc: string): Promise<ChainRecord>        // local webevm chain; id = crypto.randomUUID()
  deploy(id: string, src: CodeSource): Promise<ChainRecord>            // vouch is Task 5; here {code} only
  retryDeploy(id: string): Promise<ChainRecord>                         // status 'unfinished' → resend without redeem
  follower(id: string): Promise<Follower>                               // live follower of a deployed chain
  onChange(fn: () => void): () => void
}
```
`deploy`: refuses an invalid code before any request (`bad code`); signs `setupTxs` and `redeemTx` (onboarding address from `health().root.onboarding`, nonce from `nonce('root')`) inside one `keys.resolve(me, 'Deploy <name>')` scope; sends `{chainId: id, dump, setup, redeem}`. On success → `deployed`, follows live. A **502** reply, or a network failure after the request was sent, → `unfinished` with `error` (the grant may exist). `retryDeploy` resends `{chainId, dump, setup}` without `redeem`: success → `deployed`; 403 `not allowed to create this chain` → back to `local` (no grant was recorded); 409 `chain already exists` → `deployed` (an earlier attempt landed). Other refusals keep `local` and throw the worker's reason.

- [ ] **Step 1: Failing tests:** codes — `normalizeCode("let-sue-in") === "LETSUEIN"`, `normalizeCode(" 205-117 ") === "205117"`, `isValidCode("ab") === false`, `isValidCode("A".repeat(17)) === false`, `formatCode("205117") === "205 117"`, `generateCode() matches /^\d{6}$/`; workspace — `createChain is local and persisted (reopen sees it)`, `deploy with a live code → deployed, the cloud head matches, I'm its admin`, `deploy with an expired code → throws "code expired", stays local`, `create fails after redeem (corrupt the dump) → unfinished; retryDeploy → deployed`.
- [ ] **Step 2:** `cd packages/workspace && bun install && bun test` → FAIL.
- [ ] **Step 3:** Implement (local chains via webevm `createNode` + `dumpState`, as `packages/node/scripts/bootstrap.ts` `freshDump`).
- [ ] **Step 4:** `bun test` → PASS.
- [ ] **Step 5:** Commit `feat(workspace): @evmb/workspace — local chains, deploy with a code, retry (t-151)`.

### Task 5: `@evmb/workspace` — issuing, codes, vouch; headless e2e

**Files:**
- Create: `packages/workspace/src/onboarding.ts`
- Modify: `packages/workspace/src/workspace.ts` (methods below; `deploy` accepts `{vouch: true}`), `packages/node/scripts/e2e.ts` (onboarding case driven through `@evmb/workspace` with `MemoryKeyPersistence`), `packages/node/package.json` (devDependency `@evmb/workspace`, `@evmb/keys` for the script)
- Test: `packages/workspace/test/onboarding.test.ts`

**Interfaces (Produces):**
```ts
export type CodeView = { hash: Hex; label: string; issuer: Address; issuedAt: number; expiresAt: number; uses: number; usesLeft: number
  status: 'active' | 'used' | 'expired' | 'revoked'; grants: { by: Address; chainId: string; at: number }[] }
// on Workspace:
isIssuer(): Promise<boolean>              // false when root refuses my read (403) or issuers.allows(me) is false
issueCode(o: { code?: string; label: string; validFor: (typeof VALID_FOR)[number]['key']; uses: number }): Promise<{ code: string }>  // code omitted → generateCode()
codes(): Promise<CodeView[]>              // newest first; reads root via a follower synced first
revokeCode(hash: Hex): Promise<void>
```
Status precedence: revoked > used (usesLeft 0) > expired (now > expiresAt) > active. Vouch: `isIssuer()` required (else throw `Only issuers can vouch`); issue a 1-use, `VOUCH_SECONDS` code labelled `Vouch: <chain name>`, then deploy with it.

- [ ] **Step 1: Failing tests:** `the root admin is an issuer; a fresh key is not`, `issueCode with a typed code "let-sue-in" → Sue deploys with it; codes() shows usesLeft 0, status used, a grant with Sue's address and chain id`, `issueCode without a code → 6 digits`, `revokeCode → status revoked; deploy with it → "code revoked"`, `a non-issuer's issueCode → throws (root refuses the tx)`, `vouch by the admin deploys; vouch by a non-issuer → "Only issuers can vouch"`.
- [ ] **Step 2:** `bun test test/onboarding.test.ts` → FAIL. **Step 3:** implement. **Step 4:** `bun test` (workspace) → PASS.
- [ ] **Step 5:** e2e: add case `onboarding (workspace)`: admin issues `LET-SUE-IN`-style typed code (unique per run) for 2 uses; Sue (fresh key) creates and deploys; Bob can't create Sue's chain id; Sue's second deploy uses the second use; a third → `code used up`; revoke a fresh code → `code revoked`. `make e2e-node` → PASS.
- [ ] **Step 6:** Commit `feat(workspace,node): issue, list, revoke and vouch; headless onboarding e2e (t-151)`.

### Task 6: `@evmb/app` — scaffold, shell, keys UI

**Files:**
- Create: `packages/app/` — `package.json` (`@evmb/app`; scripts `dev: vite --port 5174 --strictPort`, `build: vite build`; deps react 19, react-dom, `@evmb/workspace`, `@evmb/keys`, viem, revm-wasm, webevm; devDeps vite, `@vitejs/plugin-react`, types), `index.html`, `vite.config.ts` (same `optimizeDeps.exclude: ['revm-wasm']`, `worker.format: 'es'` as packages/web), `src/main.tsx`, `src/theme.ts` (the prototype's colours, radii, font stacks as constants), `src/shell/{AppBar,Nav,Footer,ProfileMenu}.tsx`, `src/keys/{UnlockDialog,ImportKeyDialog}.tsx`, `src/state.tsx` (one React context holding the `Workspace`, `BrowserKeyStore`, chosen `me`)
- Modify: `Makefile` (`app: ## new app on http://127.0.0.1:5174 against the local worker` → `bun run --cwd packages/app dev`)
- Test: `packages/app/test/shell.test.tsx` (`renderToString`, as `packages/web/test/cloud-deploy.test.ts`)

Shell per the prototype's APP BAR / NAV / FOOTER sections (`[App name]` → `Chain workspace`). Profile menu: "You" with the current address shortened, **Generate key**, **Import key…** (paste a `0x…` 64-hex private key; invalid → `That isn't a private key`), **Lock**. Unlock dialog: passphrase field, the purpose as its intro, `Wrong passphrase` inline on failure; first run says "Choose a passphrase. It encrypts your keys in this browser; it can't be recovered." The app's `me` = last chosen address (localStorage `evmb-app-me`), else generate one on first run.

- [ ] **Step 1: Failing tests:** `shell renders the app name, nav and profile button`, `profile menu lists Generate key, Import key…, Lock`, `import dialog rejects "0x12" with "That isn't a private key"`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** tests PASS; `bun run --cwd packages/app build` → succeeds.
- [ ] **Step 5:** Commit `feat(app): @evmb/app — shell and key management UI (t-151)`.

### Task 7: `@evmb/app` — Chains, New chain, Deployment, Deploy modal

**Files:**
- Create: `packages/app/src/chains/{ChainList,ChainDetail,NewChainModal,DeployModal}.tsx`, `src/chains/view.ts` (pure view-model helpers)
- Test: `packages/app/test/chains.test.tsx`

Per the prototype's "chain detail" (General + Deployment only), the heading chain picker, "New chain" modal ("It starts local, in this browser. You can deploy it later.", notice `Created “<name>”. It’s local until you deploy it.`), and the `deploy` modal: modes *Someone gave me a code* (desc: `An admin issued you a code.`) and *Vouch* (only when `isIssuer()`; its select lists only the root chain, labelled `Root`). Deployment section states: Local only (prototype copy + "Deploy chain…"), Deployed and syncing (prototype copy, my access = admin), Unfinished (`Your code was accepted but the chain wasn't created: <error>` + **Retry**). Refusal reasons map to the prototype's copy: `code expired` → `That code has expired. Ask for a new one.`; `code used up` → `That code has no deployments left.`; `code revoked` → `That code was revoked.`; `no such code` / `bad code` → `That code isn't valid. Check it and try again.` Opening the app with `?code=X` creates nothing: it opens New chain, then on create opens Deploy with X filled in.

- [ ] **Step 1: Failing tests:** `view: refusal reason → copy` (all five mappings), `chain list renders local and deployed chains with their badges`, `deploy modal hides Vouch for non-issuers`, `?code=205117 pre-fills "205 117" in the deploy modal`, `unfinished shows Retry`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + build.
- [ ] **Step 5:** Commit `feat(app): chains, new chain and deploy with a code or vouch (t-151)`.

### Task 8: `@evmb/app` — Onboarding page

**Files:**
- Create: `packages/app/src/onboarding/{OnboardingPage,IssueForm,CodeList}.tsx`, `src/onboarding/view.ts`
- Test: `packages/app/test/onboarding.test.tsx`

Per the prototype's contract detail for the Onboarding contract on root: "Issue an access code" (intro `Whoever enters the code can deploy a chain of their own, vouched for by Root.`), Code (generated, regenerate; hint `Generated for you. Type your own if you prefer: 4–16 letters or digits.`), Valid for (`VALID_FOR`), Deployments allowed (1–1000, default 1), label field titled `For (optional)` (free text), **Issue code**; after issuing, the plain code is shown once with a copy button and a link `<app url>?code=<code>`. Codes list: `formatCode`d code only for codes issued in this session (others show the label or `Code ending …<last 4 hex of hash>`), status badge, `<n> deployments left of <m>` / `<k> of <m> used`, `expires in …` / `expired … ago` / `revoked`, `For <label>` or `For anyone with the code`, grants (`by 0x12…ab → chain <id>`), **Revoke** for active codes. Non-issuers see `Only people with this contract’s Issuer role can see its codes.` The page is in the nav only for issuers.

- [ ] **Step 1: Failing tests:** `view: status text for active/used/expired/revoked` (exact strings above), `issue form validates "ab" with the 4–16 hint and uses 1001`, `non-issuer sees the issuer-only message`, `issued code shows once with its ?code= link`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + build.
- [ ] **Step 5:** Commit `feat(app): onboarding page — issue, list and revoke codes (t-151)`.

### Task 9: Docs, board, risks

- [ ] **Step 1:** ADR-0026 (deploy codes live in root's Onboarding contract; the worker introspects grants; only root vouches); `packages/node/README.md` (redeem form, `root.onboarding`, refusal reasons, second admin = AllowList + root writer); `packages/keys/README.md`, `packages/workspace/README.md`, `packages/app/README.md` (a few lines each: purpose, how to run/test); risks: new entry for guessable codes, R53 note (closed for the redeem form), new entry for keys in the browser (encrypted at rest, decrypted in memory while unlocked, forgotten passphrase loses keys); board t-151 child card for this step with DoD (browser check unticked → Doing), t-142 note: mychain.dev fronts evm.fun. Regenerate cards with `node_modules/.bin/agile card|badge docs/board/board.md docs/board` and `node_modules/.bin/risk-register card|badge docs/risks/risks.md docs/risks`.
- [ ] **Step 2:** Commit `docs: onboarding codes — ADR-0026, READMEs, risks, board (t-151)`.
