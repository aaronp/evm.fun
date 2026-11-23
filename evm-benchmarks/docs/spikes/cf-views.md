# Spike report: views, recipes, generalised invites (t-135, t-133)

Branch `spike-cf-chain`, commit `53309be` (on top of `129e7fd`). Code in `evm-benchmarks/spike/cf-chain/`.
All local under `wrangler dev` / workerd. No deploy, no login, no credentials.

**Verdict:** works. A consumer gets readable current-state JSON at `GET /chains/:id/:alias/latest`, gated by the alias's own access contract and independent of chain read. Views cost one `eth_call` per field (self-describing) or 1 log scan + 1 `eth_call` per holder (erc20). That is ~1 ms client round trip at 10 holders and ~4.4 ms at 200.

| # | Item | Result |
|---|---|---|
| 1 | Alias registry on chain | **worked**: `Aliases.sol` injected in genesis at `0xa11a500000000000000000000000000000000000` (code only, empty storage); admin = the chain's ChainAccess admin |
| 2 | Views + per-alias read rules, `access-controls/latest`, `aliases` list | **worked**: view-only key gets 200 on its view and 403 on head/blocks/balance/call/erc20 and on other aliases; readOpen on the alias's access contract makes the view a plain GET while chain reads stay 401 |
| 3 | Recipes `self-describing` and `erc20`, costs at 10 / 200 holders | **worked** |
| 4 | Invites `{expiry, usesLeft, grants}` single- and multi-use | **worked** (single-use captured code refused; 3 keys on one code; refused after expiry; used-up refused) |
| 5 | `views.ts` demo with real curl | **worked**: `ALL PASS`. `access.ts` still `ALL PASS` (49), `demo.ts` still `ALL PASS` |

## Files

```
contracts/ChainAccess.sol  + enumerable readers()/writers() (array + 1-based index map, swap-and-pop), invites struct,
                             constructor (admin = deployer) so the same code can be deployed as a separate view access contract
contracts/Aliases.sol      NEW: register/remove/get/all, lowercase [a-z0-9-] 1..32, "access-controls" reserved
contracts/Notice.sol       NEW: self-describing demo contract (author, title, revision, lines[])
build-access.ts            compiles all three -> src/<Name>.json {abi, runtime, bytecode}; asserts ChainAccess + Aliases layouts
src/chain.ts               genesis writes enumerable sets; injects Aliases code; accessView(..., to) for any access contract
src/recipes.ts             NEW: RECIPES map, counted() rpc wrapper, ACCESS_VIEWS (built-in access-controls fields)
src/worker.ts              view route, aliases route, view() under serial()
views.ts                   NEW demo, port 8797
access.ts                  only the invite() call changed to the new 4-arg form
```

## 1. Alias registry — worked

**Choice: in genesis, code only.**
- `Aliases` has no admin storage. `onlyAdmin` checks `msg.sender == ChainAccess(0xacce55…).admin()`, so there is one admin key per chain, and rotating it (setAdmin) moves both.
- Storage starts empty, so nothing has to be hand-written; same address on every chain; replicas get it from `makeChain` like ChainAccess (both replica checks in `access.ts`/`demo.ts` pass with it in genesis).
- An entry is `{ name, target, recipe, params, access }`. `access = 0x0` means the chain's ChainAccess. `params` is a recipe-specific string (see recipes). Re-registering a name updates it.
- Name rules in the contract: `[a-z0-9-]`, 1..32, not `access-controls` (built in). `register("GBP")` mined with status 0 in the demo.
- Registering/removing is an ordinary admin tx; a non-writer's register is refused by the DO (403), a writer who is not admin reverts `admin only`.

```
PASS  one block: gbpAccess.addReader(V); notice.post(…); Aliases.register("gbp" -> erc20, access = gbpAccess); register("notice" -> self-describing, access = chain)
PASS  register("GBP") reverts (names are lowercase [a-z0-9-])
PASS  register("tmp") / plain tmp/latest -> 200 / remove("tmp") / tmp/latest -> 404 after remove
```

## 2. Views and their access — worked

**Routes**

