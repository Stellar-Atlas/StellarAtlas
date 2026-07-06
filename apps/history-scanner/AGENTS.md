# History Scanner Agent Guide

Read `../../AGENTS.md` first. `apps/history-scanner` is the worker application
that verifies Stellar history archives and reports results to the backend
history-scan coordinator.

## Purpose

This is a primary StellarAtlas feature. It must verify full validator archives,
especially full archivers, and produce trustworthy evidence for every actual
archive error it finds. It should explain failures when possible and avoid
mislabeling worker/setup failures as validator archive faults.

## Code Map

- `domain/history-archive` validates history archive state files, categories, checkpoints, and URL
  construction.
- `domain/scanner` owns range/category scanning, XDR streaming, hashing, bucket
  cache, worker pool load tracking, and HTTP error mapping.
- `domain/scan` models scan jobs, settings, results, and errors.
- `use-cases/verify-archives` and `verify-single-archive` run worker workflows.
- `infrastructure/services/RESTScanCoordinatorService.ts` talks to backend.

## Working Rules

- Separate archive verification errors from worker issues. Wrong hash, missing
  object, malformed XDR, and bad bucket evidence belong to archive results;
  coordinator outages, local worker crashes, and latest-ledger lookup failures
  are worker/infrastructure issues unless proven otherwise.
- Periodically rescan archives that have errors. Rescan from persisted chain and
  error state, not from UI state.
- Keep total concurrency bounded. A target of 24 network fetch workers and 24
  bucket/hash processing workers is acceptable when implemented as total caps,
  not nested multipliers per archive/category.
- Use Node `worker_threads` or existing bounded worker pools for hashing and XDR
  processing. Do not block the event loop with CPU-heavy parsing.
- Deduplicate bucket data by hash. Ramdisks are allowed only for rebuildable
  cache data with persistent source of truth elsewhere.
- Keep source files under 500 lines. Split scanners by category, policy,
  transport, and error mapping as needed.
- Use strict TypeScript 6 style, explicit error types, and no `any` in scan
  result payloads.

## Verification

- Build: `pnpm --filter history-scanner run build`
- Unit tests: `pnpm test:unit:history-scanner`
- Single archive smoke only when explicitly intended:
  `pnpm --filter history-scanner run scan-history`
