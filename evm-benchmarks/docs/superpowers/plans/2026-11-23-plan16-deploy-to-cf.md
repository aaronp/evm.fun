# Deploy to Cloudflare (t-134) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real Cloudflare worker (`packages/node`) that runs chains as Durable Objects on t-129's `ChainNode`, a root chain whose admin issues deploy codes, and an evm.fun flow to issue codes and deploy a browser chain with one — local first (`make dev-services`), then live (`make deploy`, run by Aaron).

**Architecture:** All chain logic lives in a DO-agnostic `ChainService` (one per chain, over the t-129 store and node), tested in Bun on `bun:sqlite`. The worker is a thin router; each chain is a Durable Object that wraps one `ChainService` over DO SQLite via a small adapter. A deploy uploads the browser chain's dump plus two signed set-up txs (deploy `ChainAccess`, `Aliases`); the chain's DO mines them as its first block, so state roots are computed on the cloud node; evm.fun then replaces its local copy with the returned dump and checks the head hash matches. Redeeming a code is a `claim(code)` tx on the root chain, signed by the user.

**Tech Stack:** Bun, TypeScript, Cloudflare Workers + Durable Objects (SQLite) via wrangler, webevm 0.9.1 + revm-wasm 0.3.1, viem, solc (existing `packages/contracts` build), React 19 + Tailwind 4 (evm.fun).

