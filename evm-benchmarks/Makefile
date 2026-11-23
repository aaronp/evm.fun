.PHONY: dev build test bench report soak-node dev-services dev-services-status dev-services-stop e2e-node

dev:     ## playground dev server (http://localhost:5173)
	bun run web:dev

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

DEV_SERVICES = bun packages/node/scripts/dev-services.ts

dev-services: ## local chain worker in the background (http://127.0.0.1:8799), root chain bootstrapped
	$(DEV_SERVICES) start

dev-services-status:
	$(DEV_SERVICES) status

dev-services-stop:
	$(DEV_SERVICES) stop

e2e-node: ## end-to-end against the local worker; starts it if needed, stops it only if it started it
	@if curl -sf http://127.0.0.1:8799/health >/dev/null; then started=; else $(DEV_SERVICES) start || exit 1; started=1; fi; \
	bun packages/node/scripts/e2e.ts; rc=$$?; \
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
