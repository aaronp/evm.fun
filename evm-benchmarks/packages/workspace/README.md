# @evmb/workspace

What an app does, without UI: local chains (webevm, kept in browser storage), deploy to the worker with a code or vouched by an issuer, retrying a failed create without a new code, following deployed chains, and issuing, listing and revoking onboarding codes on root. Depends on `@evmb/node`, `@evmb/contracts` and `@evmb/keys`; `@evmb/app` is its first user. ADR-0026.

Test: `bun test packages/workspace`. End to end against the local worker: `make e2e-node` (runs `scripts/e2e-onboarding.ts`; starts the worker if needed).
