# Deploy role — short design

Board: t-152 (child of t-151, Chain workspace). Agreed with Aaron, 2026-11-25.

## Intent

Chains get three roles: **read** (read chain data), **write** (submit txs), **deploy** (submit contract creations).
The Chain workspace's access screens give each person, group or device any of the three.

## Design

- Following ADR-0025 the chain ACL checks the **submitting key**, never a tx's sender. Deploy = the submitter may
  include txs with no `to`. The admin has all three. A contract creating contracts (factories) is not checked here;
  that is contract-level (t-147).
- `ChainAccess.sol`: a deployer set like readers/writers (`addDeployer`, `removeDeployer`, `deployers()`,
  `isDeployer`, `canDeploy(a)` = deployer or admin), new storage appended after `invites`. Invite flag
  `GRANT_DEPLOY = 8` (invites accept `grants <= 15`); a claim with deploy also adds the key as a writer.
- Worker: the `ACL` interface gains `deploy: Address[]` in `list()` and `canDeploy(a)`. On submit, a creation tx from a
  submitter without deploy is refused per tx: `invalid`, "<signer> can't deploy contracts on this chain". The join
  precheck accepts a deploy grant. `/nodes` members gain `deploy: boolean`.
- Chains created before this change run the old `ChainAccess` (no `canDeploy`): the worker falls back to `canWrite`,
  so their writers keep deploying.
- evm.fun: a device without deploy is refused locally before sending: "This device can't deploy contracts on
  <chain>." The invite wizard offers "Can deploy contracts" for writers; the Devices panel shows deploy and can remove
  it (`removeDeployer`).

## Non-goals

Restricting which contracts a deployer may create; per-contract deploy rules; deploy without write.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| **Submitter-checked role (chosen)** | Chain ACL on the submitting key | Consistent with ADR-0025; factories unchecked |
| Tx-sender-checked | Check each creation's sender | Conflates chain and contract ACLs (rejected in ADR-0025) |