| Route | Guard | Returns |
|---|---|---|
| `GET /chains/:id/:alias/latest` | `canRead(caller)` on the **alias's** access contract (anon = `canRead(0x0)` = its readOpen) | `{ alias, contract, recipe, access, block, state, cost }` |
| `GET /chains/:id/access-controls/latest` | chain ChainAccess | built-in alias: ChainAccess through the self-describing recipe, `state = { admin, readOpen, read, write }` |
| `GET /chains/:id/aliases` | chain read | `[{ alias, contract, recipe, params, access }]` |

- Same credentials as before: bearer token / signed request / anonymous. 401 without a credential, 403 with one that is not on the list.
- The view route is checked before the chain's GET gate, only for the exact shape `/:alias/latest`, so raw routes are unaffected.
- A view runs under the DO's `serial()` mutex, so every `eth_call` of one view sees the same head; `block` is that head.
- I nested the recipe output under `state` rather than merging it with `alias/contract/recipe/block`, so a contract field called `block` or `contract` cannot collide.

**The separate GBP access contract** is the same ChainAccess code, deployed by the admin (constructor makes the deployer admin). Its read list has V; the chain's list does not.

Real curl (tokens are full in the run log; abbreviated here):
```
$ curl -s -i -H 'Authorization: Bearer <A>' http://127.0.0.1:8797/chains/<id>/aliases
  -> 200 [{"alias":"gbp","contract":"0x5fbdb2315678afecb367f032d93f642f64180aa3","recipe":"erc20","params":"1","access":"0xe7f1725e7734ce288f8367e1bb143e90bb3f0512"},
          {"alias":"notice","contract":"0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0","recipe":"self-describing","params":"function author() view returns (address);function title() view returns (string);function revision() view returns (uint64);function lines() view returns (string[])","access":"0xacce550000000000000000000000000000000000"}]
$ curl … -H 'Authorization: Bearer <V>' …/aliases                -> 403 {"error":"not a reader","caller":"0xc7d4…6872"}

$ curl -s -i -H 'Authorization: Bearer <A>' http://127.0.0.1:8797/chains/<id>/access-controls/latest
  -> 200 {"alias":"access-controls","contract":"0xacce55…0000","recipe":"self-describing","access":"0xacce55…0000","block":6,
          "state":{"admin":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","readOpen":false,"read":[],"write":["0x5A0576dC092e31F5b9CeAF2F3B4fC6e67c0158AB"]},
          "cost":{"ethCalls":4,"logScans":0,"logs":0,"ms":2}}   [server-timing: auth;dur=1.000, acl;dur=0.000, recipe;dur=2.000]

$ curl -s -i -H 'Authorization: Bearer <V>' http://127.0.0.1:8797/chains/<id>/gbp/latest
  -> 200 {"alias":"gbp","contract":"0x5fbd…0aa3","recipe":"erc20","access":"0xe7f1…0512","block":6,
          "state":{"name":"Pound Sterling","symbol":"GBP","decimals":2,"totalSupply":"100000000","holders":10,
                   "balances":{"0xf39fd6e5…2266":"99450000","0x22f7cd0f…7be7":"30000","0xe7d095f3…661f":"30000","0x8d780d3e…9008":"40000",…}},
          "cost":{"ethCalls":15,"logScans":1,"logs":12,"ms":1}}
V: head / blocks / balance/:a / call/:c / erc20/:t/balanceOf/:a   -> 403 {"error":"not a reader","caller":"0xc7d4…6872"}
V: notice/latest            -> 403 {"error":"not a reader of this view","alias":"notice",…}
V: access-controls/latest   -> 403
A: nope/latest              -> 404 {"error":"no such alias","alias":"nope"}

$ curl -s -i http://127.0.0.1:8797/chains/<id>/gbp/latest        -> 401 {"error":"view is restricted: send a bearer token","alias":"gbp"}
-- A: gbpAccess.setReadOpen(true) --
$ curl -s -i http://127.0.0.1:8797/chains/<id>/gbp/latest        -> 200 {…"symbol":"GBP"…}
$ curl -s -i http://127.0.0.1:8797/chains/<id>/head              -> 401 (chain reads stay closed)
$ curl -s -i http://127.0.0.1:8797/chains/<id>/notice/latest     -> 401
```

Self-describing Notice:
```
$ curl -s -i -H 'Authorization: Bearer <A>' …/notice/latest
  -> 200 {"alias":"notice",…,"state":{"author":"0xf39F…2266","title":"Opening hours","revision":"1","lines":["Mon-Fri 9-17","Sat 10-14","Sun closed"]},"cost":{"ethCalls":4,…}}
```

