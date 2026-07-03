# Backend Agent Guide

Read `../../AGENTS.md` first. `apps/backend` is the main StellarAtlas service:
Express API, dependency injection, TypeORM persistence, network scanning,
history-scan coordination, notification delivery, and DTOs consumed by the old
Vue frontend and the Next.js frontend.

## Code Map

- `src/core` provides config, DI, HTTP shell, logging, database, and utilities.
- `src/network-scan` builds validator, organization, network, measurement, TOML,
  quorum, search, and SCP observation state.
- `src/history-scan-coordinator` schedules archive scanner workers and stores
  scan results.
- `src/notifications` owns subscriptions and delivery templates.

## Working Rules

- Keep domain logic inside use cases/domain services. Routers should validate,
  call a use case, and map results.
- Keep source files under 500 lines. Split mappers, DTOs, repositories, and
  policies before a file becomes hard to audit.
- Use strict TypeScript 6 style and ESNext assumptions. Prefer `unknown` plus
  type guards over `any`.
- Make background work cluster-safe. Job claiming, scanner heartbeats, and
  notification delivery must be idempotent across multiple Node processes.
- Use Node `cluster` for API/process scaling when enabled operationally. Use
  `worker_threads` or bounded worker pools for CPU-heavy hashing/parsing, never
  the request event loop.
- Treat Postgres as source of truth. Meilisearch, graph stores, and caches are
  rebuildable read models unless a task explicitly changes that contract.
- Archive verification errors and worker/setup failures are different evidence
  classes. Keep them separate in storage, APIs, and UI mappers.

## Verification

- Backend typecheck: `pnpm --filter backend exec tsc --project tsconfig.json --noEmit`
- Backend build: `pnpm --filter backend run build`
- Target tests when present: `pnpm test:unit:backend -- <pattern>`
