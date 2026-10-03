# 主要コマンドの唯一の真実源（docs/03_dev-setup.md 8章）。
# docs・CLAUDE.md はターゲット名だけを参照し、実コマンドはここにだけ書く。
SHELL := /bin/bash

.PHONY: setup dev build test e2e lint typecheck format tokens gen routetree wrangler-types \
	db-generate db-migrate db-seed db-seed-empty db-reset db-studio doc-lint promote

# 「生成」: Git に入れない生成物を作り直す（03 8章）。
# 生成物を読むターゲット（dev・build・test・e2e・lint・typecheck）は必ず最初にこれを走らせる
gen: tokens routetree wrangler-types

tokens:
	bun scripts/tokens/build.ts
	bunx panda codegen

routetree:
	bunx tsr generate

wrangler-types:
	bunx wrangler types

setup:
	bun install
	test -f .dev.vars || cp .dev.vars.example .dev.vars
	$(MAKE) gen
	$(MAKE) db-migrate
	$(MAKE) db-seed
	bunx playwright install chromium
	git config core.hooksPath .githooks

dev: gen
	bunx vite dev

build: gen
	bunx vite build

test: gen
	bunx vitest run

# アクセシビリティ（axe）と Lighthouse CI は Step 10 で足す
# （docs/03_dev-setup.md 7章が定める e2e の完成形。docs/claude-code-prompts.md Step 10）
e2e: gen
	bunx vite build
	$(MAKE) db-migrate
	$(MAKE) db-seed
	bunx playwright test

lint: gen
	bunx biome check .
	@! grep -rn --include='*.ts' --include='*.tsx' --exclude='tokens.generated.ts' -E "(^|[^[:alnum:]_])primitive\." src \
		|| (echo 'lint: デザイントークンのプリミティブ層を src/ から参照している（ADR-014。セマンティック層だけを使う）' && exit 1)

typecheck: gen
	bunx tsc --noEmit

format:
	bunx biome format --write .

db-generate:
	bunx drizzle-kit generate

db-migrate:
	bunx wrangler d1 migrations apply eastx-db-local --local

db-seed:
	bun scripts/seed/seed.ts

db-seed-empty:
	bun scripts/seed/seed.ts --empty

db-reset:
	rm -rf .wrangler/state/v3/d1
	$(MAKE) db-migrate
	$(MAKE) db-seed

# 既定のポート（4983）を別のプロセスが使っているときは make db-studio STUDIO_PORT=4984 のように変える
STUDIO_PORT ?= 4983
db-studio:
	bunx drizzle-kit studio --port $(STUDIO_PORT)

doc-lint:
	scripts/doc-lint.sh --docs

# 昇格のスクリプトは Step 9 で作る（docs/claude-code-prompts.md）
promote:
	scripts/promote.sh $(ENV) $(SHA)
