# @evmb/htlc

UI-free helpers for `HashLock.sol` (hash time-locked transfers, ADR-0021) on two chains: the maker's opening lock on chain A carries the terms; the taker's answer on chain B has none. Runtime deps: `viem` and `@evmb/assets` (types only: `Request`). No DOM, React or IndexedDB. Locks are never cached; they are read from the chain each time.

- **Identity:** `hashLockAbi` (embedded copy of the contract ABI; a test pins it to `@evmb/contracts`).
- **Secret:** `newSecret()` is 32 random bytes (`crypto.getRandomValues`); `hashOf(secret)` is `keccak256` of them, what `claim` checks.
- **Calls:** `lockCall(hashLock, { token, amount, recipient, hash, timeoutBlock, wantChain?, wantLock?, wantToken?, wantAmount? })` (leave the terms out for an answer), `claimCall(hashLock, id, secret)`, `refundCall(hashLock, id)` return `{to, data}`.
- **Reads:** `readLock(request, address, id, chain?)` reads `locks(id)` as a `LockView` (`Lock & { id, chain, address }`, status `none | locked | claimed | refunded`). `locksFor(request, address, fromBlock, { recipient?, sender?, hash?, chain? })` finds locks from `Locked` logs since `fromBlock` (the contract's deploy block), filtered by the indexed sender/recipient and by hash, oldest first; its views also carry `lockedBlock` and `lockedTx`. That scan grows with the contract's locks (risk; ADR-0021). `chain` is the caller's registry chain id: it only labels the views.
- **State:** `swapState(a, b, hash)` with `Side = { chain, request, address, head, fromBlock }`. The opening lock is the earliest lock on A with this hash and terms. An answer counts only when `b.chain` equals the opening's `wantChain`, `b.address` equals its `wantLock`, and the lock has no terms, the same hash, sender = the opening's recipient, recipient = its sender, token = `wantToken` and amount ≥ `wantAmount` (the earliest such lock wins); every other lock with the hash is ignored. `phase`: `refundedBoth`, `refundedA`, `refundedB`, `complete` from the statuses first; then `expiring` while a lock is still locked and has ≤ 10 blocks left on its chain (including past its timeout); then `claimedB`, `answered`, `offered`. Without an opening lock it reads `offered` with no locks. `blocksLeft` is `timeoutBlock − head` per lock; `safe` (once answered) is `isSafe` with both heads now.
- **Safety:** `isSafe(tA, headA, tB, headB, margin = 10n)` is `(tA − headA) ≥ (tB − headB) + margin`: the maker's lock must outlast the taker's by the margin, in blocks on each chain.
- **Report:** `swapReport(a, b, hash, { headAAtAnswer? })` is plain JSON-ready data (bigints as decimal strings): both locks (without their `secret`), `steps` (`chain`, `action` lock/claim/refund, `side` maker/taker, `id`, `tx`, `block`; a claim or refund's tx is one block's logs from the lock's stored `closedBlock`), `balanceChanges` per chain derived from the locks (an escrowed lock shows the HashLock holding it; a refunded one nets to nothing), `stillLocked` (claimable before, refundable from, `timeoutBlock`), `outcome` (`completed`, `refunded (maker)`, `refunded (taker)`, `refunded (both)`, `stuck` while any lock is still locked) and `unsafe`. `secret` appears only once the B-side lock is claimed. Throws when A has no opening lock with the hash.
  - **`unsafe` is a proxy.** The rule needs A's head at the moment B answered, which no chain records (two chains share no clock). With `headAAtAnswer` it is `!isSafe(T_A, headAAtAnswer, T_B, answerBlock)`; without it, each side is measured from its own lock block: `!isSafe(T_A, openingBlock, T_B, answerBlock)`. That misses an unsafe answer when chain A advanced between the opening lock and the answer, so a page that knows A's head when the taker locked should pass it.
- **Errors:** `decodeHtlcError(data, { chain?, head?, token? })` decodes `NotLocked`, `NotRecipient`, `NotSender`, `BadSecret`, `Expired`, `NotExpired`, `BadLock`, `SafeERC20FailedOperation`, `ReentrancyGuardReentrantCall`, `ERC20InsufficientAllowance`, `ERC20InsufficientBalance`, `Error(string)` and `Panic(uint256)` as `{ name, args, fix }`, else `undefined`. With `chain` and `head`, `NotExpired`'s fix is "Advance {chain} {n} blocks, then refund." with the exact count (the refund then lands on the timeout block); with `token`, ERC-20 amounts are `{amount:<token>:<raw>}` placeholders for `fillText` (`@evmb/swap`).

```ts
import { newSecret, hashOf, lockCall, claimCall, swapState } from '@evmb/htlc'

const secret = newSecret(), hash = hashOf(secret) // the maker keeps the secret
await send(maker, lockCall(lockA, { token: gbp, amount, recipient: taker, hash, timeoutBlock: headA + 100n,
  wantChain: 'sue', wantLock: lockB, wantToken: usd, wantAmount }))
await send(taker, lockCall(lockB, { token: usd, amount: wantAmount, recipient: maker, hash, timeoutBlock: headB + 50n }))
await send(maker, claimCall(lockB, 1n, secret)) // reveals the secret on B
const { answer } = await swapState(sideA, sideB, hash)
await send(taker, claimCall(lockA, 1n, answer!.secret))
```

Limits: ERC-20 tokens only; fee-on-transfer and rebasing tokens are unsupported; block counts are only a proxy for time across chains.

Tests: `bun test packages/htlc` (two webevm chains).
