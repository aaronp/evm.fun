# Deploy to Cloudflare: `make deploy` and deploy codes — design

Board: t-134 (child of the roadmap t-136). Builds on the spike in `spike/cf-chain` and its reports in `docs/spikes/`.

## Intent

Turn the Cloudflare spike into a real worker, and let people put their own browser chain on it — but only with a
deploy code the root admin (Aaron) issued. This is the first step of the roadmap's end-to-end demo, an N-node revm
cluster per chain:

a. a user creates a chain in evm.fun; b. deploys a contract on it (wizard, ERC-20, …); c. asks Aaron for a code;
d. clicks **Deploy**: a Cloudflare node comes up with the same state (a 2-node cluster);
e–g. (later cards) a second device joins with a code the user issues for their own chain, runs its own node, and
either device can deploy and update contracts.

**This card is a–d, up to the deploy itself.** Right after deploy the two nodes hold the same chain (checked by state
root). Keeping the browser node in step afterwards is t-132; devices joining is t-131/t-133.

## Decided with Aaron

- **First chain = the root chain.** `make deploy` deploys the worker and creates the root chain with Aaron's key as
  admin; locally, `make dev-services` does the same against a local worker. The worker's config names the root admin
  address (public, not a secret); only that key can create the root chain, and only once.
- **Deploy codes on the root chain**, stored as `{hash(code), expiry}` (+ uses, below), never the code. Aaron types a
  code he chooses (e.g. `my-first-friend`) or a generated one, and a TTL (e.g. 5 min), in evm.fun, and signs the tx.
- **Sharing is out of band** (text, email, in person).
- **Redeeming:** the friend opens evm.fun, picks one of their chains, chooses **Deploy chain**, enters the code. The
  worker hashes it and checks the root chain: hash matches, before expiry. Then it creates their chain (one Durable
  Object) with the friend's key as admin; otherwise it refuses and says which check failed.
- **The code alone is enough** (no per-use approval); the TTL bounds the risk.
- **Local first, then live.** Everything, including the evm.fun UI, works against a local worker first. Makefile:
  `dev-services` (start the local worker in the background), `dev-services-status`, `dev-services-stop`, and
  `deploy` (put it live on Aaron's Cloudflare account; run by Aaron, never by CI).
- **Scope A:** after deploy, evm.fun shows the chain as deployed (URL, head, links); the browser copy stays a local
  chain. Using the remote chain from evm.fun's pages is t-132.

## How it works

### One create path: upload a prepared chain

Both evm.fun and the worker run webevm 0.9.1 + revm-wasm 0.3.1, and a playground chain file's `dump` is a webevm
dump (state plus block history). So a deploy is an **upload of the chain as it is**:

1. **Prepare (in evm.fun):** the user's chain gets one ordinary block, "Prepare for deploy", sent by the user's
   key: deploy `ChainAccess` (constructor: admin = sender) and `Aliases` (pointing at that ChainAccess). This is a
   normal block, visible in the explorer — a teaching point: the chain's own rules are contracts on it.
2. **Upload:** `POST /chains` with `{ dump, access, aliases, code? }`, signed by the user's key (the spike's EIP-191
   request signing). `dump` is the chain's current dump, so the head is the prepare block.
3. **Worker checks** (in order, refusing with a clear reason): the request signature; the **code** (below); the dump
   loads; the head block's state root equals the root the worker computes after loading (so the upload is
   self-consistent); `access` and `aliases` hold the expected runtime code, and `ChainAccess.admin() == signer`.
4. **Create:** a new Durable Object, keyed by a new chain id (UUID), stores the dump and the head; it continues from
   the uploaded head (same number, same hash). The response is `{ chainId, url, head: {number, hash, stateRoot} }`;
   evm.fun checks the root matches its own and records the deployment on the chain.

The root chain is created the same way, by a small Bun script (`bootstrap`) rather than evm.fun: build a fresh chain,
send the prepare block with the root admin key, upload with no code. The worker accepts a code-less create only from
the configured root admin and only when no root chain exists; it remembers the root chain's id.

