# Archive Scanner Deployment Readiness

Date: 2026-07-06

This is the public-safe deployment checklist for the archive scanner queue,
metadata, progress, and node/status UI fixes. It documents the exact gate before
production can stop showing duplicate active ranges, missing
scanner-owned history archive state snapshots, and active jobs that look stuck at
`latestScannedLedger=0`.

Do not treat this file as approval to delete rows, truncate tables, restart
production, run broad scans, or run services as root. Archive scan rows,
archive metadata, bucket evidence, parsed ledgers, and raw archive cache data
are evidence. The only approved duplicate reconciliation in this plan marks
older duplicate active queue rows inactive/done; it does not delete archive
evidence.

## Current Production Gap

Read-only checks on 2026-07-06 found this mismatch:

- Source has `ActiveScanJobIdentityMigration1784310000000`, but production has
  not applied it.
- Source has `ScanJobAttemptedProgressMigration1784330000000`, but production
  has not applied it.
- `history_archive_scan_job_queue` in production was missing:
  `latestAttemptedLedger`, `currentRangeFromLedger`, and
  `currentRangeToLedger`.
- Production still had duplicate active queue rows for the same normalized
  archive URL and range.
- Active workers could only expose verified contiguous progress, so jobs with
  early archive errors looked like they were not attempting later ranges.

Until the schema, backend, history scanner, and frontend are deployed together,
the public pages can still show old labels and stale progress even if the source
tree is fixed.

## Source Of Truth

- Queue identity migration:
  `apps/backend/src/history-scan-coordinator/infrastructure/database/migrations/1784310000000-ActiveScanJobIdentityMigration.ts`
- Attempted progress migration:
  `apps/backend/src/history-scan-coordinator/infrastructure/database/migrations/1784330000000-ScanJobAttemptedProgressMigration.ts`
- Network archive scheduling counter migration:
  `apps/backend/src/network-scan/infrastructure/database/migrations/1784320000000-NetworkScanArchiveSchedulingMigration.ts`
- Backend data source:
  `apps/backend/src/core/infrastructure/database/AppDataSource.ts`
- History scanner unit:
  `ops/systemd/stellaratlas-history-scanner@.service`
- API unit:
  `ops/systemd/stellaratlas-api.service`
- Frontend v4 unit:
  `ops/systemd/stellaratlas-frontend-v4.service`

## Required Preflight

Run these as `observe` from the repo root. Do not print database URLs, secrets,
or full env files into public docs or tickets.

```bash
git status --short
git log --oneline -8
systemctl status stellaratlas-api.service --no-pager --lines=40
systemctl status stellaratlas-history-scanner@1.service --no-pager --lines=60
systemctl status stellaratlas-frontend-v4.service --no-pager --lines=40
```

Verify unit templates before any reload:

```bash
systemd-analyze verify \
  ops/systemd/stellaratlas-api.service \
  ops/systemd/stellaratlas-frontend-v4.service \
  ops/systemd/stellaratlas-history-scanner@.service
```

If `systemctl restart` prompts for sudo, stop and fix the `observe` polkit
allow-list through the reviewed `setup-systemd.sh` path. Do not revive the old
root-run all-in-one `stellaratlas.service`.

## Read-Only Database Audit

Load env without printing it:

```bash
set -a
source apps/backend/.env
set +a
```

Confirm migration history:

```bash
psql "$ACTIVE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "
select timestamp, name
from migrations
where name like '%ActiveScanJobIdentity%'
   or name like '%ScanJobAttemptedProgress%'
   or name like '%NetworkScanArchiveScheduling%'
   or name like '%HistoryArchiveScanMetadata%'
   or name like '%HistoryArchiveScanEvidence%'
order by timestamp;
"
```

Confirm the queue progress columns exist:

```bash
psql "$ACTIVE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "
select column_name
from information_schema.columns
where table_name = 'history_archive_scan_job_queue'
  and column_name in (
    'latestAttemptedLedger',
    'currentRangeFromLedger',
    'currentRangeToLedger'
  )
order by column_name;
"
```

Confirm active duplicate queue rows before reconciliation:

```bash
psql "$ACTIVE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "
select
  lower(regexp_replace(url, '/+$', '')) as archive_identity,
  coalesce(\"fromLedger\", -1) as from_ledger,
  coalesce(\"toLedger\", -1) as to_ledger,
  status,
  count(*) as rows,
  min(\"createdAt\") as first_created,
  max(\"updatedAt\") as last_updated
from history_archive_scan_job_queue
where status in ('PENDING', 'TAKEN')
group by 1, 2, 3, 4
having count(*) > 1
order by rows desc, last_updated desc
limit 25;
"
```

Confirm active worker state:

```bash
curl -fsS http://127.0.0.1:3000/v1/archive-scans/workers | jq .
curl -fsS http://127.0.0.1:3000/v1/archive-scans/queue | jq .
```

Expected pre-deploy state may include duplicates and missing attempted progress.
That is the reason for the migration gate; it is not a reason to delete data.

## Build Gate

Run focused verification before touching production services:

