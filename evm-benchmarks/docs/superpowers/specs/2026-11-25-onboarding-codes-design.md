# Onboarding codes: chain deploys gated by a contract on root — design

Board: t-151 (Chain workspace). Agreed with Aaron, 2026-11-25. Supersedes the parked
`2026-11-25-accounts-onboarding-design.md` for this step (its Users/Accounts parts come later, reshaped as below).

## Intent

Admins decide who may create a chain on our Cloudflare worker. They issue **access codes** (generated, or typed:
`let-sue-in`) with an expiry and a number of deployments, and see each code's status (time left, deployments left,
who redeemed it and which chain they got). Anyone holding a live code can create a chain of their own.

We **dogfood**: the chain is the database. Codes, redemptions and who may issue live in contracts on the `root`
chain, not in worker SQL. The worker only asks root one question: may this key create this chain?

This is the first small, testable piece of a bigger model (Aaron, 2026-11-25):

- stable `userId`s (UUIDs) own key sets; a Usernames contract maps names to userIds; a key may belong to several
  userIds (many-to-many: Bob's key can be in `bob` and in `admin`);
- **AllowList** = a set of **Entities**, a tagged union: Key, User, Group (another AllowList), and relative ones
  (Self, Owner) resolved against a subject the asking contract supplies;
- **Policy** = name + address, mapping free-text actions (`read`, `deploy`, `update`…) to an `IAllows`; policies
  can be governed by other policies; later N-of-M through a smart-wallet contract, and the admin key leaving `.env`.

Only what this step needs is built now; everything above stays possible without changing the interfaces below.

## Goals

1. Admins (an AllowList on root, seeded with the root admin key) issue, list and revoke codes on root.
2. Anyone with a live code redeems it on root, which records a **grant** `{by, chainId}`; the worker creates that
   chain only if root says `isDeployAllowed(signer, chainId)`.
3. A **headless** end-to-end test proves it against the local worker.
4. A **new app** (`packages/app`), built from the prototype, with its first slice: app shell, Chains list, New
   chain (with a code, or vouched by being an issuer), and the Onboarding contract page (issue, list, revoke).

## Non-goals (this step)

Users, Usernames, Policy, Groups, Self/Owner entities; Contacts and the "For" contact picker (a free-text label
stands in); Studio, contract browsing, chain access editing in the new app; codes on chains other than root;
admin-signed tickets; changing evm.fun (left exactly as is) or its deploy-code path.

## Anti-goals

- The worker trusting anything but root's Onboarding contract (a chain owner must not be able to mint deployments).
- A code spent with no chain to show for it (today's risk R53).
- Codes or redemptions kept anywhere but on chain.

## Decisions (with Aaron)

| Decision | Choice |
|---|---|
| Whose codes the worker honours | **Root's only.** Other chains may hold Onboarding later for other purposes (approach A). |
| How the worker checks a redemption | **Root state is the token** (OAuth token introspection, RFC 7662): `redeem` records a grant; the worker reads `isDeployAllowed(signer, chainId)`. No admin-signed ticket (a contract can't sign; the admin would have to be online). |
| Contract shape | One small contract per piece, wired by address; `allows` is a one-function interface any implementer can satisfy. |
| UI | A new app from the prototype; evm.fun untouched. |

## Contracts (`packages/contracts/src`)

### `IAllows`

```solidity
interface IAllows { function allows(address caller, bytes16 subject, address owner) external view returns (bool); }
```

`subject`/`owner` are the context relative entities will resolve against later; this step's callers pass zero.

### `AllowList is IAllows`

- Entities are `(uint8 kind, bytes32 value)`; this step implements only `KIND_KEY = 1` (value = the address).
  Unknown kinds are refused at insert. `allows` = caller is one of the Key entities.
- Governed by itself: `add`/`remove` are allowed when `allows(msg.sender, 0, 0)`. The deployer passes the initial
  entities to the constructor. Removing the last entity is refused (it would lock the list).
- `entities()` view for listings.

### `Onboarding`

Constructor: `IAllows issuers`.

- `issue(bytes32 codeHash, string label, uint64 expiresAt, uint32 uses)` — issuers only; `uses` 1–1000 (the
  prototype's range); a hash
  never reused (refuse if it was ever issued). Records issuer, issuedAt.
- `revoke(bytes32 codeHash)` — issuers only; stops further redemptions. A grant already recorded stays valid
  (the redeemer did nothing wrong).
- `redeem(string code, string chainId)` — anyone. `codeHash = keccak256(bytes(code))`; requires live (not revoked,
  `block.timestamp <= expiresAt`, uses left), `chainId` a lowercase UUID (36 chars, hex and hyphens) not already
  granted. Spends one use, records grant `chainId → {by: msg.sender, codeHash, at}`.
- `isDeployAllowed(address signer, string chainId) view returns (bool)` — a grant for `chainId` exists with
  `by == signer`. (When Users exist, this resolves the signer's userIds instead; the worker doesn't change.)
- Views: `codes()` → every code with `{hash, label, issuer, issuedAt, expiresAt, uses, usesLeft, revoked}`;
  `grants(bytes32 codeHash)` → its `{by, chainId, at}` list. Issuers read them; root reads are closed to others.
- Code format, enforced by `redeem`: 4–16 chars of `A–Z 0–9`. The app normalises input before hashing and
  sending — upper-case, drop spaces and hyphens — so `let-sue-in` is `LETSUEIN` and `205 117` is `205117`.
  Generated codes are 6 digits (prototype).

## Root bootstrap

`packages/node/scripts/bootstrap.ts` (used by `make dev-services` and `make deploy`) after the root chain exists, if root's
Aliases has no `onboarding` entry: deploys `AllowList([admin key])` and `Onboarding(allowList)` as ordinary admin
txs, then registers alias `onboarding` → the Onboarding address. Idempotent, so it also upgrades an existing root
(live included) the next time `make deploy` runs. The worker finds Onboarding through root's `Aliases.get("onboarding")`
and publishes its address in `GET /health` as `root.onboarding` (an address is not a secret; a redeemer can't read
root, so this is how the app learns where to send `redeem`). The app sends `redeem` with a fixed gas limit, as
evm.fun's claim does; gas is free.

A second admin needs two entries: the AllowList (issuer) and root `ChainAccess` writer (to send txs to root). The
app's later "add admin" does both; for now it's a script/README step.

## Worker (`packages/node`)

`POST /chains` keeps today's two forms (root with no claim; evm.fun's `claim` form, unchanged) and gains a third:
`{ chainId, dump, setup, redeem? }`.

1. Stateless checks as today (`checkSetup`, size), `chainId` a lowercase UUID.
2. If `redeem` (a raw tx) is present: precheck it exactly like today's claim — to root's Onboarding, a
   `redeem(code, chainId)` call whose `chainId` equals the body's, sent by the request signer, no value/access list,
   `eth_estimateGas` succeeds — under the existing failed-code rate limit, then mine it on root as its own block.
3. Ask root `isDeployAllowed(signer, chainId)`; false → 403.
4. Create the chain with id `chainId` (the existing create path; the redeemer is its ChainAccess admin). If it
   already exists → 409 `chain already exists`.

A failed create leaves the grant, so the app retries step 4 by sending the same body without `redeem` (R53 closed
for this path). Refusal reasons the app maps to the prototype's copy: `code expired`, `code used up`,
`code revoked`, `no such code` (reasons, not one generic message: a short-lived, rate-limited code gains an
attacker nothing from them), `not allowed to create this chain`.

## Headless test

`packages/node/scripts/e2e.ts` gains an onboarding case (run by `make e2e-node`), plus unit tests in `packages/contracts`:
admin issues; a non-issuer's `issue` reverts; Sue (fresh key) redeems and creates her chain and is its admin; the
grant and status show on root; expired, used-up, revoked and unknown codes are refused with their reasons; a
second redeem for the same `chainId` is refused; a retry without `redeem` after a simulated failed create works;
Bob can't create Sue's granted `chainId`.

## New app (`packages/app`)

React 19 + Vite + TypeScript, like `packages/web`; reuses `@evmb/node` client and webevm. The prototype
(`design/prototype/Prototype.dc.html`, never committed) is the reference: replicate its tokens, spacing, copy and
layout faithfully in the app's own components.

First slice:

- **Shell:** app bar, nav, footer as in the prototype. Worker URL from config (local `http://127.0.0.1:8799`).
  **Local only this step**: mychain.dev fronts evm.fun, so hosting the new app (and its CORS origin) is decided later.
- **Keys, behind interfaces** so signers can be swapped in later (Aaron, 2026-11-25; shape after his key-vault
  interfaces, trimmed to what this step uses). The app only ever asks for a signer by public key (the address):

  ```ts
  type KeyScope = { withSigner<A>(fn: (signer: LocalAccount) => Promise<A>): Promise<A> }   // viem LocalAccount
  type KeyStore = { readonly id: string; hasKey(a: Address): Promise<boolean>; list(): Promise<Address[]>
                    resolve(a: Address, purpose: string): Promise<KeyScope> }              // throws if not held
  type KeyGenerator = { readonly id: string; generate(): Promise<Address> }                 // not every store generates
  ```

  The one implementation now, `BrowserKeyStore` (IndexedDB), is a KeyStore and a KeyGenerator and also has
  `importKey(privateKey): Promise<Address>`: import is a capability of this store, not of the interface. "You" is
  the key chosen in the profile menu (generate, or import, so the root admin can use `ROOT_ADMIN_KEY`).
  **Encrypted at rest** (Aaron, 2026-11-25), with his unlock types:

  ```ts
  type UnlockRef = { readonly mechanism: 'passkey-prf'; readonly credentialId: string }
                 | { readonly mechanism: 'passphrase'; readonly passphraseId: string } | { readonly mechanism: 'unused' }
  type Grant = { readonly ref: UnlockRef; readonly secret: Uint8Array; readonly salt?: Uint8Array }
  type UnlockProvider = { readonly ref: UnlockRef; readonly mechanism?: UnlockRef['mechanism']
                          withGrant<A>(fn: (g: Grant) => Promise<A>): Promise<A>
                          withGrant<A>(o: { salt?: Uint8Array; purpose?: string }, fn: (g: Grant) => Promise<A>): Promise<A> }
  ```

  `BrowserKeyStore` stores only `{address, encryptedPrivateKey, iv, ref, createdAt}`. Inside `resolve`/`generate`/
  `importKey` it asks its `UnlockProvider` for a Grant, derives the AES key with HKDF-SHA256(secret, salt,
  "vault-key-encryption", 32), and encrypts/decrypts with AES-256-GCM, all with WebCrypto (no new dependency). The
  Grant and the plaintext key exist only inside the callback. The salt is a random per-browser value stored beside
  the keys. This step's provider is **passphrase**: the app prompts (with the purpose) and the secret is the
  passphrase stretched with PBKDF2-SHA256 (600 000 iterations, its own stored salt); a wrong passphrase surfaces
  as a failed decrypt ("Wrong passphrase"). The decrypted signer may be kept in memory for the tab's session so the
  user isn't prompted per signature (builder: a lock action and an idle timeout). Not now: passkey-PRF (a second
  provider later), other algorithms, KeyPersistence/EncryptionPlugin as separate seams.
- **Chains:** as in the prototype, local first. **New chain** (name, description) creates a webevm chain in this
  browser ("It starts local, in this browser. You can deploy it later."). Chain detail limited to General and
  Deployment. Kept in browser storage (IndexedDB).
- **Deploy** modal, from Deployment's "Deploy chain…": *Someone gave me a code* (enter it; opening the app with
  `?code=` pre-fills it and lands on New chain then Deploy) or *Vouch* (shown only to issuers; its select lists
  only root, the one chain that can vouch: issue myself a 1-use, 10-minute code, then redeem it). The app picks
  the chain's UUID, uploads the browser chain with the redeem, then follows the cloud chain live ("Deployed and
  syncing"). Copy that says "a person with a deployed chain" becomes "an admin", since only root vouches.
- **Unfinished deploy:** if the grant was recorded but the create failed, Deployment shows that and a Retry,
  which resends the same body without `redeem`.
- **Onboarding page** (issuers): "Issue an access code" form (code generated or typed, Valid for, Deployments
  allowed, label in place of "For"), Codes list with status, deployments left, expiry and Revoke, as in the
  prototype. The app reads root by following it (issuers are root readers via ChainAccess), as evm.fun follows.

## Risks

- New: guessable codes. 6-digit and chosen codes are brute-forceable without the per-IP failed-code limit; short
  expiries and few uses are the control. Track in the risk register.
- R53 (spent code, no chain) closed for the new path.
- Keys are encrypted at rest under a passphrase, but a decrypted signer lives in memory while the tab is unlocked,
  and code running in the app's origin could prompt or read it then. A forgotten passphrase loses the keys
  (export/backup comes later).
- A second admin needs two separate grants (issuer + root writer); a missed one reads as "can't issue".

## Left to the builder

Storage layout and event names in the contracts; how the worker caches the Onboarding address; the exact refusal
strings beyond the meanings above; app file structure and state management; how "Valid for" options map to
seconds (take the prototype's options).
