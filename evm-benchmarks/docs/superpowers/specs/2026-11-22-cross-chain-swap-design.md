# Step 3 · Cross-chain swap (hash-locked) — design

Board: t-62 "Cross-chain swap (HTLC)". Roadmap step 3. No mockup: designed from the Swap page.

## Intent

The same GBP/USD trade as step 2, but GBP lives on one chain and USD on another, and neither chain can see the
other. Settlement is by hash lock with timeouts:

1. the maker locks GBP on chain A under `hash(secret)`, payable to the taker, refundable after A's timeout;
2. the taker locks USD on chain B under the same hash, payable to the maker, refundable after B's (shorter) timeout;
3. the maker claims the USD on B, which reveals the secret on B;
4. the taker uses that secret to claim the GBP on A.

If either side stalls, each gets its own funds back after its timeout. The playground's page plays both parties
(switching persona with `?as=`). Done when both the claim path and the refund path work and each produces a report.
Step 7 (cross-chain order book) reuses this settlement under off-chain matching.

## Decided with Aaron

- Unsafe taker timeouts: warn and allow after an explicit confirm (A), not block.
- No mockup: the page is designed from the Swap page.
- **The maker's lock is the offer (A):** the maker names the taker and records the terms in the lock itself (what it
  wants back: chain, token, amount). The taker's view finds locks addressed to it on chain A. No offer store.

## Contract: `HashLock.sol` (one per chain, deployed like Swap)

```solidity
enum Status { None, Locked, Claimed, Refunded }
struct Lock {
  address sender; address recipient; address token; uint256 amount;
  bytes32 hash; uint64 timeoutBlock; Status status; uint64 closedBlock;
  bytes32 secret;                       // set on claim: the preimage, readable in O(1)
  string wantChain; address wantToken; uint256 wantAmount;   // the terms (empty on the answering lock)
  bytes32 answers;                      // the hash this lock answers (zero on the opening lock)
}
uint256 public nextId;                    // from 1
function locks(uint256 id) view returns (Lock)
function lock(address token, uint256 amount, address recipient, bytes32 hash, uint64 timeoutBlock,
              string wantChain, address wantToken, uint256 wantAmount) returns (uint256 id)   // pulls `amount`
function claim(uint256 id, bytes32 secret)   // recipient only; keccak256(secret) == hash; block.number < timeoutBlock
function refund(uint256 id)                  // sender only; block.number >= timeoutBlock
event Locked(uint256 indexed id, address indexed sender, address indexed recipient, bytes32 hash, address token,
             uint256 amount, uint64 timeoutBlock)
event Claimed(uint256 indexed id, bytes32 secret)
event Refunded(uint256 indexed id)
error NotLocked(uint256 id, Status status); error NotRecipient(); error NotSender();
error BadSecret(); error Expired(uint64 timeoutBlock); error NotExpired(uint64 timeoutBlock); error BadLock();
```

