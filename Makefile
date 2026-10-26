.PHONY: frontend-install frontend-dev frontend-check api-run

frontend-install:
	pnpm install --frozen-lockfile

frontend-dev:
	pnpm run dev

frontend-check:
	pnpm run typecheck && pnpm test

api-run:
	go run ./apps/api