## 3. Recipes — worked

`src/recipes.ts`: `RECIPES: Record<id, (rpc, contract, params) => Promise<object>>`. The worker looks up the alias, checks the alias's access, then runs `RECIPES[alias.recipe](countedRpc, contract, alias.params)`. bigints become decimal strings in the worker's JSON replacer; addresses come out as viem returns them (checksummed in self-describing, lowercase map keys in erc20).

- **`self-describing`**: `params` = `;`-separated human-readable ABI fragments, each optionally prefixed `key=` to rename the JSON field. Every zero-arg `view`/`pure` fragment is one `eth_call`, decoded with viem; multi-return functions become an object by output name.
  - Choice: the list is stored **with the alias**, not looked up from an off-chain ABI. So the chain itself says how to read the contract, and a new contract needs no worker change.
  - The built-in `access-controls` uses `admin; readOpen; read=readers(); write=writers()` → exactly `{admin, readOpen, read, write}`. (ChainAccess exposes `readers()`/`writers()` as asked; the rename gives the requested JSON keys.)
- **`erc20`**: `params` = deploy block. One `eth_getLogs` for `Transfer` from that block, holder set = every `to`, then `balanceOf` per holder now, zeros omitted; plus `name/symbol/decimals/totalSupply`. Shown with the repo's `AssetToken` (OZ ERC20) launched as "Pound Sterling"/"GBP", 2 decimals. One holder sent everything on and is omitted (10 holders listed, 11 ever received).

**Adding a recipe:** write one function in `recipes.ts`, add it to `RECIPES`, redeploy the worker; then the admin registers an alias naming it. An alias naming an unknown recipe gets 500 `unknown recipe`.

### Costs (in-DO counters from `counted()`, client round trip = mean of 20 plain GETs, local)

| View | eth_calls | log scans (logs) | recipe time in DO | client round trip |
|---|---|---|---|---|
| access-controls | 4 | 0 | <1 ms | 1.08 ms |
| notice | 4 | 0 | <1 ms | 1.01 ms |
| gbp, 10 holders | 15 | 1 (12) | <1 ms | 1.31 ms |
| gbp, 200 holders | 205 | 1 (202) | 3 ms | 4.37 ms |

