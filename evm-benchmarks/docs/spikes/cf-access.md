# Spike report: on-chain read/write access for the CF chain DO

Branch `spike-cf-chain`, commit `129e7fd` (on top of `1c24e48`). Code is in `evm-benchmarks/spike/cf-chain/`.
Everything ran locally under `wrangler dev` / workerd: no deploy, no login, no credentials.

**Verdict:** read control and write control are each easy to do with a contract on the chain itself.

- **What it is:** one 50-line contract and about 40 lines in the DO.
- **What it costs:** about 15–20 µs of local `eth_call` per request.
  - The real per-request cost is ecrecover on the auth (about 1 ms in JS), not the access check.
- **Reading over HTTP is trivial:**
  - With reads open, it is a plain `curl`.
  - With reads restricted, it is `curl -H 'Authorization: Bearer …'` with a token the device signs for itself. The server keeps no session.

| # | Item | Result |
|---|---|---|
| 1 | `ChainAccess.sol` in genesis at a fixed address, admin = creator | **worked** (injected code+storage, see "Genesis choice") |
| 2 | DO enforces canRead/canWrite from its own state; signer + tx-sender admission; revoke closes WS | **worked** |
| 3 | Open GET reads; bearer-token restricted reads (401/200/403/401-expired/403-after-revoke/open) | **worked**, every case shown with real `curl` |
| 4 | End-to-end demo with PASS/FAIL + timings | **worked**: `access.ts` gives `ALL PASS` (49 checks). The old `demo.ts`, migrated to on-chain membership, still gives `ALL PASS` (26 checks) |
| – | Join code (`invite(hash, ttl)` / `claim(code)`) | **worked** (it was quick, so I implemented it) |

**Bug found on the way:**

- **The bug:** in webevm 0.9.1, `loadState` does not remove accounts that are absent from the snapshot.
- **How it showed up:** a refused block from a brand-new key left that key's nonce at 1 after the "rollback".
  - That would make the DO's state diverge from the replicas.
- **Fix in the spike:** rollback now rebuilds the node (`boot()`, about 10 ms).
- **Proof:** a probe printed `after loadState [ "0x0", "0x1" ]` (block back at 0, nonce still 1).
- This also affects the previous spike's rejected-tx path, and should go upstream.

## Files

```
contracts/ChainAccess.sol   admin, readOpen, isReader/isWriter, canRead/canWrite, set*/add*/remove*, setAdmin, invite/claim, events
build-access.ts             compiles with the repo's solc (resolved from packages/contracts), asserts the storage layout -> src/ChainAccess.json
src/chain.ts                ACCESS address, accessGenesis() (code + storage words), accessView(), read-token make/verify, baseFee 0
src/worker.ts               caller() = signed | bearer | anon; every GET gated by canRead; submit admission; WS re-check per block
src/replica.ts              Device.createChain(genesis, access), readToken(), socket(id, 'token')
access.ts                   the new end-to-end demo (port 8798)
dev.ts                      start/stop wrangler dev (shared by demo.ts and access.ts)
token.ts                    mint a token for curl: bun token.ts <chainId> <privateKey> [ttl]
demo.ts                     old demo, membership now via addWriter/removeWriter txs
```

## Genesis choice: inject code+storage (not "deploy as block 1")

- **How it is injected:** webevm has `createNode({ initialState: { addr: { code, storage, balance, nonce } } })`, which is applied before block 0.
  - `makeChain` writes the ChainAccess **runtime** bytecode at `0xacce550000000000000000000000000000000000`, plus storage words:
    - slot 0 = `readOpen<<160 | admin`
    - `keccak(addr, 1)` = 1 for each reader
    - `keccak(addr, 2)` = 1 for each writer
- **Where the config lives:** in the `genesis` record (`genesis.access`). The DO stores that record and serves it from `GET /chains/:id`, so replicas build exactly the same genesis.
  - The demo checks this: "fresh replica … replays 11 blocks, root+hash all match".
