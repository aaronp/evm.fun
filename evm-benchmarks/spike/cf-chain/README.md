# Spike: a chain on a Cloudflare Durable Object (throwaway)

Reference code, not product code: no tests beyond the demo scripts, no hardening. Roadmap work (t-136) builds
proper packages from what this proved; nothing should import from here.

- `demo.ts`: a chain in a Durable Object (webevm + revm wasm), signed submits, device replicas replaying to the
  same state root. Report: [docs/spikes/cf-chain.md](../../docs/spikes/cf-chain.md)
- `access.ts`: read/write lists in `ChainAccess.sol` on the chain itself, bearer-token and open reads, join codes.
  Report: [docs/spikes/cf-access.md](../../docs/spikes/cf-access.md)
- `views.ts`: `GET /chains/:id/:alias/latest` JSON views (`Aliases.sol`, `src/recipes.ts`), invites.
  Report: [docs/spikes/cf-views.md](../../docs/spikes/cf-views.md)

Run (local `wrangler dev` only, no Cloudflare account needed; each script starts and stops it):

```
cd spike/cf-chain && bun install && bun demo.ts && bun access.ts && bun views.ts
```

Each prints PASS lines and ends with `ALL PASS`. Bun can segfault at exit (risk R11): rerun if no summary appears.