- erc20 cost is `4 + holders` eth_calls plus a linear scan over **all** logs on the node (webevm's `eth_getLogs` filters a flat in-memory array per call). At ~15 µs per eth_call (previous report), 200 holders ≈ 3 ms, which matches.
- workerd's clock is 1 ms granular, so the sub-ms rows show 0–2 ms.
- Not measured: 10k+ holders or 100k+ logs; linear extrapolation says ~150 ms at 10k holders, which is where caching or an indexer becomes necessary.

## 4. Invites, generalised — worked

`invites[keccak256(code)] = { expiry: uint64, usesLeft: uint32, grants: uint8 }`, `grants` bitmask `READER=1 | WRITER=2` on that ChainAccess.

- `invite(hash, ttl, uses, grants)` admin-only; `revokeInvite(hash)`.
- `claim(code)`: requires `usesLeft > 0 && block.timestamp <= expiry`; decrements; deletes at 0 (single use leaves nothing to capture); grants the roles (idempotent adds); emits `Claimed(hash, who, usesLeft)`.
- DO admission is unchanged: a non-writer may send only `claim(...)` to ChainAccess, and the block is refused if a claim reverts.
- **Advancing time:** the proposer may stamp a block up to now+30 s, so the demo claims in a block stamped +25 s, past a 10 s expiry — no sleeping.

```
PASS  A invite("one-time-otter", 120 s, uses 1, grants reader)
PASS  J1 claims -> 200
PASS  J1 can now read the chain (GET head -> 200)
PASS  invites(hash) is deleted (usesLeft 0, expiry 0)
PASS  J2 claims the captured code -> 403 claim failed (bad, used or expired code)
PASS  A invite("team-badger", 10 s, uses 50, grants reader|writer)
PASS  K1 / K2 / K3 claims team-badger -> 200
PASS  invites(team-badger): usesLeft 47, expiry 1795387471
PASS  K1 reads access-controls/latest: K1..K3 in both read and write
PASS  K4 claims in a block stamped +25 s (past expiry, 47 uses left) -> 403 claim failed (bad, used or expired code)
PASS  three keys claim a 2-use code -> 200, 200, 403 (used up)
```

**Same invite for a chain-creation slot (t-134, not built):** the root chain's registry holds the same `{expiry, usesLeft, grants}` record with a third grant bit, `CREATE_CHAIN = 4`. `claim(code)` there increments `slots[msg.sender]` instead of adding to a list. The Worker's `POST /chains` then `eth_call`s `registry.slots(signer)` on the root chain DO before creating the DO, and records `owner[chainId] = signer` with one tx that consumes the slot. The contract-side code is identical; only the grant action and the Worker's check differ. A multi-use code would be "N people may each create one chain until Friday".

## What a real build needs

- **Caching:** a view's result is a pure function of (alias, head block). Cache `{alias, block} → JSON` in the DO (memory) and invalidate on each new block; with open views put a CDN in front keyed by URL plus `ETag: <block hash>`. Restricted views must not be shared-cached (`Cache-Control: private`).
- **Event-folding indexer for heavier cases:** erc20 currently rescans every Transfer since deploy and calls balanceOf per holder per request. A real build folds each new block's logs into a per-alias state table in DO SQLite (holder set, or balances directly from Transfer deltas), at block-commit time, so a view is one SELECT. The same fold works for anything event-shaped (order books, membership history). Recipes become `{ init, onLog, render }` rather than one function.
- **Recipe registration:** recipes are code in the worker; the registry only names them. Options: (a) keep a curated set in the worker (versioned ids like `erc20@1`); (b) declarative recipes stored on chain (the self-describing fragment list already is one — extend it with arg-bearing calls and log folds); (c) sandboxed user code. (b) covers most "our own contracts" cases with no deploy.
- **Pagination / size caps:** 200 holders is ~12 KB of JSON; a 100k-holder token needs `?cursor=` and a cap.
- **Historic views:** `/latest` only. `/:block` would need webevm historic state for eth_call or the indexer's history.
- **Auth for alias access contracts via invites:** the DO only admits claims sent to the chain's own ChainAccess. Letting an invite on a view access contract (e.g. "read GBP") be claimed by a non-writer needs the admission rule to accept claims to any contract whose code hash is ChainAccess's.

## Risks / gaps

- **A view leaks what its recipe reads.** The view guard is the alias's list, but the recipe can call anything. `self-describing` params are set by the admin, so the admin decides what a view exposes; a careless alias (e.g. pointing at a contract with sensitive views) publishes them under the looser rule. That is by design but needs to be visible in a UI.
- **View-only keys still see addresses of other holders** in the erc20 view — that is the point of the view, but it is more than a `balanceOf` for oneself.
- **Cost is O(holders) eth_calls + O(all logs) per request, and runs under the DO's write mutex**, so a heavy view delays block submission. At 200 holders it is 3 ms; caching per block removes the repeat cost.
- **`erc20` trusts the token.** A non-standard token (rebasing, missing Transfer events for mints) gives wrong holder sets. The recipe is only right for well-behaved ERC-20s.
- **The deploy block is a param the admin types.** Too high misses holders; 0 is always correct but scans more.
- **Enumerable sets** use swap-and-pop, so the order of `read`/`write` changes on removal. Genesis storage for the arrays is hand-written; the build asserts the layout (now 7 fields).
- **Multi-use invites can be drained** by one person with many fresh keys (keys are free). `usesLeft` bounds the damage; the expiry bounds the window. A per-invite `claimed[who]` would stop the same key reusing it but not fresh keys.
- **Front-running of the revealed code** (previous report) still applies, and matters more for multi-use codes, which are by nature shared with several people.
- **Self-describing params live on chain as text**: each alias is a few hundred bytes of storage. Fine at this scale.

## How to run

```sh
cd evm-benchmarks/spike/cf-chain
bun build-access.ts   # ChainAccess, Aliases, Notice -> src/*.json (committed)
bun views.ts          # this spike, :8797, ALL PASS
bun access.ts         # :8798, ALL PASS (49)
bun demo.ts           # :8799, ALL PASS
```

Bun ran with `BUN_TMPDIR=$TMPDIR` in the Claude Code sandbox; wrangler's calls to `workers.cloudflare.com` were blocked and did not matter.
