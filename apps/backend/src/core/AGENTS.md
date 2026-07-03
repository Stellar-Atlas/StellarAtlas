# Core Backend Agent Guide

Read `../../../../AGENTS.md` and `../../AGENTS.md` first. `src/core` is the
backend foundation: configuration, DI containers, HTTP boot, database sources,
logging, user-service bridge, shared domain bases, and low-level utilities.

## Purpose

Core code should make every feature boring to run in production. It must support
clustered Node processes, bounded worker threads, shared config, reliable
logging, and consistent error handling without leaking feature-specific policy
into global helpers.

## Working Rules

- Keep helpers small and typed. Use explicit return types for exported utilities
  and services.
- Avoid global mutable state unless it is intentionally process-local and safe
  under Node `cluster`.
- Config should fail early with readable messages. Do not hide missing critical
  settings behind defaults.
- DI tokens and containers are shared contracts. Rename or restructure them only
  with all call sites updated.
- HTTP middleware belongs here only when it is generic. Feature authorization,
  DTO mapping, and scheduling policy belong in feature folders.
- Database setup must remain testable. Preserve `TestingAppDataSource` behavior.
- Keep source files under 500 lines; split config sections, middleware, or
  utilities when they grow.

## Verification

- Core/backend typecheck: `pnpm --filter backend exec tsc --project tsconfig.json --noEmit`
- Focus tests: `pnpm test:unit:backend -- core`
