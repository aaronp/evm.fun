# Invite a device: wizard, join link, QR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin adds a device through a 2-step wizard (create an access code → open this on another device, with a QR code), optionally as one join link that carries the code; the joining device prefills the code from the link and drops it from the address bar.

**Architecture:** Pure link helpers in `cloud/join.ts` (tested), the Join form/Cloud page read and strip `code`, and the invite form in `DevicesPanel.tsx` moves into its own `InviteWizard.tsx` with a small `QrCode.tsx` over `uqr`.

**Tech Stack:** Bun, React 19, Tailwind 4, react-router (hash routes), viem, `uqr` 0.1.3.

**Spec:** `docs/superpowers/specs/2026-11-24-invite-wizard-design.md` (amends `2026-11-23-devices-follow-design.md`).

## Global Constraints

- Join link: `#/cloud/join?node=…&chain=…[&code=…]` built with `URLSearchParams`; `code` present only when the owner ticks **Create a single join link (includes the code)** (off by default).
- Warning beside the ticked checkbox, verbatim: "Anyone with this link can join as <role> until it's used up or expires. Share it only somewhere private." (`<role>` = reader | writer).
- A code read from a link: trimmed, 1–200 chars, else ignored. After reading it, the route is replaced (`navigate(…, { replace: true })`) with the same link minus `code`. Opening a link never joins; **Join** is still pressed.
- QR: `uqr` **0.1.3** exactly; SVG, dark on light in every theme via two theme-invariant tokens (`--c-qr-fg`, `--c-qr-bg`) added to all theme blocks in `src/theme/tokens.css` and to the contrast test at ≥ 7:1.
- Tokens only (no raw colours), three themes, phone width, contrast tests stay green.
- Commit with `git commit --only -m … -- <paths>`, messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `design/`, `.env.*`, `.run/`, root `package.json`. Full `bun test` before each commit (R11: rerun on a crash, outside the sandbox if needed).

## Review Focus

1. **A code with `&`, `#`, `=`, spaces or unicode** round-trips through `joinLink` → `joinPrefill` unchanged.
2. **Back button after opening a link with a code** doesn't bring the code back into the address bar.
3. **Unticked invites** never put the code in the link or the QR.
4. **A second join link opened while the Join form is open** replaces chain and code (as the existing "another join link" effect does for node/chain).
5. **Dark theme:** the QR stays dark-on-light with a quiet zone (scannable).

---

### Task 1: Join links that may carry the code

**Files:**
- Modify: `packages/web/src/cloud/join.ts`, `packages/web/src/components/cloud/JoinForm.tsx`, `packages/web/src/pages/Cloud.tsx`
- Test: `packages/web/test/cloud-join.test.ts`

**Interfaces:**
- Produces: `joinLink(base: string, nodeUrl: string, chainId: string, code?: string): string` (adds `code` only when given and non-blank); `joinPrefill(search: string): { nodeUrl?: string; chainId?: string; code?: string }`; `JoinForm` gains prop `code?: string` (initial code, applied like `chainId` in the "another join link" effect).

- [ ] **Step 1: Failing tests:** `joinLink without a code has no code param`; `joinLink(…, 'a&b #c=d ü')` → `joinPrefill` returns that code exactly; `joinPrefill ignores a blank or 201-char code`; `joinPrefill trims the code`.
- [ ] **Step 2:** run `bun test packages/web/test/cloud-join.test.ts` → FAIL.
- [ ] **Step 3:** implement; in `Cloud.tsx`, when `link.code` is set pass it to `JoinForm` and replace the route with `joinLink`'s query minus `code` (hold the code in state so the replace doesn't clear the form). Update the "never a code" doc comments.
- [ ] **Step 4:** PASS + full `bun test` + `bun run web:build`.
- [ ] **Step 5:** Commit `feat(web): join links may carry the invite code; the Join form takes it and drops it from the address bar (t-145)`.

### Task 2: Invite wizard with QR; docs and board

**Files:**
- Create: `packages/web/src/components/cloud/InviteWizard.tsx`, `packages/web/src/components/cloud/QrCode.tsx`
- Modify: `packages/web/src/components/cloud/DevicesPanel.tsx` (replace `Invite` with `InviteWizard`), `packages/web/package.json` (`uqr` 0.1.3), `bun.lock`, `packages/web/src/theme/tokens.css`, `packages/web/test/contrast.test.ts`, `packages/web/src/cloud/devices.ts`
- Docs: `docs/superpowers/specs/2026-11-23-devices-follow-design.md` (lines on "never in the link" / anti-goal → "only when the owner chooses it", link to the wizard design), `docs/risks/risks.md` (R58), `docs/board/board.md` (t-145)
- Test: `packages/web/test/cloud-devices.test.ts`

**Interfaces:**
- Consumes: `joinLink` (Task 1); existing `inviteDevice`, `multiUseWriterWarning`, `generateCode`.
- Produces: `inviteShare(o: { base: string; nodeUrl: string; chainId: string; code: string; singleLink: boolean }): { link: string; code?: string }` in `cloud/devices.ts` (single link → link with code, no separate code; else link without code + code); `singleLinkWarning(role: DeviceRole): string` (the constraint's copy); `<QrCode value={string} />` (SVG from `uqr`'s `encode`, `role="img"`, `aria-label="QR code of the join link"`, 4-module quiet zone).

- [ ] **Step 1: Failing tests:** `inviteShare single link carries the code and returns no separate code`; `inviteShare default returns a code-free link and the code`; `singleLinkWarning names the role`; contrast: `qr-fg on qr-bg ≥ 7:1 in every theme` and both tokens identical across themes.
- [ ] **Step 2:** FAIL. **Step 3:** `bun add --cwd packages/web uqr@0.1.3`; build the wizard (step 1 fields + checkbox + warning + **Next**; step 2 QR, link, Copy link, separate code + Copy code + "send this separately" when unticked, "shown only once", **Invite another**, **Done**); tokens; QR component.
- [ ] **Step 4:** PASS + full `bun test` + `bun run web:build`. Write a browser checklist (both modes, all three themes, phone width, scan the QR with a phone, back button after opening a coded link) in the report.
- [ ] **Step 5:** Docs: devices design amendments; R58 "A single join link leaks" (likelihood/impact, mitigations: off by default, warning, fragment-only, 1 use/reader defaults, uses + expiry, stripped from the address bar); t-145 card (Backlog → Done with DoD) via `node_modules/.bin/agile` as other cards; regenerate cards.
- [ ] **Step 6:** Commit `feat(web): invite-a-device wizard with optional single join link and QR (t-145)`.