**Spec:** `docs/superpowers/specs/2026-11-23-deploy-to-cf-design.md` (with t-129's `docs/superpowers/specs/2026-11-23-chain-store-design.md`; reference code `spike/cf-chain/`; follow-ups on board card t-134).

## Deviations from the spec (rulings, for Aaron to check)

1. **The prepare block is mined by the cloud node, not the browser.** evm.fun's chains don't compute state roots, and making them do so means changing the playground's engines. Instead the browser signs the two set-up txs and uploads them with the dump; the new chain's DO applies them as block head+1 with real roots and returns its dump; evm.fun replaces its local chain with it (existing snapshot-restore path) and checks the head hash. Both copies are then identical. Switching the browser chain's own config (gas-free, roots) moves to t-132.
2. **View routes (`access-controls/latest`, aliases list) are not ported here**; the result screen shows the chain URL, head and admin. Views come with t-138/t-139.
3. **Moving evm.fun to `mychain.dev`** is its own small card (added to the board in Task 6), not this plan.

## Global Constraints

- webevm **0.9.1**, revm-wasm **0.3.1** exactly. `packages/node/src/*` must not import `bun:*` or `node:*` (scripts and tests may).
- Use t-129's API only through `ChainNode.create/boot/apply/read/stateRoot/dispose` and `ChainStore`; never call the node from inside a `read` callback (deadlock); pass the wasm as an imported `WebAssembly.Module` in the worker.
- Root chain id is the literal **`root`** (DO `idFromName('root')`); other chain ids are `crypto.randomUUID()`.
- Request auth: the spike's EIP-191 scheme (`cf-chain v1` message over method, canonical target, sha256(body), ts, nonce; headers `x-ts`, `x-nonce`, `x-sig`), clock skew **300 s**, single-use nonces.
- Deploy codes: `ChainAccess.invite(hash, ttl, uses, grants)` with new grant bit **`GRANT_CREATE_CHAIN = 4`**; a create-chain claim adds no role. Codes stored only as `keccak256(code)` + expiry + uses. Generated codes: **4 words** joined by `-`.
- Failed redeems: at most **10 per IP per 10 minutes** → `429`.
- CORS origins: `https://mychain.dev`, `https://aaronp.github.io`, `http://localhost:*` (any port).
- Local worker: port **8799**, state in `evm-benchmarks/.run/node-state`, pid/log in `evm-benchmarks/.run/`. Keys: `evm-benchmarks/.env.local` (`ROOT_ADMIN_KEY`, generated if missing) and `evm-benchmarks/.env.live` (Aaron's); both git-ignored; only the address reaches the worker (`--var ROOT_ADMIN:<address>`), never committed.
- Live: Workers custom domain **`cloud.mychain.dev`**; fallback `workers.dev`. Nothing deploys from CI; never run `wrangler login` or `wrangler deploy` yourself.
- evm.fun worker URL: `import.meta.env.VITE_NODE_URL` (default `http://localhost:8799`), overridable per browser (localStorage, try/catch). Pages build gets it from repo variable `NODE_URL`.
- UI: tokens only, three themes, contrast tests, phone width; real data only. Commit with `git commit --only -m … -- <paths>`, messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `design/`, `.env.*`, `.run/`. Full `bun test` before each commit (risk R11: rerun if no summary line).

## Review Focus

1. **A code redeemed twice concurrently** (two deploys racing with a single-use code): exactly one chain is created; the other gets a clear refusal.
2. **A deploy whose set-up txs are not two contract creations by the request signer** (wrong signer, extra tx, a tx that reverts): refused, and no DO is left half-created (a retry with a fresh chain id works).
3. **The root chain created by anyone but `ROOT_ADMIN`, or a second time:** refused, the existing root untouched.
4. **Clock skew / replayed signed request:** a request outside 300 s or with a reused nonce is 401, including the deploy POST.
5. **evm.fun after a refused deploy:** the local chain is unchanged (no replace), the dialog says which check failed, and the user can retry with another code.

---

### Task 1: Contracts — `ChainAccess` with create-chain codes, `Aliases` with a constructor

**Files:**
- Create: `packages/contracts/src/ChainAccess.sol`, `packages/contracts/src/Aliases.sol` (from `spike/cf-chain/contracts/`)
- Modify: `packages/contracts/build.ts` (names), `packages/contracts/index.ts` (exports), `packages/contracts/artifacts/*.json` (built)
- Test: `packages/contracts/chainaccess.test.ts`

**Interfaces:**
- Produces: `ChainAccess` and `Aliases` (`{abi, bytecode}`) from `@evmb/contracts`.
  - `ChainAccess`: as the spike, constructor sets `admin = msg.sender`; `GRANT_CREATE_CHAIN = 4`; `invite` accepts `grants` in `1..7`; `claim(code)` with the create bit adds no reader/writer role, decrements uses, emits `Claimed(hash, who, usesLeft)`; `canRead/canWrite/readers/writers/admin/readOpen` unchanged.
  - `Aliases`: `constructor(address access)` stores it (immutable); `onlyAdmin` reads `IAdmin(access).admin()`; rest as the spike.

- [ ] **Step 1: Failing tests** (webevm node, deploy both via viem-encoded txs): `admin is the deployer`; `a create-chain code: claim succeeds once, adds no role, emits Claimed`; `a 2-use code refuses the third claim`; `an expired code is refused` (advance the block timestamp past expiry); `invite with grants 0 or 8 reverts`; `Aliases: only the ChainAccess admin can register`.
- [ ] **Step 2:** `bun test packages/contracts/chainaccess.test.ts` → FAIL.
- [ ] **Step 3:** Port the contracts with the two changes; `bun packages/contracts/build.ts`; export from `index.ts`.
- [ ] **Step 4:** tests PASS; full `bun test` passes.
- [ ] **Step 5:** Commit `feat(contracts): ChainAccess with create-chain codes, Aliases with a constructor (t-134)`.

### Task 2: Client library — auth, codes, set-up txs

**Files:**
- Create: `packages/node/src/auth.ts`, `packages/node/src/client.ts`, `packages/node/src/words.ts`
- Modify: `packages/node/src/index.ts`, `packages/node/package.json` (dep `@evmb/contracts`)
- Test: `packages/node/test/auth.test.ts`, `packages/node/test/client.test.ts`

**Interfaces:**
- Consumes: `ChainAccess`, `Aliases` (Task 1).
- Produces:
  - `auth.ts`: `AUTH_VERSION = 'cf-chain v1'`; `signRequest(account: LocalAccount, method: string, url: URL, body: string): Promise<{ts, nonce, sig}>`; `recoverSigner(method, url, body, {ts, nonce, sig}): Promise<string>` (lowercase); `SKEW_S = 300`.
  - `client.ts` (UI-free; used by evm.fun, scripts and e2e):
    - `codeHash(code: string): Hex` (= `keccak256(toBytes(code))`); `generateCode(): string` (4 words from `words.ts`, `-`-joined, crypto-random).
    - `setupTxs(account: LocalAccount, nonce: number, chainId: number): Promise<[Hex, Hex]>` — deploy `ChainAccess`, then `Aliases(predicted ChainAccess address)`; `maxFeePerGas 0`, `maxPriorityFeePerGas 0`, gas limits that cover both.
    - `claimTx(account, nonce, code): Promise<Hex>` and `inviteTx(account, nonce, access: Address, code: string, ttlS: number, uses: number): Promise<Hex>` (grant `GRANT_CREATE_CHAIN`), chainId **31337**.
    - `class NodeClient { constructor(baseUrl: string, account?: LocalAccount); health(): Promise<{ok: true, root: null | {chainId: 'root', admin: Address, access: Address, head: number}}>; info(chainId): Promise<RemoteChainInfo>; nonce(chainId: 'root'): Promise<number>; submit(chainId, txs: Hex[]): Promise<{head: BlockSummary}>; createChain(req: CreateChainRequest): Promise<CreateChainResult>; codes(): Promise<CodeRecord[]> }` — signs every request except `health`; non-2xx → throws `NodeError {status, error}` with the worker's message.
    - Types: `CreateChainRequest = { dump: SerializedState; setup: [Hex, Hex]; claim?: Hex }`; `CreateChainResult = { chainId: string; url: string; head: BlockSummary; dump: SerializedState }`; `BlockSummary = { number, hash, stateRoot }`; `RemoteChainInfo = { chainId: string; head: BlockSummary; admin: Address; access: Address; aliases: Address }` (named so it never clashes with the web app's `ChainInfo`); `CodeRecord = { hash, expiry, usesLeft, redeemed: {by: Address, chainId: string, at: number}[] }`.

- [ ] **Step 1: Failing tests:** `signRequest → recoverSigner round-trips; a changed body, path or method recovers a different address`; `codeHash matches the contract's keccak256(bytes(code))`; `generateCode gives 4 lowercase words`; `setupTxs: applied to a fresh ChainNode (t-129, bunSql) as one block, both receipts succeed, ChainAccess.admin() == signer, Aliases(access) points at it`; `inviteTx then claimTx on that chain: claim succeeds once`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** PASS + full suite.
- [ ] **Step 5:** Commit `feat(node): request auth, deploy-code and set-up tx helpers, NodeClient (t-134)`.

### Task 3: `ChainService` — create, redeem, submit, info (DO-agnostic)

**Files:**
- Create: `packages/node/src/service.ts`
- Test: `packages/node/test/service.test.ts`

**Interfaces:**
- Consumes: `ChainStore`, `ChainNode` (t-129), `Sql`, `recoverSigner`, `ChainAccess`/`Aliases` ABIs, client types.
- Produces: `class ChainService { static open(sql: Sql, wasm, opts: {chainId: string}): Promise<ChainService | null>` (null if no chain stored); `static create(sql, wasm, opts: {chainId: string; signer: string; dump: SerializedState; setup: [Hex, Hex]; timestamp: number}): Promise<ChainService>` (throws `ServiceError(status, message)`); `info(): Promise<RemoteChainInfo>` (`{chainId, head, admin, access, aliases}`); `canRead(addr): Promise<boolean>`; `canWrite(addr): Promise<boolean>`; `nonceOf(addr): Promise<number>`; `submit(signer: string, txs: Hex[], timestamp: number): Promise<BlockSummary>`; `redeem(signer: string, claim: Hex, timestamp: number): Promise<{codeHash: Hex}>`; `recordRedeem(codeHash, by, chainId, at)`; `codes(): Promise<CodeRecord[]>`; `dump(): Promise<SerializedState>` (via `read`) }`.
  - `create`: load `dump` (t-129 `ChainNode.create`), apply `setup` as one block at `timestamp`; refuse (400/403) unless both txs are contract creations sent by `signer`, both succeed, and `ChainAccess.admin() == signer`; store `access`/`aliases` addresses in a `meta` table; on refusal the sql has no chain (caller discards it).
  - `submit`: signer and every tx sender must be writers (`canWrite`), else 403; a rejected block → 400 with the reason.
  - `redeem` (root only): `claim` must be a `claim(string)` call to the root's ChainAccess sent by `signer`; applied as its own block; reverted → 403 `bad, used or expired code`, and the block is not kept (t-129 rollback). Returns the code hash (from the decoded calldata).
  - `codes`: current invites (from `Invited`/`Claimed` events + `invites(hash)` state) joined with the `redeems` table.

- [ ] **Step 1: Failing tests** (bunSql; dumps from a fresh webevm node; accounts from `privateKeyToAccount`): `create: head is dump head + 1 and admin is the signer`; `create refuses: setup signed by another key; a third tx; a reverting tx; a non-creation tx — and sql holds no chain afterwards`; `root: inviteTx via submit by admin, then redeem by another key succeeds once; second redeem of a 1-use code → 403; after expiry → 403`; `submit by a non-writer → 403`; `codes lists the invite with usesLeft and the recorded redeem`; `open() reboots to the same info and head`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + full suite.
- [ ] **Step 5:** Commit `feat(node): ChainService — create from dump + set-up block, redeem codes, submit, info (t-134)`.

### Task 4: Worker, Durable Object, dev services, bootstrap, end-to-end

**Files:**
- Create: `packages/node/src/worker.ts`, `packages/node/src/doSql.ts`, `packages/node/wrangler.jsonc`, `packages/node/scripts/dev-services.ts`, `packages/node/scripts/bootstrap.ts`, `packages/node/scripts/e2e.ts`
- Modify: `packages/node/package.json` (devDependency `wrangler`, same version as the spike), `Makefile` (`dev-services`, `dev-services-status`, `dev-services-stop`, `e2e-node`), `/Users/aaron/dev/sandbox/chain-perf/.gitignore` (`evm-benchmarks/.env.local`, `evm-benchmarks/.env.live`, `evm-benchmarks/.run/`, `evm-benchmarks/packages/node/.wrangler/`)

**Interfaces:**
- Consumes: `ChainService`, `NodeClient`, `signRequest`/`recoverSigner`, `setupTxs`, `inviteTx`, `claimTx`, `generateCode`.
- Produces:
  - `doSql(storage: DurableObjectStorage): Sql` (`exec` → `.toArray()`; `tx` → `transactionSync`).
  - Routes (JSON; CORS on all, incl. `OPTIONS`): `GET /health`; `POST /chains` (signed; body `CreateChainRequest`) → 201 `CreateChainResult` — with no `claim`: only `ROOT_ADMIN`, only if no root, creates chain `root`; with `claim`: root DO `redeem` (rate-limited) → new DO `create` → root DO `recordRedeem`; `GET /chains/:id` (signed, reader) → `RemoteChainInfo`; `POST /chains/:id/submit` (signed, writer); `GET /chains/root/nonce` (signed) → `{nonce}` of the signer only; `GET /chains/root/codes` (signed, root admin) → `CodeRecord[]`.
  - Each chain DO serialises its mutations; timestamps from `Date.now()`; signed-request nonces stored per DO (as the spike).
  - `scripts/dev-services.ts start|status|stop`: start = ensure `.env.local` (generate `ROOT_ADMIN_KEY` if missing), launch `wrangler dev --port 8799 --persist-to .run/node-state --var ROOT_ADMIN:<address>` detached, pid + log in `.run/`, wait for `/health`, run `bootstrap` if no root, print URL, root admin address and root chain status; status = per service: pid alive?, port, URL, health, root head, or "not running" (stale pid file → "not running", file removed); stop = kill by pid, report.
  - `scripts/bootstrap.ts <url> <envfile>`: build a fresh empty chain dump (webevm, chainId 31337), `setupTxs` with the root key, `POST /chains` without a code; print root info. Prints "Import this key in evm.fun (Accounts → Import) to issue codes" when it generated the key.
  - `scripts/e2e.ts`: against the running local worker: health/root; admin issues a 1-use code and a 2-use code (`submit` of `inviteTx`); key B deploys a chain with the 1-use code (dump from a fresh webevm chain with one ERC-20 deploy) → admin of the new chain is B, `info` matches, returned dump's head hash equals `head.hash`; refusals: same code again, a wrong code, an expired code (TTL 2 s, wait 3 s), root create by a non-admin, a replayed signed request (same headers twice) → 401, an unsigned `POST /chains` → 401; the 2-use code deploys two chains then refuses the third; `codes` shows the redeems. Prints PASS lines and `ALL PASS`, exits non-zero on any failure.
  - Makefile: `dev-services`, `dev-services-status`, `dev-services-stop` → the script; `e2e-node` → start (if not running), run e2e, stop only if it started them.

- [ ] **Step 1:** Write `scripts/e2e.ts` first; run it against nothing → it fails at health (RED).
- [ ] **Step 2:** Implement `doSql`, `worker.ts`, `wrangler.jsonc` (DO class with `new_sqlite_classes`, compat date as the spike, `ROOT_ADMIN` var placeholder empty), scripts, Makefile, `.gitignore`.
- [ ] **Step 3:** `make e2e-node` → `ALL PASS` (paste output into the report). `make dev-services`, `make dev-services-status`, `make dev-services-stop`, `make dev-services-status` → paste outputs (running, then not running).
- [ ] **Step 4:** full `bun test` passes (no test file depends on wrangler).
- [ ] **Step 5:** Commit `feat(node): Cloudflare worker with chain DOs, dev services, bootstrap and e2e (t-134)`.

### Task 5: evm.fun — node setting, deploy codes, Deploy chain

**Files:**
- Create: `packages/web/src/cloud/node.ts` (node URL setting + `NodeClient` for the acting account), `packages/web/src/cloud/deploy.ts` (deploy flow), `packages/web/src/pages/Cloud.tsx`, `packages/web/src/components/cloud/DeployDialog.tsx`, `packages/web/src/components/cloud/CodesPanel.tsx`
- Modify: `packages/web/src/App.tsx` + sidebar nav (page **Cloud** under Setup, route `/cloud`), `packages/web/src/pages/ChainsPage.tsx` (per-chain **Deploy…** and a **Deployed** badge), `packages/web/src/chain/handle.ts` (`ChainInfo.deployed?: { nodeUrl: string; chainId: string; at: string; head: number }`), workspace file round-trip of that field
- Test: `packages/web/test/cloud-deploy.test.ts`

**Interfaces:**
- Consumes: `NodeClient`, `setupTxs`, `claimTx`, `inviteTx`, `generateCode`, `codeHash` (Task 2); registry `restoreTo`/approach `restore` for replacing the local chain; accounts store for the acting account's key.
- Produces: `deployChain(o: { chain: ChainHandle; account: LocalAccount; code: string; client: NodeClient; onStep(step: 'prepare' | 'code' | 'node' | 'replace', detail: string): void }): Promise<CreateChainResult>` — dumps the chain, nonce of the account on the local chain → `setupTxs`; root nonce → `claimTx`; `createChain`; replaces the local chain with `result.dump` via the restore path; checks the local head hash equals `result.head.hash` (else throws "the deployed chain differs from your browser's"); records `info.deployed`. On any refusal nothing local changes.
  - **Cloud page:** node URL (with override field), health and root status; when the acting account is the root admin: **Issue a deploy code** (code field prefilled by `generateCode()` with "Generate" button, TTL with presets 5 min / 1 h / 1 day, uses 1 default) → `submit(inviteTx)`; **Codes** table: masked hash, expires in, uses left, redeemed by → chain id. Non-admins see "Only the root admin issues deploy codes" and their own deployed chains.
  - **Deploy dialog** (Chains page, plain chains only; sequencer/benchmark show "Deploy" disabled with the reason): code field → steps "Preparing your chain…", "Checking your code…", "Starting your node…", "Matching your browser…", each with an under-the-hood line (tx hashes, worker URL) → result: chain id, URL, head block and hash "matches your browser", admin = acting account. Errors show the worker's message and keep the dialog open for another code.

- [ ] **Step 1: Failing tests** for `deployChain` against an in-process worker stand-in: a `Bun.serve` that routes the Task-4 paths to `ChainService` instances over `bunSql` (test helper only): `deploys, replaces the local chain, head hash matches, records deployed`; `a refused code leaves the local chain unchanged (same head hash, no deployed field)`; `steps are reported in order`.
- [ ] **Step 2:** FAIL. **Step 3:** implement `node.ts`, `deploy.ts`, then the page, panel and dialog. **Step 4:** PASS; full suite; `bun run web:build` succeeds.
- [ ] **Step 5:** Manual check against `make dev-services` (note results in the report): import the root key, issue a code, deploy a chain as a second account, see the badge; wrong code refused. Three themes and phone width look right.
- [ ] **Step 6:** Commit `feat(web): Cloud page — deploy codes for the root admin, Deploy chain with a code (t-134)`.

### Task 6: Live deploy target, docs, board

**Files:**
- Modify: `Makefile` (`deploy`), `packages/node/wrangler.jsonc` (`routes: [{ pattern: "cloud.mychain.dev", custom_domain: true }]` in an `env.live` block), `/Users/aaron/dev/sandbox/chain-perf/.github/workflows/pages.yml` and `evm-benchmarks/.github/workflows/pages.yml` (`VITE_NODE_URL: ${{ vars.NODE_URL }}` on the build step), `packages/node/README.md` (worker, routes, local services, deploying, issuing and redeeming codes), `docs/adr/decisions.md` (ADR: deploy codes on the root chain; cloud-mined set-up block), `docs/risks/risks.md` (risks: guessable codes / rate limit; code spent if creation fails after redeem; root admin key on Aaron's machine), `docs/board/board.md` (t-134 DoD ticks except the live item; new card under Delivery t-108 "Move evm.fun to mychain.dev")
- Create: `packages/node/scripts/deploy.ts`

**Interfaces:**
- `scripts/deploy.ts`: requires `.env.live` (`ROOT_ADMIN_KEY`; refuses to generate one); runs `wrangler deploy --env live --var ROOT_ADMIN:<address>`; reads the deployed URL (custom domain if configured, else the `workers.dev` URL wrangler prints); runs `bootstrap` against it if no root; prints URL, root chain id, and "set GitHub repo variable NODE_URL to <url>".

- [ ] **Step 1:** Implement `deploy.ts` and the `deploy` target. Verify only with `wrangler deploy --dry-run --env live` (no login, nothing uploaded) → bundle builds; paste the output. **Do not run `make deploy`.**
- [ ] **Step 2:** Workflow env var; README; ADR; risks; board (regenerate cards with `node_modules/.bin/agile card …`, `node_modules/.bin/adr card|badge …`, `node_modules/.bin/risk-register card|badge …`).
- [ ] **Step 3:** full `bun test`; `make e2e-node` still `ALL PASS`.
- [ ] **Step 4:** Commit `feat(node): make deploy (live, run by Aaron); docs, ADR, risks, board (t-134)`.
