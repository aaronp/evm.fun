# Deploy role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chains have read, write and deploy roles; a submitter without deploy can't create contracts, in the cloud and locally; evm.fun grants and shows deploy.

**Architecture:** `ChainAccess` gains a deployer set and `GRANT_DEPLOY`; the chain `ACL` exposes it (falling back to write on old chains); `ChainService.submit` refuses creation txs per tx; evm.fun checks the device's role before sending and lets the admin grant/remove it.

**Tech Stack:** Solidity (packages/contracts build), Bun, TypeScript, viem, React 19.

**Spec:** `docs/superpowers/specs/2026-11-25-deploy-role-design.md`

## Global Constraints

- `GRANT_DEPLOY = 8`; invites accept `grants` 1–15; a deploy claim also adds a writer.
- `canDeploy(a)` = deployer or admin. New storage is appended after `invites`; existing slot layout unchanged (the layout test in packages/contracts must still pass).
- Refusal reason (worker, per tx, code `invalid`): `<signer> can't deploy contracts on this chain`. Local refusal (evm.fun): `This device can't deploy contracts on <chain name>.`
- Old chains (no `canDeploy` in their `ChainAccess`): deploy falls back to `canWrite`.
- `packages/node/src/*` no `bun:*`/`node:*`. Tokens only in web.
- Commit with `git commit --only -m … -- <paths>`, messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `design/`, `.env.*`, `.run/`, root `package.json`. Tests per package (web files individually if Bun segfaults, R11), `bun run web:build`, `make e2e-node`.

## Review Focus

1. **A batch mixing a creation and a call from a writer without deploy** → the call is mined, the creation refused alone.
2. **An old chain (pre-change ChainAccess)** → its writers still deploy; nothing errors on the missing function.
3. **A deploy invite claimed by a new device** → it becomes writer + deployer; a reader/writer invite never grants deploy.
4. **Removing deploy from a device with pending creations** → they settle refused with the reason, other pending txs unaffected.
5. **The admin** can always deploy even if not listed as a deployer.

---

### Task 1: Contract, ACL and worker

**Files:**
- Modify: `packages/contracts/src/ChainAccess.sol` (+ its build/test), `packages/node/src/acl.ts`, `packages/node/src/service.ts`, `packages/node/src/client.ts` (`GRANT_DEPLOY`, `Member.deploy`, `accessTx` fns `addDeployer`/`removeDeployer`)
- Test: `packages/contracts/chainaccess.test.ts`, `packages/node/test/acl.test.ts`, `service.test.ts`, `service-devices.test.ts`

**Interfaces:**
- Produces: `ACL.list(): { write; read; deploy: Address[]; readOpen }`, `ACL.canDeploy(a): Promise<boolean>` (fallback to `canWrite` when the call reverts); `Member` gains `deploy: boolean`; `accessTx(…, 'addDeployer' | 'removeDeployer', address)`.

- [ ] **Step 1: Failing tests:** contract — `deploy invite adds writer and deployer`, `grants 16 refused`, `removeDeployer keeps writer`, `admin canDeploy`; node — `writer without deploy: creation refused with the reason, call in the same batch mined`, `deployer creation mined`, `old ChainAccess (deployed from the previous bytecode) falls back to canWrite`, `join accepts a deploy invite`, `nodes lists deploy`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + node/contracts packages + `make e2e-node`.
- [ ] **Step 5:** Commit `feat(contracts,node): deploy role — deployer set, GRANT_DEPLOY, creation txs need deploy (t-152)`.

### Task 2: evm.fun

**Files:**
- Modify: `packages/web/src/cloud/followerChain.ts` (role incl. deploy; local refusal), `packages/web/src/cloud/devices.ts` (`inviteDevice` grants; `removeDeploy`), `packages/web/src/components/cloud/InviteWizard.tsx` ("Can deploy contracts" checkbox, writers only, default off), `packages/web/src/components/cloud/DevicesPanel.tsx` (deploy shown per member; "Remove deploy" for the admin)
- Test: `packages/web/test/follower-chain.test.ts`, `cloud-devices.test.ts`

- [ ] **Step 1: Failing tests:** `a device without deploy: a creation send throws the local message, a call goes through`; `invite with deploy sends GRANT_WRITER|GRANT_DEPLOY`; `removeDeploy sends removeDeployer`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + web files + build.
- [ ] **Step 5:** Commit `feat(web): grant, show and enforce the deploy role (t-152)`.

### Task 3: Docs and board

- [ ] **Step 1:** ADR-0025 (chain ACL roles: read, write, deploy), `packages/node/README.md` (roles, grants, refusal), devices spec note, board t-152 DoD ticked (browser check unticked → Doing). Regenerate cards with the tools.
- [ ] **Step 2:** Commit `docs: deploy role (t-152)`.
