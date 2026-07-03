# Network Scan Agent Guide

Read `../../../../AGENTS.md` and `../../AGENTS.md` first. `network-scan` is the
Stellar network observer: crawler orchestration, validators, organizations,
quorum sets, measurements, TOML metadata, search documents, and SCP statement
observations.

## Purpose

This feature turns live Stellar network observations into stable snapshots and
measurements that the API, frontend, graph, and archive scanner use. It is the
source of current validator/org identity and network health.

## Code Map

- `domain/network`, `domain/node`, and `domain/organization` are snapshot and
  measurement models.
- `domain/scp` stores observed SCP statement telemetry.
- `use-cases/scan-network` and `scan-network-looped` run network scans.
- `infrastructure/http` exposes network, node, and organization APIs.
- `infrastructure/search` builds Meilisearch documents.
- `services/*DTOService.ts` maps domain snapshots to frontend/API DTOs.

## Working Rules

- Preserve snapshot semantics: changing node/org facts create new snapshots;
  measurements capture repeated state over time.
- Bound peer, TOML, Horizon, and geolocation network concurrency. The server is
  large, but remote services and local sockets are not infinite.
- Keep quorum data lossless enough for FBAS analysis and graph visualization.
- SCP observation ingestion must stay factual: ledger, slot, phase, validator,
  statement, and timing fields should not be invented.
- Search and graph indexes are read models. Keep Postgres/domain entities as the
  source of truth unless a task explicitly changes architecture.
- Keep files under 500 lines; split mappers and DTO builders aggressively.
- Use worker threads only for CPU-heavy graph/math aggregation. Network IO
  should use bounded async queues.

## Verification

- Typecheck: `pnpm --filter backend exec tsc --project tsconfig.json --noEmit`
- Scan only with explicit intent: `pnpm --filter backend run scan-network`
- Focus tests: `pnpm test:unit:backend -- network-scan`
