.PHONY: dev build test bench report

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

# >>> @pritzlaff/project — managed by `project add/remove/update`; edits inside are overwritten
.PHONY: snapshot dashboard gantt agile
snapshot: ; npx project snapshot
dashboard: ; npx project build
gantt: ; npx gantt docs/schedule/schedule.md
agile: ; npx agile docs/board/board.md
# <<< @pritzlaff/project