What changes from the spike: system contracts are found at the addresses given at create (stored in the DO's meta),
not fixed genesis addresses; chains are created from a dump rather than an `alloc` genesis.

### Deploy codes

- **Contract:** the root chain's `ChainAccess` already has `invite(hash, ttl, uses, grants)` / `claim(code)` from
  the spike. Deploy codes are invites with a new grant bit, **CREATE_CHAIN**: claiming one records `Claimed(hash, who)`
  but adds no role on the root chain. (Aaron called this the "Accounts" contract; it is the root chain's access
  contract. Rename if you prefer.)
- **Uses:** single-use by default; multi-use optional; always within the TTL (the t-133 mechanism).
- **Redeem:** the upload carries a raw `claim(code)` tx signed by the user's key for the root chain. The worker submits
  it to the root chain as a claim (the spike admits claims from non-writers and refuses the block if the claim
  reverts — bad, expired or used-up code); only if it succeeds does it create the new chain. If creation then fails,
  the code is spent: Aaron issues another (rare; noted as a risk).
- **Expiry** is checked against the root chain's block timestamp, which the worker sets from its clock.
- **Guessable codes:** the issue form offers a generated code (four words) as the default; the worker limits failed
  claims (per IP and per code hash) — the free-gas, non-writer claim path is the only open door on the root chain.

### Who sees what

- Root chain reads are closed (only Aaron), so redeemed codes in claim txs stay private.
- A deployed chain: admin = the user; reads closed by default; `GET /chains/:id/access-controls/latest` and the
  aliases list work as in the views spike.
- CORS: the worker allows evm.fun's origin (and localhost in dev).

## Storage

Built first, as t-129 ([chain store design](2026-11-23-chain-store-design.md)): the worker's Durable Object persists
through `ChainStore` and runs its node through t-129's `node.ts` (diff rows per block, boot from current state,
rebuild every N blocks). The cost spike ([docs/spikes/cf-cost.md](../../spikes/cf-cost.md)) shows why: the spike's
storage runs out of DO memory within months; with the store, every scenario costs $0 beyond the $5/month minimum.

## Code

- **`packages/node`** — the real worker, grown from `spike/cf-chain` (which stays as throwaway reference):
  - `src/worker.ts` (routes, DO), `src/chain.ts` (load, apply, roots), `src/auth.ts` (request signing / tokens),
    `src/recipes.ts` (views), contracts in `packages/contracts` (ChainAccess, Aliases) with the other contracts.
  - `src/client.ts` — UI-free, used by evm.fun and the scripts: `signRequest`, `deployChain(dump, …)`,
    `issueCode(…)`, `listCodes(…)`, `rootInfo()`.
  - `scripts/bootstrap.ts` — create the root chain on a given worker URL.
  - Tests: unit tests for the client and contract (`bun test`, in the normal suite), and one end-to-end script against
    a local `wrangler dev` (issue → redeem → deploy → refusals), run by `make e2e-node`, not by CI.
- **Root admin key:** `make dev-services` / `make deploy` read `ROOT_ADMIN_KEY` from `evm-benchmarks/.env.local`
  (gitignored). If it is missing, `bootstrap` generates one, saves it there and prints "Import this key in evm.fun
  (Accounts → Import) to issue codes". The worker gets only the address (`ROOT_ADMIN` var).