- The answering lock (the taker's, on B) carries `answers = hash` and no terms (wantChain empty). Both locks share
  `hash`; the page links them by hash.
- Captured at origin: `secret` and `closedBlock` stored on claim/refund, so the taker reads the secret with one call
  on chain B — no log scan.
- SafeERC20, ReentrancyGuard, checks-effects-interactions. ERC-20s only.

## Time across two chains

- Timeouts are block numbers on each lock's own chain. Two playground chains don't share a clock — each only makes
  blocks when something happens — so the page adds **"Advance N blocks"** per chain (a chain-handle `mine(n)`).
- Safety rule the UI checks when the taker locks: the taker's lock must expire with a margin before the maker's,
  measured as **blocks remaining** on each chain: `(T_A − headA) ≥ (T_B − headB) + margin` (margin default 10
  blocks). **Decided with Aaron: warn, don't block** — an unsafe timeout shows a clear warning and needs an
  explicit confirm ("Lock anyway"), so the losing case can be shown; the swap report flags "unsafe timeouts".
  The page explains that blocks are only a proxy for time across chains (a teaching point), and warns when
  either chain is close to a timeout.
- Defaults: maker's timeout = head + 100 blocks; taker's = head + 50.

## The secret

- The maker's browser generates 32 random bytes; `hash = keccak256(secret)`. The secret is kept in the app's
  storage (kv table `secrets`, keyed by hash) until the maker claims — it is the one piece of state that can't be on
  chain yet. Workspace files include it.
- The maker can see its own secret (masked, "Reveal") for teaching; nobody else's.

## Package: `@evmb/htlc` (UI-free, like `@evmb/swap`)

- ABI and calls (`lockCall`, `claimCall`, `refundCall`), reads (`readLock`, `locksFor(recipient)` from `Locked`
  logs filtered by indexed recipient, narrowed to the contract's deploy block), `newSecret()` / `hashOf(secret)`.
- `swapState(a: {request, address}, b: {request, address}, hash) → { opening?: Lock & {id}, answer?: Lock & {id},
  phase: 'offered' | 'answered' | 'claimedB' | 'complete' | 'refundedA' | 'refundedB' | 'refundedBoth' | 'expiring' }`.
- `swapReport(a, b, hash) → ` plain data: the two locks, every step with tx/block/chain, balance changes per chain,
  the secret once revealed, the outcome (completed / refunded: which side / stuck: what is still claimable), and
  failures decoded (`BadSecret`, `Expired`, `NotExpired`, OZ ERC-20) with fix copy ("Advance sue 12 blocks, then
  refund", "Approve HashLock to spend …").

## Web

- **Cross-chain swap page** (`/xswap`, sidebar under Markets after Swap), laid out like Swap:
  - App bar "Cross-chain swap · GBP (dave) ⇄ USD (sue)", "Acting as" maker/taker personas (`?as=`).
  - Pickers: chain A = the selected chain (`?chain=`), chain B (`?chainB=`), base asset on A, quote asset on B.
  - Two columns, one per chain: the chain's HashLock (or "Deploy HashLock.sol?"), head block, **Advance N blocks**,
    and the locks of the current swap with status and timeout countdown in blocks.
  - **Make (maker):** amount of GBP, wanted USD amount (price shown quote per base), taker, timeouts → "Lock {amt}
    GBP on dave" (approve step when needed, as Swap).
  - **Incoming (taker):** locks on A addressed to the acting account with their terms → "Lock {amt} USD on sue to
    accept" (safety rule checked; approve step).
  - **Claim / refund:** the maker sees "Claim {amt} USD on sue (reveals the secret)"; the taker then sees "Claim
    {amt} GBP on dave"; each side sees "Refund" once its timeout has passed and the lock is unclaimed.
  - **Timeline** of the swap across both chains and a "Report" link; "My swaps" list (both roles).
- **Report page** `/xswap/report?hash=&chain=&chainB=` built only from `swapReport`; success and refund layouts like
  the Swap report; Download JSON.
- Studio: "Deploy HashLock.sol". Benchmark chains disabled as elsewhere. Fix-it actions (Request tokens / ETH) and
  links work as on other pages.

## Walkthroughs

Two files, headless and in the ribbon: `gbp-usd-xswap` (claim path: deploy HashLock on two chains, Alice locks GBP
on dave, Bob locks USD on sue, Alice claims, Bob claims; checks balances and the report outcome "completed") and
`gbp-usd-xswap-refund` (Bob never answers; advance dave past the timeout; Alice refunds; outcome "refunded"). New
A third, `gbp-usd-xswap-unsafe`, shows the losing case: Bob confirms an unsafe timeout, Alice claims late on sue,
dave's timeout passes before Bob can claim, Alice refunds the GBP; the report flags "unsafe timeouts". New
step types: `deployHashLock`, `lockFunds`, `claimLock`, `refundLock`, `advanceBlocks`; a second chain key.

## Non-goals

- Open offers / matching (step 7), partial fills, native ETH, a relayer or automatic watcher process (the page plays
  both parties), cross-engine time (timestamps), a benchmark scenario (the harness is single-chain).

## Anti-goals

- A UI that lets the taker lock with an unsafe timeout without a clear warning and an explicit confirm.
- A secret shown or sent anywhere but the maker's own view and its claim transaction.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | The maker's lock is the offer (taker named, terms in the lock) | No store; everything on chain, survives reloads/forks/workspaces; taker must be named up front (open offers are step 7) |
| B | An offer record in the app store, then locks | Open offers, but a second source of truth that can go stale and is local to one browser |
| C | Step 6's signed orders for discovery | Really step 7 early; needs this step's hash lock anyway |

## Constraints

As earlier steps: tokens only, three themes, contrast tests, phone width; real chain data only; capture data at
origin and flag O(n) reads (locks found from logs) as risks with backlog cards; never commit `design/`; commit with
`git commit --only`; docs in `evm-benchmarks/docs/` (board t-62, ADR, risks).

## Settled after the builder check (Claude's calls)

1. **`?as=` is an account**, as on every other page (app-bar profile / Swap's "Acting as"). The role comes from
   the lock data: the acting account is the maker of locks it sent on A and the taker of locks addressed to it.
   Walkthrough steps name their signer account as elsewhere.
2. **Failures go in per-transaction reports.** A reverted lock/claim/refund emits nothing keyed by hash, so each
   attempt keeps today's `/xswap/report?tx=&chain=` (decoded error + fix copy, like `/swap/report?tx=`). The swap
   report (`?hash=&chain=&chainB=`) is built from chain state and events only: the two locks, steps, balances,
   the secret, and the outcome incl. "stuck: still claimable / refundable after block N".
3. **Terms name chain B and its contract:** `wantChain` is the registry chain id (kept across workspace files;
   a fork is a different chain) and the terms gain `wantLock` (B's HashLock address), so a redeploy on B can't
   orphan the answer. The page shows the chain's name; an unknown id reads "chain not in this browser".
4. **No `answers` field.** A lock with empty terms is an answer. `swapState` pairs the opening lock (on A) with an
   answer on B only when hash, sender = the opening lock's recipient, recipient = its sender, token = `wantToken`
   and amount ≥ `wantAmount` all match; other locks with the same hash are ignored. `BadLock` refuses zero amount,
   zero recipient, a timeout not after the current block, and terms with a zero `wantToken`.
5. **Workspace files** gain the `secrets` table.

## Left to the builder

- Exact page layout within the description; the report's narrow-screen layout.
- How "Advance N blocks" mines on each approach (empty blocks).