```bash
NODE_OPTIONS=--experimental-vm-modules pnpm exec jest \
  --selectProjects backend \
  --runTestsByPath \
  apps/backend/src/history-scan-coordinator/domain/__tests__/ScanScheduler.test.ts \
  apps/backend/src/history-scan-coordinator/domain/__tests__/ScanSchedulerRecheckPolicy.test.ts \
  apps/backend/src/history-scan-coordinator/use-cases/schedule-scan-jobs/__tests__/ScheduleScanJobs.test.ts \
  --runInBand

NODE_OPTIONS=--experimental-vm-modules pnpm exec jest \
  --selectProjects history-scanner \
  --runTestsByPath \
  apps/history-scanner/src/domain/scan/__tests__/ScanSettingsFactory.test.ts \
  apps/history-scanner/src/domain/scanner/__tests__/Scanner.test.ts \
  apps/history-scanner/src/use-cases/verify-archives/__tests__/VerifyArchives.test.ts \
  --runInBand

pnpm --filter backend exec tsc --project tsconfig.json --noEmit
pnpm --filter history-scanner run build
pnpm --filter backend run build
pnpm --filter frontend-v4 run typecheck
pnpm build:frontend-v4
```

The frontend production build must write to `.next-production`, not the live
`.next` directory.

## Migration Gate

The backend `AppDataSource` runs migrations automatically by default. Do not
restart the API until the migration list is reviewed.

Show pending migrations without running them:

```bash
cd apps/backend
DATABASE_MIGRATIONS_RUN=false pnpm exec typeorm migration:show \
  -d lib/core/infrastructure/database/AppDataSource.js
cd ../..
```

The operator-reviewed migration set for this archive scanner repair must
include:

- `HistoryArchiveScanEvidenceMigration1784100000000`
- `HistoryArchiveScanMetadataMigration1784200000000`
- `OrganizationStellarTomlMigration1784300000000`
- `ActiveScanJobIdentityMigration1784310000000`
- `NetworkScanArchiveSchedulingMigration1784320000000`
- `ScanJobAttemptedProgressMigration1784330000000`

If the migration table and live schema disagree, stop and document the exact
already-applied objects before running anything. Do not edit the migrations
table by hand without a separate operator-approved repair note.

After approval, run migrations explicitly:

```bash
cd apps/backend
DATABASE_MIGRATIONS_RUN=false pnpm exec typeorm migration:run \
  -d lib/core/infrastructure/database/AppDataSource.js
cd ../..
```

The active queue migration performs a no-delete reconciliation before adding
the partial unique index. Older duplicate active rows are marked `DONE` and
their claim fields are cleared.

## Targeted Restart Gate

Restart only these services after builds and migrations pass. Stop archive
workers before restarting the API so planned API downtime does not create
coordinator-refused worker noise:

```bash
systemctl daemon-reload
systemctl stop stellaratlas-history-scanner@1.service
systemctl restart stellaratlas-api.service
node scripts/wait-for-url.mjs http://127.0.0.1:3000/v1/status 90
systemctl start stellaratlas-history-scanner@1.service
systemctl restart stellaratlas-frontend-v4.service
```

Do not restart `stellaratlas.target`, do not start optional Horizon/RPC units,
and do not run broad manual scanner commands as part of this archive deploy.

## Post-Deploy Verification

API checks:

```bash
curl -fsS http://127.0.0.1:3000/v1/archive-scans/workers | jq .
curl -fsS http://127.0.0.1:3000/v1/archive-scans/queue | jq .
curl -fsS http://127.0.0.1:3000/v1/status/data-freshness | jq .
```

Database checks:

```bash
psql "$ACTIVE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "
select
  lower(regexp_replace(url, '/+$', '')) as archive_identity,
  coalesce(\"fromLedger\", -1) as from_ledger,
  coalesce(\"toLedger\", -1) as to_ledger,
  status,
  count(*) as rows
from history_archive_scan_job_queue
where status in ('PENDING', 'TAKEN')
group by 1, 2, 3, 4
having count(*) > 1
order by rows desc
limit 25;
"
```

This query must return zero rows for active duplicates.

BrowserOS checks:

- `/status` shows every current archive job returned by the API, with drill-down
  links and `Per-job requests` labels.
- `/status` does not show hidden current archive jobs without a route to view
  them.
- Representative node pages have no duplicate active range rows for the same
  archive/range.
- Representative organization pages show persisted scanner-owned metadata and
  do not perform browser-time remote TOML/archive fetches.
- Node archive rows show assigned range, verified contiguous progress,
  attempted-through ledger, and current range separately.
- Node and status pages do not expose internal filesystem paths.
- Root history archive state still shows as missing until the scanner-owned
  metadata backfill or a new scan stores it. The page must never fetch the
  remote archive during render.

## Metadata Backfill Gate

After API deploy and migration success, backfill scanner-owned root history
archive state metadata through the authenticated backend route. Use a small
selected URL set first, then verify the node page. Do not create fake successful
scan rows for metadata-only backfill.

Acceptance:

- Existing archive URLs can show scanner-captured root history archive state
  metadata.
- Missing root history archive state metadata remains explicit when no
  scanner-owned body exists.
- Archive verification errors remain archive evidence.
- Worker/setup failures remain infrastructure evidence.

## Rollback

Rollback should restore service binaries/config to the previous commit and
restart only the affected service. Do not drop the new columns or unique index
as a first response. The new columns are additive, and the active queue unique
index protects production from repeated duplicate active work.

If a migration fails, leave services stopped only as long as needed to prevent
further queue churn, capture the exact failing migration and SQL error, then
decide whether to repair the object state or revert the code path. Do not delete
archive scan evidence to make a migration pass.
