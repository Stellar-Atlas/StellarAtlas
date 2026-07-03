# History Scan Coordinator Agent Guide

Read `../../../../AGENTS.md` and `../../AGENTS.md` first. This feature schedules
and records Stellar history archive verification performed by
`apps/history-scanner` workers.

## Purpose

The coordinator is the control plane for archive integrity. It manages archive
URLs, scan chains, scanner heartbeats, job leases, rechecks, and persisted scan
evidence shown on validator pages. It must help operators know whether a
validator archive is wrong, incomplete, stale, unreachable, or merely failed due
to local worker infrastructure.

## Code Map

- `domain/ScanJob.ts`, `domain/scan/Scan.ts`, and `domain/scan/ScanError.ts`
  model jobs, completed scans, and evidence.
- `domain/ScanScheduler.ts` decides what archive should be scanned next.
- `use-cases/get-scan-job`, `register-scan`, `get-scan-logs`, and
  `schedule-scan-jobs` are the main API contracts.
- `infrastructure/http/HistoryScanRouter.ts` exposes worker and UI endpoints.

## Working Rules

- Archive verification errors are archive evidence. Worker issues are scanner
  infrastructure evidence. Do not mix their counts, labels, filters, or retries.
- Validators with archive errors must be periodically rescanned. Rescans should
  use persisted error state and scan-chain state, not stale UI assumptions.
- Job claiming must be cluster-safe and idempotent. Multiple backend processes
  must not hand out duplicate destructive work unless the job model allows it.
- Scan logs should show actual errors and explain likely causes when the data
  supports it: wrong hash, missing file, malformed XDR, HTTP failure, latest
  ledger lookup failure, timeout, or coordinator/worker issue.
- Keep files under 500 lines. Split scheduler policies, mappers, repositories,
  and display filters.
- Use strict TypeScript and explicit DTO boundaries. Avoid `any` in persisted
  error details.

## Verification

- Typecheck: `pnpm --filter backend exec tsc --project tsconfig.json --noEmit`
- Focus tests: `pnpm test:unit:backend -- history-scan`
