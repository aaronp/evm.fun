.PHONY: dev app build test bench report soak-node throughput-node dev-services dev-services-status dev-services-stop clear-local e2e-node deploy

dev:     ## playground dev server (http://localhost:5173)
	bun run web:dev

app: ## new app on http://localhost:5174 (or the next free port) against the local worker
	bun run --cwd packages/app dev

build:   ## static playground site -> packages/web/dist
	bun run web:build

test:
	bun test

bench:   ## e.g. make bench ARGS="--approach all --scenario all --n 10000 --runs 3"
	bun run bench $(ARGS)

report:
	bun run report

soak-node: ## 10,000-block chain-store soak (t-129)
	bun packages/node/soak.ts

throughput-node: ## submit throughput, batches of 1/10/100 (t-132); in-process, or ARGS='--url http://127.0.0.1:8799'
	bun packages/node/scripts/throughput.ts $(ARGS)

DEV_SERVICES = bun packages/node/scripts/dev-services.ts

dev-services: ## local chain worker in the background (http://127.0.0.1:8799), root chain bootstrapped
	$(DEV_SERVICES) start

dev-services-status:
	$(DEV_SERVICES) status

dev-services-stop:
	$(DEV_SERVICES) stop

clear-local: ## stop the local worker and delete its chains (root included); keeps .env.local's root key. Then make dev-services
	$(DEV_SERVICES) stop
	@if curl -sf http://127.0.0.1:8799/health >/dev/null; then echo 'The local worker is still running: stop it first (make dev-services-stop), then retry.'; exit 1; fi
	rm -rf .run/node-state
	@echo "Local chains deleted. 'make dev-services' creates a fresh root chain; in evm.fun, delete chains that followed the old ones."

e2e-node: ## end-to-end against the local worker; starts it if needed, stops it only if it started it
	@if curl -sf http://127.0.0.1:8799/health >/dev/null; then started=; else $(DEV_SERVICES) start || exit 1; started=1; fi; \
	bun packages/node/scripts/e2e.ts && bun packages/workspace/scripts/e2e-onboarding.ts; rc=$$?; \
	if [ -n "$$started" ]; then $(DEV_SERVICES) stop; fi; exit $$rc

# >>> @pritzlaff/project — managed by `project add/remove/update`; edits inside are overwritten
.PHONY: snapshot dashboard adr risks gantt agile
snapshot: ; npx project snapshot
dashboard: ; npx project build
adr: ; npx adr docs/adr/decisions.md
risks: ; npx risk-register docs/risks/risks.md
gantt: ; npx gantt docs/schedule/schedule.md
agile: ; npx agile docs/board/board.md
# <<< @pritzlaff/project

deploy: ## LIVE: worker on your Cloudflare account + root chain (needs wrangler login and .env.live); run by hand, never CI
	bun packages/node/scripts/deploy.ts
