# @evmb/app

The user-friendly chain app (React 19 + Vite), built from the prototype over `@evmb/workspace` and `@evmb/keys`: app shell, Chains (create locally, deploy with a code or as an issuer, follow), and the Onboarding page (issue, list, revoke codes). evm.fun (`@evmb/web`) is unchanged. Local only for now: mychain.dev fronts evm.fun.

Run: `make dev-services` (the worker, http://127.0.0.1:8799), then `make app` and open **http://localhost:5174** (not 127.0.0.1: the worker's CORS allows `localhost` only). `VITE_WORKER_URL` points the app at another worker. To issue codes, import the root admin key (`ROOT_ADMIN_KEY` from `.env.local`) from the profile menu.

Test: `bun test packages/app/test/<file>` one file at a time (Bun can segfault on several, R11). Build: `bun run --cwd packages/app build`.

Known limits (risk R63):
- Two passphrase prompts at once hang the first; the startup "Read root" prompt can overlap a deploy or follow prompt and stall root reads.
- A returning user is asked for the passphrase on every load, because `isIssuer` reads root.
- "Deployed and syncing" is shown even when follow is down.
- `?code=` is lost if no key or workspace exists yet (passphrase cancelled on first run).
- Two tabs opened on first run can each set a different passphrase.

Keys lock after 15 minutes idle, or on Lock in the profile menu (the in-memory signer is dropped).
