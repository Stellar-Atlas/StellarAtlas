# StellarAtlas Architecture

This document is the canonical inventory of StellarAtlas runtime services,
build boundaries, data stores, and primary data flows. Component-specific
operational details remain in `docs/ops/`.

## Runtime Model

StellarAtlas is one product composed of independently restartable services. A
frontend build is not an API build, and neither rebuilds the archive verifier or
the full-history ETL binaries.

The production `stellaratlas.target` groups the core services for boot. Normal
deployments restart only the component whose build changed. The target is not a
deployment command because restarting it would interrupt unrelated services and
public ingress.

Postgres is the durable source of truth for network observations, archive
evidence, checkpoint proofs, canonical decoded history, and imported state.
Meilisearch and frontend caches are rebuildable read models. Large immutable
LedgerCloseMeta batches are stored on the bulk data mount and imported into
typed Postgres tables.

## Build Boundaries

| Build target | Owns | Does not build |
| --- | --- | --- |
| `apps/frontend-v4` | Production and staging Next.js frontend | API, scanners, ETL, legacy frontend |
| `apps/frontend` | Legacy Vite frontend | Frontend v4, API, scanners, ETL |
| `apps/backend` | API and backend CLIs for network/SCP scanning, archive coordination, canonical promotion, backfill, and state import | Frontends, standalone history scanner, Go ETL binaries |
| `apps/history-scanner` | Standalone archive object fetch and verification workers | API, frontends, Go ETL binaries |
| `apps/full-history-etl` | Go LedgerCloseMeta decoder and state exporter binaries | TypeScript services and frontends |
| `packages/shared` | Shared DTOs and domain contracts | Deployable processes |
| `packages/history-scanner-dto` | Coordinator/worker protocol DTOs | Deployable processes |

The backend build is intentionally broad because several systemd services run
different CLI entrypoints from the same emitted `apps/backend/lib` tree. Its
build compiles shared packages, compiles backend TypeScript, rewrites emitted
ESM path aliases, and copies notification templates. It does not rebuild the
frontends or the standalone history scanner.

## Service Inventory

### Public Surfaces

| Service | Systemd unit | Package/process | Responsibility | Local endpoint |
| --- | --- | --- | --- | --- |
| Frontend v4 | `stellaratlas-frontend-v4.service` | `apps/frontend-v4` | Primary web application | `127.0.0.1:3104` |
| Frontend v4 staging | `stellaratlas-frontend-v4-staging.service` | `apps/frontend-v4` using `.next-staging` | Temporary production-mode verification build; shares the production API and data services | `127.0.0.1:3114` |
| Legacy frontend | `stellaratlas-frontend-legacy.service` | `apps/frontend` | Legacy routes retained during migration | Internal frontend port |
| Public API | `stellaratlas-api.service` | Backend API cluster | Public REST, WebSocket status streams, worker coordination, and OpenAPI | `127.0.0.1:3000` |
| Users service | `stellaratlas-users.service` | `apps/users` | User and notification account functions | Internal |

Staging is only another frontend process. It does not start another API,
database, scanner, search index, ETL pipeline, Horizon, or Stellar RPC stack.

### Network And Archive Monitoring

| Service | Systemd unit | Package/process | Responsibility | Durable output |
| --- | --- | --- | --- | --- |
| Network scanner | `stellaratlas-network-scanner.service` | Backend network scan CLI | Crawl Stellar nodes, organization metadata, quorum information, and archive roots | Network snapshots and metadata in Postgres |
| Live SCP collector | `stellaratlas-scp-live-scanner.service` | Backend SCP CLI | Collect current SCP observations for feeds and graph playback | SCP observations and live indexes |
| Archive coordinator | Part of `stellaratlas-api.service` | Backend history-scan coordinator | Discover archive objects, schedule checks, lease work, persist evidence, and calculate proof rollups | Object queue, evidence, and proof rows in Postgres |
| Archive verifier | `stellaratlas-history-scanner@1.service` | `apps/history-scanner` cluster | Claim archive objects, fetch bytes, parse/hash XDR, and report evidence | Results sent to the coordinator API |

Archive verifier concurrency has two independent caps:

- remote object checks/downloads, bounded cluster-wide to protect archive hosts
  and database claim paths;
- CPU-heavy hash/XDR work, bounded separately with worker threads.

Bucket payloads are content-addressed by hash. A payload may be cached once,
while evidence remains specific to each archive source that was checked.