- **Why injection:**
  - The access list exists at block 0, so there is no window where the chain exists but is unprotected.
  - It needs no creator nonce or tx bootstrap.
  - The address is the same on every chain.
- **The cost of injection:** no constructor runs. The DO hand-writes the storage layout, so `build-access.ts` fails the build if `solc --storageLayout` no longer equals `admin@0+0 readOpen@0+20 isReader@1+0 isWriter@2+0 inviteExpiry@3+0`.
- **Who becomes admin:** the creator's request signer, whatever the body says (`create()` overwrites `access.admin`).

```
PASS  A creates chain b06e8c13-… (head = block 0, contract written into genesis state)
PASS  ChainAccess at 0xacce550000000000000000000000000000000000 in block 0: admin = creator 0xf39fd6e5…, readOpen = false
PASS  canRead/canWrite: admin 1/1, writer 1/1, reader 1/0, outsider 0/0
```

`bun build-access.ts` printed `built ChainAccess: runtime 2433 bytes, layout admin@0+0 readOpen@0+20 isReader@1+0 isWriter@2+0 inviteExpiry@3+0`.

## 2. Enforcement in the DO — worked

The SQLite `members` table and `POST /members` are gone. On every request the DO does this:

1. **Resolve the caller** (`caller()`). There are three cases:
   - an EIP-191 signed request (`x-sig`, single-use nonce, as before)
   - a bearer token (`Authorization: Bearer` or `?token=`)
   - anonymous
2. **For reads (every GET):** `eth_call canRead(caller ?? 0x0)` against the DO's own node at `latest`. Because `canRead = readOpen || reader || writer || admin`, the anonymous case is the same call with address 0.
   - **401** if no credential and the call returns false.
   - **403** if the credential is valid but the call returns false.
3. **For writes (`POST submit`):** a signed request is required (a bearer token gives 401). Admission is checked against the **head** state, before execution:
   - every tx sender (recovered with `recoverTransactionAddress`) must pass `canWrite`; and
   - the request signer must pass `canWrite`.
   - Exception: a block made only of `claim(code)` calls to ChainAccess (the join code, below).
4. **Lists apply from the next block.** An `addWriter`/`removeReader`/… is an ordinary tx. Admission uses head state, so a change in block N governs requests from block N+1 on.
5. **Revoking closes sockets.** After each block, the DO checks every distinct WebSocket tag (an address, or `anon`) again with `canRead`. Sockets that fail are closed with **4003**.

```
PASS  reader R submits its own tx -> 403 tx sender not a writer
PASS  writer W relays a tx signed by outsider X -> 403 tx sender not a writer
PASS  outsider X relays a tx signed by writer W -> 403 signer not a writer
PASS  submit with a bearer read token -> 401 (writes need a signed request)
PASS  block with [removeWriter(W), tx from W] -> 200: W's tx admitted (lists apply from the next block)
PASS  next block: W submits -> 403 tx sender not a writer
PASS  reader R subscribe (?token=) -> open
PASS  admin removeReader(R) tx -> 200
PASS  R's live socket closed with 4003 after the revoking block (9 ms after submit)
PASS  anonymous socket closed 4003 when reads close again
```

**Are both write checks needed?**

- **The tx-sender check is the one that matters.** It is what controls what lands on chain. Without it, any writer could relay txs signed by revoked or outside keys (the "W relays X" case above).
- **The signer check is defence in depth**, not a correctness requirement:
  - It keeps non-writers from pushing work into the DO at all (DoS, block spam).
  - It keeps the recorded `proposer` meaningful.
  - Without it, an outsider holding a writer's signed tx could submit it. That is harmless-ish, since the writer authorised it and the nonce prevents replay, but it lets outsiders race writers for the head.
- **Recommendation:** keep both. The signer check costs one more 15 µs `eth_call`.

**Cost, measured in the DO** (route `GET bench?n=2000`, averages):

