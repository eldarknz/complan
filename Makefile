.PHONY: frontend-install frontend-dev frontend-check api-run api-seed db-up db-down api-test api-proto

frontend-install:
	pnpm install --frozen-lockfile

frontend-dev:
	pnpm run dev

frontend-check:
	pnpm run typecheck && pnpm test

api-run:
	go -C apps/api run .

api-seed:
	go -C apps/api run ./cmd/seed

api-test:
	go -C apps/api test ./...

api-proto:
	protoc --go_out=apps/api --go_opt=paths=source_relative api/proto/catalog/v1/catalog.proto

db-up:
	docker compose up -d postgres

db-down:
	docker compose down
