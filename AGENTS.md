# StellarAtlas Agent Router

StellarAtlas is a Stellar network intelligence platform. It monitors validators,
organizations, quorum health, archive integrity, SCP observations, and the future
full-history graph/search system described in
`docs/stellar-atlas-q2-2026-update-and-q3-roadmap.md`.

This repository runs inside a VM on the StellarAtlas high-capacity server. Assume
large CPU and RAM are available, but never waste them with unbounded sockets,
unbounded workers, or runaway memory retention.

## Global Engineering Rules

- Keep source files under 500 lines of code. Split by domain/use-case/component
  when a file gets large.
- Prefer short, efficient, boring code over long, clever, decorative code.
- Use strict, safe TypeScript. Prefer modern TypeScript 6 and ESNext output.
- Preserve typechecking. Do not weaken `strict`, add `any`, or bypass validators
  without a written reason.
- Use Node `cluster` for process-level service scaling where appropriate and
  `worker_threads` for CPU-heavy jobs such as hashing/parsing. Keep worker pools
  bounded and observable.
- Treat Postgres/archive data as source of truth. Search indexes, graph stores,
  RAM caches, and ramdisks are rebuildable read models unless explicitly
  designed otherwise.
- Do not persist duplicate copies of the same archive bucket. Deduplicate by
  bucket/hash identity.
- Do not start extra production servers or restart `stellaratlas.service` unless
  explicitly asked.
- Do not run broad live scans unless explicitly asked. When running scanners,
  keep total network request concurrency bounded.
- Archive verification errors are validator/archive evidence. Worker/setup
  failures are infrastructure evidence. Do not label one as the other.
- Use BrowserOS for visual verification when UI behavior matters.

## Folder Guides

Read the nearest folder guide before editing:

- `apps/frontend-v4/AGENTS.md` - production Next.js frontend.
- `apps/backend/AGENTS.md` - backend app shell, API, workers, DI, persistence.
- `apps/backend/src/core/AGENTS.md` - shared backend core, config, HTTP, CLI.
- `apps/backend/src/history-scan-coordinator/AGENTS.md` - archive job API and scheduler.
- `apps/backend/src/network-scan/AGENTS.md` - network crawler snapshots, TOML, SCP data.
- `apps/backend/src/notifications/AGENTS.md` - subscriptions and notification delivery.
- `apps/users/AGENTS.md` - legacy user/mail service.
- `apps/history-scanner/AGENTS.md` - archive verifier worker app.

## Cross-Feature Specialists

Use these named agents for feature-focused work that crosses packages:

- `docs/agents/vera-the-archive-sentinel.md` - archive verification and rescans.
- `docs/agents/orla-the-orchestrator.md` - subagent coordination and roadmap control.
- `docs/agents/max-the-memory-mechanic.md` - parallelism, worker pools, memory, heap safety.
- `docs/agents/nova-the-scp-cartographer.md` - SCP telemetry and visualization.
- `docs/agents/bill-the-graph-theory-genius.md` - quorum, FBAS, graph theory, Neo4j modeling.
- `docs/agents/maya-the-search-smith.md` - Meilisearch, faceted search, fast read models.
- `docs/agents/heidi-the-horizon-keeper.md` - full-history ETL, Horizon, Soroban RPC.
- `docs/agents/alvin-the-network-god.md` - validator metadata, TOML, crawler, overlay.
- `docs/agents/steve-the-typescript-junkie.md` - TypeScript 6, ESNext, strict refactors.
- `docs/agents/bella-the-reverse-engineering-guru.md` - RADAR parity and external cross-checks.
- `docs/agents/jim-the-docs-guy.md` - docs, API descriptions, roadmap alignment.
- `docs/agents/silence-the-1337.md` - ops, BrowserOS, deploy, no-downtime runtime.
- `docs/agents/quinn-the-quality-bouncer.md` - QA, build logs, commits, release hygiene.

## BrowserOS Quick Commands

For StellarAtlas UI verification, use the `$stellaratlas-browseros` skill if it
is available in the Codex session.

```bash
browseros-display restart
browseros-display status
browseros-cli init http://127.0.0.1:<port>/mcp
codex mcp remove browseros || true
codex mcp add browseros --url http://127.0.0.1:<port>/mcp
```

Use the port from `browseros-display status`. Do not assume `9200`.

## Current Strategic Direction

- For roadmap-scale work, use the `$stellaratlas-orchestrator` skill and
  `docs/goal.md` to coordinate subagents, ownership, verification, and endpoint
  backlog.
- Make archive scanner evidence trustworthy and operator-friendly.
- Scan all validators, prioritizing full archivers and whole-archive coverage.
- Keep archive worker concurrency bounded: 24 network fetch threads and 24
  bucket/hash processing threads are acceptable targets when implemented as total
  caps, not nested multipliers.
- Build current node/org/archive feature parity against the older RADAR/Stellarbeat
  surfaces at `https://radar.withobsrvr.com/` and
  `https://radar.withobsrvr.com/api/docs/`.
- Productize SCP telemetry into truthful graph animation and inspectable quorum data.
- Build Meilisearch-backed faceted search where it improves lookup speed and UX.
- Build deduplicated full-history ETL, public Horizon, and Soroban RPC on Protocol 27.
- Prepare StellarAtlas-controlled validator/full-archive infrastructure with proper
  quorum configuration.
- Align work with `docs/stellar-atlas-q2-2026-update-and-q3-roadmap.md`.

## Handoff Template

```text
Lane:
Objective:
Files touched:
Commands run:
What passed:
What failed or was not run:
Runtime/process state:
Next safest step:
```