| What | Cost |
|---|---|
| `canRead` eth_call | **20.5 µs** |
| `canWrite` eth_call | **14.5 µs** |
| token verify (base64 + JSON + ecrecover) | **970 µs** |
| whole admission for a 1-tx submit (`admitMs`, 1 ms clock) | ~2 ms (two ecrecovers dominate) |

Client round trip for `GET head`, mean of 50, local:

| Auth | Round trip |
|---|---|
| plain | 0.85–0.89 ms |
| bearer | 1.89 ms |
| signed request | 2.62 ms |

The `server-timing: auth;dur=…, acl;dur=…` response header shows the same split per request. workerd's clock has 1 ms granularity, so it shows `auth 1, acl 0`. So **the on-chain check is about 50× cheaper than verifying the signature on the request.** If auth cost ever matters, cache the token-to-address result per token (see risks).

## 3. Reads over HTTP — worked

**Shapes.** Every route is a GET, and every one goes through the same canRead gate:

| Route | Returns |
|---|---|
| `GET /chains/:id` | info: genesis, head, engine, `access {address, admin, readOpen}`, caller, via |
| `GET /chains/:id/head` | `{number, hash, timestamp}` |
| `GET /chains/:id/blocks?after=N` | up to 100 blocks: raw txs, receipts, stateRoot (the replica sync feed) |
| `GET /chains/:id/balance/:address` | `{address, block, wei}` |
| `GET /chains/:id/call/:contract?data=0x…` | `{block, result}` (raw `eth_call` at head) |
| `GET /chains/:id/erc20/:token/balanceOf/:address` | `{token, address, block, balance}` (decoded) |
| `GET /chains/:id/access/:address` | `{canRead, canWrite}` for that key now (useful for UIs) |
| `GET /chains/:id/subscribe` | WebSocket head feed; auth with `?token=` (browsers can't set headers on a WS), or a signed query |

bigints are serialised as decimal strings.

**Token:**

- **Format:** `base64url(JSON{chain, address, exp}) + "." + personal_sign(that base64url string)`.
- **Checks the DO makes:**
  - the payload parses
  - `chain` equals this chain
  - `exp > now`
  - `exp - now ≤ 300 s` (a TTL cap, so a device cannot mint a year-long token)
  - the recovered signer equals `address`
  - then `canRead(address)` from chain state

  There is no server session or table.
- **Who can mint one:** a device mints a token offline with one `signMessage`: `Device.readToken(chainId, ttl)`, or `bun token.ts <chainId> <key> 60` for curl.

Real curl output from `access.ts`. I shortened the token and chain id here; the full lines are in the run log.

```
$ curl -s -i http://127.0.0.1:8798/chains/<id>/head
  -> 401 {"error":"reads are restricted: sign the request or send a bearer token"}
$ curl -s -i -H 'Authorization: Bearer <R token>' http://127.0.0.1:8798/chains/<id>/head
  -> 200 {"number":4,"hash":"0xdbf4d8ae…","timestamp":1795385732}   [server-timing: auth;dur=1.000, acl;dur=0.000]
$ curl -s -i -H 'Authorization: Bearer <X token>' …/head
  -> 403 {"error":"not a reader","caller":"0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"}
$ curl … -H 'Authorization: Bearer <R token>' …/blocks?after=4                      -> 200 []
$ curl … …/balance/0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266                       -> 200 {"address":"0xf39f…","block":4,"wei":"1000000000000000000000"}
$ curl … …/call/0xacce55…0000?data=0x42087d4f…b906   (canRead(R))                    -> 200 {"block":4,"result":"0x…0001"}
$ curl … …/erc20/0x8464135c…18bc/balanceOf/0x70997970…79c8                           -> 200 {"token":"0x8464…","address":"0x7099…","block":4,"balance":"1234"}
1 s TTL token, used at once                                                          -> 200
same token after 2.1 s                                                               -> 401 {"error":"token expired"}
token with 1 h TTL                                                                   -> 401 {"error":"token ttl too long"}
token minted for another chain                                                       -> 401 {"error":"token for another chain"}
R's token with address swapped to X                                                  -> 401 {"error":"bad token signature"}
-- admin removeReader(R) tx --
$ curl … -H 'Authorization: Bearer <R token, still unexpired>' …/head                -> 403 {"error":"not a reader","caller":"0x90f7…b906"}
-- admin setReadOpen(true) tx --
$ curl -s -i http://127.0.0.1:8798/chains/<id>/head                                  -> 200 {"number":6,…}
$ curl -s -i http://127.0.0.1:8798/chains/<id>/erc20/0x8464…/balanceOf/0x7099…       -> 200 {…,"balance":"1234"}
outsider X token while open -> 200;  anonymous subscribe while open -> open;  X submit while open -> 403
-- admin setReadOpen(false) tx --
plain GET head -> 401 again;  the anonymous socket was closed 4003
```

**How a client uses it:**

- **Open chain:** `fetch(url)` or `curl`. Nothing else is needed; any HTTP cache or CDN could sit in front of it, as long as the cache keys on the URL only.
- **Restricted chain:**
  - Once per TTL (≤ 300 s), make a token with `token = await device.readToken(chainId, 60)`.
  - Send it as `Authorization: Bearer ${token}`, or as `?token=` for a WebSocket.
  - On a 401 (expired), sign a new token. On a 403, this key is not on the list.
- **Signed requests still work for reads** (per-request nonce, no replay). Replicas use them.
- **Writes always need a signed request.**

## Join code — worked (it was quick)

- **Contract side:**
  - `invite(bytes32 codeHash, uint64 ttl)` is admin-only and stores `inviteExpiry[hash] = block.timestamp + ttl`.
  - `claim(string code)` checks `keccak256(code)` exists and has not expired, deletes it (single use), and sets `isWriter[msg.sender]`.
- **DO side:** a tx from a non-writer is admitted only if it is a `claim(...)` call to ChainAccess. A block made only of claims skips the signer check. The block is **refused (403, rolled back) if any claim tx reverts**. Otherwise a bad code would still be mined, because gas is free, and non-writers could spam blocks.
- **Gas:** I set baseFee to 0 (`blockEnv.baseFeePerGas = 0n`), so a fresh key with no balance can send its claim.
  - This applies to both the DO and the replicas (shared `makeChain`).
  - The demo txs use `maxFeePerGas: 0`.

```
PASS  admin invite(hash, 120 s) tx -> 200
PASS  J claim("wrong-code") -> 403 claim failed (bad, used or expired code)
PASS  J sends some other tx -> 403 tx sender not a writer
PASS  J (no balance, not on any list) claim("blue-otter-42") -> 200
PASS  J is now a writer
PASS  J submits an ordinary tx -> 200
PASS  X reuses the revealed code -> 403 (single use)
PASS  X claims "short" after 2.1 s -> 403 (expired)
PASS  fresh replica (genesis incl. ChainAccess) replays 11 blocks, root+hash all match the DO (refused blocks left no trace)
```

**The reveal is front-runnable, and that is accepted.**

- The DO operator, or anyone who sees the claim request, can lift the plain code and claim it first.
- Aaron accepts this because the TTL is short, and the admin sees the `Claimed(hash, who)` event anyway.
- If it ever matters, use a commit-reveal claim instead: `commit(keccak(code, joiner))`, then `claim(code)` in a later block.

## How easy each is

- **Write control: easy.**
  - Two `canWrite` eth_calls per submit, at about 15 µs each, plus a recover per tx that the DO needed anyway.
  - Semantics are clean: changes are txs, they are auditable on chain through events, and they apply from the next block.
  - Every replica sees the same list, because it is chain state.
- **Read control: easy.** One `canRead` eth_call per request (20 µs), plus re-checking subscribers once per block (one call per distinct key).
  - **The one thing to know:** a read list protects what the **DO serves**, not what a device already holds. Every writer and reader that syncs keeps a full copy.
- **HTTP reads: very easy.**
  - Open reads are a plain GET.
  - Restricted reads are a stateless bearer token that any key can mint in one signature.
  - Verifying it costs about 1 ms of ecrecover. That is the dominant cost, not the access check.

## Gaps and risks

- **Reads between a revoke tx and its block:**
  - Inside the DO there is no pending window. Submit executes and mines under one mutex, and reads use `latest`.
  - So reads served while a revoke block is executing still see the old list.
  - Reads served after `submit` returns see the new list. The demo shows R's unexpired token getting 403 straight after.
  - Its live socket was closed about 9 ms after the submit returned.
  - Data R synced before the revoke stays with R. On-chain ACLs cannot change that.
- **Token replay within TTL:** a token is a bearer credential. Anyone who captures it (logs, a proxy, a shared URL with `?token=`) can read as that key until `exp`, with a cap of 300 s.
  - Mitigations:
    - a short TTL (the demo uses 60 s)
    - binding the token to a path or method if needed
    - optionally a `jti` plus a DO-side seen-set (this brings back state)
  - A revoke still takes effect at once, because `canRead` is checked on every request, not baked into the token.
  - `?token=` on a WebSocket puts the token in the URL, so in production prefer the subprotocol-header trick.
- **Signer-check gap:** none for txs. But anyone who can read can also see the raw signed txs in `blocks` (expected for a replicated chain).
- **The DO operator sees everything.** Cloudflare, or whoever runs the Worker, holds the full state, every request and every revealed join code. The operator could also ignore the contract entirely. The ACL is enforced by the operator, not against it. Replicas can detect forged *blocks* (state root/hash), but they cannot detect the operator *serving reads* to someone it shouldn't.
- **Admin is one key.**
  - `setAdmin` allows rotation; it is untested in the demo.
  - There is no multisig or threshold.
  - Losing the admin key freezes the lists.
  - Upgrading the contract would need a new chain, or an upgradeable proxy at `0xacce55…`.
- **Lists cannot be enumerated.** The mappings have no listing. To show "who is a member", replay the `Reader`/`Writer` events (`eth_getLogs`) or keep an array. I did not build this.
- **Hand-written genesis storage** is tied to the solc layout. The build asserts it, and replicas would diverge on the genesis root if it changed (the demo checks genesis hash/root).
- **Free gas (baseFee 0):** spam is bounded only by the admission checks. Non-writers can send only claims, and only claims that succeed. There are still no rate limits per writer.
- **`admin` reads are open when the chain is open:** `readOpen` exposes everything, including `GET access/:address` and the call endpoint. That is intended.
- **webevm `loadState` bug** (accounts that are absent from the snapshot survive) is real and upstream. The spike works around it by rebuilding the node on a refusal, which costs a full boot. Note that this cost is O(chain) with the current snapshot design.
- **Clock granularity:** server-timing values are whole milliseconds (workerd). The µs figures come from the in-DO loop average.

## How to run

```sh
cd evm-benchmarks/spike/cf-chain
bun build-access.ts      # (re)compile ChainAccess.sol -> src/ChainAccess.json (committed; only needed after editing the .sol)
bun access.ts            # new demo: starts/stops wrangler dev on :8798, prints PASS/FAIL + timings; ALL PASS (49)
bun demo.ts              # old demo on :8799, now with on-chain membership; ALL PASS (26)
bun token.ts <chainId> <privateKey> 60   # print a read token, then:
curl -H "Authorization: Bearer $(bun token.ts <chainId> <key>)" http://127.0.0.1:8798/chains/<chainId>/head
```

In the Claude Code sandbox, I ran Bun with `BUN_TMPDIR=$TMPDIR`. Wrangler's attempts to reach `workers.cloudflare.com` were blocked, and that did not matter for local dev.