- **Makefile:**
  - `dev-services`: start `wrangler dev` (port 8799, persisted local state in `.run/node-state`) in the background,
    pid and log in `.run/`; wait until healthy; bootstrap the root chain if absent; print URL and root chain id.
  - `dev-services-status`: each service, its pid, port, URL, health, root chain id; "not running" otherwise.
  - `dev-services-stop`: stop it (pid file), report what was stopped.
  - `deploy`: `wrangler deploy` (Aaron's own `wrangler login`), then bootstrap the root chain on the live URL if
    absent; print the URL and root chain id.
- **evm.fun:**
  - **Node setting:** the worker URL, from `VITE_NODE_URL` at build (dev: `http://localhost:8799`), overridable per
    browser.
  - **Deploy codes** (shown when the acting account is the root admin): issue (code — generated by default —, TTL,
    uses) and the list of codes with expiry, uses left, and who redeemed them for which chain.
  - **Deploy chain…** on the Chains page per chain: code field → steps ("Preparing your chain…", "Checking your
    code…", "Starting your node…") each with its under-the-hood line → result: chain URL, head, state root
    "matches your browser", links to access-controls and aliases views. The chain is marked **Deployed** (chain id,
    URL, block at deploy) in its record, kept in workspace files.
  - Benchmark chains can't be deployed.

## Non-goals

- The browser node following the deployed chain, or using it from evm.fun pages (t-132).
- Devices joining (t-131/t-133), pruning old blocks, multiple root admins, deleting deployed chains, quotas.
- Upstream webevm fixes (t-130): the spike's workarounds (timestamp via internal, rebuild on rollback) carry over,
  marked.

## Anti-goals

- A private key in the repo, CI, or the worker's config.
- Anyone but the root admin creating a chain without a valid code.
- A deployed chain whose state differs from the browser chain it came from, without the user being told.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Deploy only; browser copy stays local; remote use is t-132 | One plan; the whole code flow is demonstrable |
| B | Deploy and switch the browser chain to follow the remote | Where we're going, but doubles the work and hits t-130's bugs |
| **Upload (chosen)** | Prepare block in the browser, upload the dump | One create path for root and user chains; roots match by construction |
| Inject | Worker adds system contracts at fixed addresses on create | No prepare block, but the deployed root differs from the browser's |
| **Code alone (chosen)** | Code + TTL + uses is enough | No waiting on Aaron; TTL bounds risk |
| Approve | Each redeem waits for the admin's signature | Safer for leaked multi-use codes; every deploy waits |

## Constraints

As earlier steps: tokens only, three themes, contrast tests, phone width; real chain data only; never commit
`design/`; commit with `git commit --only`; docs in `evm-benchmarks/docs/` (board t-134, an ADR, risks) and the
t-137 docs updated; nothing deploys to Cloudflare except `make deploy` run by Aaron.

## Settled after the builder check (Claude's calls)

1. **State roots from the prepare block on.** Playground chains don't compute state roots (approach 01 runs without
   `computeStateRoot`), so "Prepare for deploy" first reopens the chain from its dump in a node that does (the
   registry's existing create-from-dump path), then mines the prepare block there. That chain keeps computing roots
   from then on. Earlier blocks' header roots are not checked; the upload check compares the prepare block's root.
2. **A deployed chain runs the deploy config on both nodes:** base fee 0 (gas-free, t-116) and the worker's gas limit.
   The prepare reopen switches the browser chain to the same config, so its next blocks can match the worker's
   (needed by t-132). The config is part of the upload and is stored in the DO's meta.
3. **Plain chains only.** Sequencer and benchmark chains show "Deploy" as unavailable, with the reason.
4. **The claim tx needs a nonce.** The worker answers `GET /chains/root/nonce` for the signer of a signed request,
   giving only that signer's own nonce on the root chain (root reads stay closed otherwise). The user's key signs
   `claim(code)` with that nonce and chainId 31337. The claim's sender must equal the upload's signer.
5. **Where it lives (Aaron):** the playground moves from `https://aaronp.github.io/evm.fun/` to **`https://mychain.dev`**
   (GitHub Pages custom domain), and the worker goes on **`https://cloud.mychain.dev`** (Workers custom domain:
   `https://cloud.mychain.dev/chains/:id/…`). Both need `mychain.dev` on Aaron's Cloudflare account as a zone; the
   apex DNS points at GitHub Pages (not proxied), `cloud` is the Worker. Until the zone is ready, `make deploy` falls
   back to the `workers.dev` URL and prints it. CORS allows `https://mychain.dev`, `https://aaronp.github.io` (until
   the move) and `http://localhost:*` in dev. The Pages build gets the worker URL from a GitHub repo variable
   `NODE_URL` (→ `VITE_NODE_URL`). The site move itself (CNAME, Pages setting, DNS) is its own small card under
   Delivery (t-108): Aaron's DNS steps plus a `CNAME` file in the build.
6. **Separate root admin keys (Aaron):** local `ROOT_ADMIN_KEY` in `evm-benchmarks/.env.local`, generated if missing;
   live key chosen by Aaron in `evm-benchmarks/.env.live`; both added to `.gitignore` (neither is ignored today), never leave his machine. Only the address
   reaches the worker, passed at start (`wrangler dev --var` / `wrangler deploy --var`), never committed. Aaron imports
   each key into evm.fun to issue codes on that environment.
7. **"Redeemed for which chain"** is kept in the worker's root DO (code hash, who, chain id, time); the
   issue page reads it from there.

## Left to the builder

- Exact routes and payload shapes beyond the above; the DO's storage layout (start from the spike's).
- The evm.fun page layout and where "Deploy codes" lives (Chains page section or its own page).
- How `dev-services` detects health and handles a stale pid file.