### Full-History And Explorer Data

| Service | Systemd unit | Package/process | Responsibility | Durable output |
| --- | --- | --- | --- | --- |
| Canonical promotion | `stellaratlas-full-history-promotion.service` | Backend promotion CLI | Promote checkpoint batches only after archive proof requirements pass | Canonical ledger, transaction, result, and provenance tables |
| Historical canonical backfill | `stellaratlas-full-history-backfill.service` | Backend backfill CLI | Extend proof-gated canonical history toward genesis | Canonical history tables |
| LedgerCloseMeta ingestion | `stellaratlas-full-history-ledger-close-meta.service` | Backend coordinator plus Go ETL | Fetch/replay LedgerCloseMeta and produce immutable typed datasets | Bulk typed batches and ingestion manifests |
| Operation backfill | `stellaratlas-full-history-operation-backfill.service` | Backend operation backfill CLI | Populate operation and account-reference projections | Typed Postgres tables |
| State import | `stellaratlas-full-history-state-import.service` | Backend importer plus Go state exporter | Import account and trustline changes from typed batches | Typed state/import tables |
| Horizon | `stellaratlas-horizon.service` | Horizon binary and captive Stellar Core | Horizon-compatible history API | Separate Horizon database and captive-core storage |
| Stellar RPC | `stellaratlas-stellar-rpc.service` | Stellar RPC binary | Soroban RPC API | RPC database/storage configured by `rpc.toml` |

Horizon and Stellar RPC units are conditional. Their presence in the repository
does not mean the services are deployed; required binaries, databases, and
configuration must exist before systemd can start them.

### Search And Read Models

| Service | Systemd unit | Responsibility | Source of truth |
| --- | --- | --- | --- |
| Network Meilisearch | `stellaratlas-meilisearch-network.service` | Fast node and organization autocomplete/faceted lookup | Rebuilt from Postgres network data |
| Frontend server actions and WebSockets | Part of frontend v4 and API | Aggregate server-side reads and stream changing status/SCP data to clients | API and Postgres |

Explorer transaction, operation, asset, account, contract, and ledger views are
read models over canonical proof-gated history and typed LedgerCloseMeta data.
Indexes must be declared ready only after their underlying typed data and
backfills are complete.

## Primary Data Flows

### Network Monitoring

```text
Stellar peers and organization metadata
  -> network scanner
  -> Postgres network snapshots
  -> API and Meilisearch projection
  -> frontend node, organization, graph, and search views
```

### Archive Verification

```text
network scanner archive-root observations
  -> archive coordinator object inventory and queue
  -> bounded archive verifier fetch workers
  -> bounded XDR/hash worker threads
  -> source-specific archive evidence
  -> checkpoint file-consistency proof
  -> canonical full-history promotion eligibility
```

Remote transport failures, scanner infrastructure failures, and confirmed
archive-integrity mismatches are separate evidence classes. Only the last class
proves that fetched archive content disagrees with its expected hash or related
checkpoint data.

### Full-History ETL

```text
public history sources / LedgerCloseMeta source
  -> Go full-history ETL
  -> immutable typed batches on bulk storage
  -> typed Postgres import and canonical linkage
  -> search/read-model indexes
  -> Explorer, Horizon-compatible, and RPC-facing products
```

Canonical archive promotion and LedgerCloseMeta ingestion are complementary:
archive proofs establish source integrity and provenance, while LedgerCloseMeta
contains the detailed transaction metadata, operations, events, and ledger-entry
changes needed by the Explorer and state indexes.

## Startup And Deployment Rules

1. Start Postgres and required local data mounts before application services.
2. Start Meilisearch before the API when network search is enabled.
3. Start the API before scanners and backend ingestion workers.
4. Start production frontends only after the API readiness endpoint responds.
5. Build and restart only the changed package/service boundary.
6. Use staging only for a bounded production-mode frontend verification, then
   stop it.
7. Never restart `stellaratlas.target` for a normal component deployment.
8. Never delete archive evidence, canonical history, typed batches, or imported
   state as part of a deploy or migration.

## Detailed References

- `docs/ops/history-archive-scanner-architecture.md`
- `docs/ops/archive-scanner-deployment-readiness.md`
- `docs/ops/horizon-rpc-deployment-readiness.md`
- `docs/network-scan-runbook.md`
- `docs/stellar-atlas-q2-2026-update-and-q3-roadmap.md`
