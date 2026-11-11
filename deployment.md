# Deploying StellarAtlas

This guide describes a Linux deployment from the tracked source. It is
**source-reviewed, not clean-machine tested**. There is no portable all-in-one
installer. In particular, the current PostgreSQL migration runner assumes an
existing schema baseline; read that gate before provisioning a public service.
Commands below are operator instructions, not commands executed by this guide.

## 1. Choose the deployment scope

The smallest useful deployment is PostgreSQL, the Node API, the Next.js v4
frontend, and a TLS reverse proxy. Network views additionally need completed
network scans or a compatible restored dataset. Empty databases do not supply
network or historical data merely because processes start.

Add ClickHouse and parsed-history ingestion for warehouse-backed explorer and
GraphQL results. Archive verification, SCP collection, Meilisearch projections,
owned Horizon/RPC, status/failover, analytics, authentication and email are
separate services, not prerequisites for serving the core shell. Disabled or
unpopulated capabilities must remain unavailable, not appear complete.

Use [package.json](package.json) for command/version authority and
[README.md](README.md) for architecture. [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md)
also covers development, including the legacy Vue frontend; its legacy frontend
commands are not the Next.js production deployment path.

## 2. Prepare the host and persistent storage

Install Git, Bash/POSIX utilities, a C/C++ build toolchain for native dependencies,
Node **26.x**, pnpm **10.12.1**, PostgreSQL server/client tools and a TLS proxy.
Optional Go components declare **Go 1.26.5** in their module manifests. Provision
ClickHouse, NATS and other optional services only for the selected workloads;
the repository does not pin a universally tested fresh-server package set.

Run application/build processes as an unprivileged service account. Use a
separate data filesystem from the OS, with backups on another failure domain.
Example paths below are generic, not required paths:

```text
/srv/atlas-data/applications/releases/<revision>   source and compiled application
/srv/atlas-data/postgresql     PostgreSQL cluster
/srv/atlas-data/clickhouse     warehouse
/srv/atlas-data/history        immutable history batches and manifests
/srv/atlas-data/search         rebuildable search projections
/srv/atlas-data/cache/pnpm          reusable dependency store
/etc/atlas                    private configuration, outside Git
```

Mount and verify the intended filesystems **before creating database directories
or starting writers**. Record expected device/UUID, ownership and free space:

```bash
findmnt --target /srv/atlas-data
df -h /srv/atlas-data
mountpoint -q /srv/atlas-data || exit 1
```

Adapt each service unit with `RequiresMountsFor=/srv/atlas-data`,
`After=network-online.target`, an appropriate database dependency, and an
`ExecStartPre=/usr/bin/mountpoint -q /srv/atlas-data` guard. If an additional
filesystem holds PostgreSQL WAL, history or caches, guard that mount too. Do not
allow a missing mount to silently create replacement data on the OS disk.
Initialize PostgreSQL only in a new empty directory, as its database OS user,
using the installed PostgreSQL version's `initdb -D` and service configuration.
Never run `initdb` on an existing/restored cluster. Configure ClickHouse's data
path similarly before its first start. Preserve databases and history on upgrades.

The tracked [systemd templates](ops/systemd/) and
[systemd notes](ops/systemd/README.md) illustrate service separation, but contain
operator-specific users, paths and topology. Adapt copies; do not execute
`setup-systemd.sh`, `setup-host-systemd.sh`, or storage cutover scripts as generic
bootstrap tools. Install root-owned regular-file units, not links into a mount.

## 3. Obtain source, configure secrets and build

Keep source checkouts, compiled releases and dependency/build caches on the
verified application/data filesystem as well. Create the directories below for
the unprivileged service account only after checking the mount. Build outputs
and the Next.js build directories remain inside that release checkout.

Clone a reviewed release and record its full revision:

```bash
mountpoint -q /srv/atlas-data || exit 1
mkdir -p /srv/atlas-data/applications/releases /srv/atlas-data/cache/pnpm
release_dir=/srv/atlas-data/applications/releases/reviewed-release
git clone https://github.com/Stellar-Atlas/StellarAtlas.git "$release_dir"
cd "$release_dir"
git checkout --detach <reviewed-tag-or-commit>
git rev-parse HEAD
node --version
pnpm --version
pnpm install --frozen-lockfile --store-dir /srv/atlas-data/cache/pnpm
cp apps/backend/.env.dist apps/backend/.env
cp apps/frontend-v4/.env.example apps/frontend-v4/.env.local
chmod 600 apps/backend/.env apps/frontend-v4/.env.local
```

Install the pinned pnpm version using your Node distribution's supported package
manager bootstrap if absent. Reuse the same pnpm store across candidate checkouts
on this host; do not copy `node_modules` between incompatible OS/CPU environments.
Keep the lockfile unchanged. Reuse Go module/build caches too; avoid parallel full
builds of the same revision. Neither cache is a substitute for durable data.

Edit [backend configuration](apps/backend/.env.dist): set `NODE_ENV=production`,
`ACTIVE_DATABASE_URL`, `DATABASE_SSL` for the chosen database connection,
`PORT=3000`, `API_BIND_HOST=127.0.0.1`, and start with `API_WORKERS=1`.
Size `DATABASE_POOL_SIZE` across **all** processes, not per-machine in isolation.
Keep `DATABASE_MIGRATIONS_RUN=false` for normal API startup. Replace placeholder
archive cursor keys with privately generated 32-byte base64url secrets in the
documented key-id format; run the cursor-key check below. Set a private revalidation
token shared with the frontend. Never retain `change-me`, template passwords or
example API credentials. Leave notifications, telemetry and integrations disabled
until configured. Review network passphrase, seeds and protocol settings rather
than assuming the template's peer addresses are current.

For Next, set `STELLAR_ATLAS_PUBLIC_API_URL` to its reachable API origin and the
same `STELLAR_ATLAS_REVALIDATE_TOKEN`; distinguish browser-visible origins from
loopback server addresses. Some origin rules are still source-bound: review
[next.config.ts](apps/frontend-v4/next.config.ts), frontend URL helpers and
[WarehouseLiveWebSocket.ts](apps/backend/src/status/infrastructure/http/WarehouseLiveWebSocket.ts)
when using a different domain. Environment changes alone do not retarget every
canonical link, Horizon/RPC rewrite or browser WebSocket allowlist.

Use a private service `EnvironmentFile` or secret manager for runtime values;
do not blindly `source` application dotenv files as shell scripts. Keep secrets
out of command histories, build logs, public environment variables and Git.

```bash
pnpm build:ts
pnpm --filter shared run post-build
pnpm --filter backend run post-build
pnpm check:archive-evidence-cursor-keys
```

These commands compile project references, rewrite aliases, generate shared
validators and copy notification templates. They do not initialize databases.

## 4. Initialize PostgreSQL explicitly

Start the configured PostgreSQL cluster after its mount checks. As a database
administrator, create a non-superuser application role and database; set its
password interactively rather than embedding one in source:

```bash
sudo -u postgres createuser --pwprompt atlas
sudo -u postgres createdb --owner=atlas atlas
```

Restrict database access to local sockets/private authorized clients. Configure
authentication/TLS before remote use; do not expose PostgreSQL publicly. Review
[AppDataSource.ts](apps/backend/src/core/infrastructure/database/AppDataSource.ts)
before choosing remote TLS: its current SSL option does not enforce certificate
verification, so it is not by itself a secure remote-database policy.

**Baseline gate:** production has `synchronize: false` and an explicitly selected
[ManagedMigrations.ts](apps/backend/src/core/infrastructure/database/ManagedMigrations.ts)
list that omits pre-baseline legacy migrations. The old
[initial migration](apps/backend/src/core/infrastructure/database/migrations/1559296078133-init.ts)
alone is not the current schema. `migrations:backend:apply` is therefore **not a
supported empty-database initializer**. Do not enable automatic synchronization,
fake migration rows or replay every historical migration as a workaround.

For a new host, obtain an administrator-reviewed compatible baseline dump with
its migration ledger (and required reference data), verify its provenance and
restore it into the newly created database. For a custom-format backup:

```bash
pg_restore --list /path/to/reviewed-baseline.dump
# Inspect objects/owners/extensions before restoring; connection uses local auth.
pg_restore --exit-on-error --no-owner --role=atlas \
  --dbname=atlas /path/to/reviewed-baseline.dump
pnpm migrations:backend
# Exit 2 means pending migrations, not successful application.
pnpm migrations:backend:apply
pnpm migrations:backend
```

Run the restore as an authorized database administrator; provision any required
extensions first. Both migration commands use the built backend configuration.
The apply command uses per-migration transactions. Back up before applying and
inspect changes for lock/runtime cost. **A blank-schema installation without a
compatible baseline remains a repository bootstrap limitation**: stop here until
a reviewed baseline/bootstrap path exists; a running API cannot repair it.

## 5. Optional warehouse and history initialization

Run ClickHouse on its dedicated mounted storage with private credentials and a
DDL-capable initialization identity. Review [ClickHouse templates](ops/clickhouse/)
for paths/users/storage policies; they are not portable configurations to install
unchanged. Give the API a separate least-privilege read identity afterward.

The [Hubble command](apps/hubble-etl/cmd/stellaratlas-hubble-etl/main.go) has an
explicit `schema` mode, unlike merely starting an importer. Build it:

```bash
mkdir -p apps/hubble-etl/bin
(cd apps/hubble-etl && go build -trimpath \
  -o bin/stellaratlas-hubble-etl ./cmd/stellaratlas-hubble-etl)
```

Provide `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USER` and
`CLICKHOUSE_PASSWORD` securely in the command's environment, then run:

```bash
apps/hubble-etl/bin/stellaratlas-hubble-etl schema
```

This creates the database, ingestion manifest and dataset tables through the
[schema generator](apps/hubble-etl/internal/schema/clickhouse.go) and client
initialization. It does not import history or certify coverage. Inspect optional
holder-index/storage-layout settings before enabling them: they can require
named storage policies. Backend warehouse reads instead use the
`HUBBLE_CLICKHOUSE_URL`, `HUBBLE_CLICKHOUSE_DATABASE`, `HUBBLE_CLICKHOUSE_USER`,
and `HUBBLE_CLICKHOUSE_PASSWORD` variables. Match the database names explicitly.

For ingestion, also configure PostgreSQL `ACTIVE_DATABASE_URL`, mounted
`FULL_HISTORY_DATA_ROOT`, approved source access and bounded workers. Build the
LCM tools with an explicit local Go binary because the script default is an
operator-specific path:

```bash
GO_BIN="$(command -v go)" pnpm build:full-history-etl
```

Read [full-history ETL](apps/full-history-etl/README.md) and
[Hubble importer](apps/hubble-etl/README.md) before selecting ranges or formats.
Bring up authenticated NATS before publication consumers, initialize PostgreSQL
history tables through the reviewed baseline/migrations, then enable the chosen
LCM producer, canonical promotion and Hubble importer in that order. The importer
entry point is `stellaratlas-hubble-etl run`; it consumes retained immutable
batches, not arbitrary files. Do not launch every backfill CLI at once. Bootstrap
of authenticated history/checkpoints and owned Horizon/RPC is a separately
configured subsystem, not accomplished by `schema` or a promotion service.

## 6. First API/frontend start (not an upgrade)

Start the API in its own terminal/service only after database/schema acceptance:

```bash
pnpm start:api
```

The root command starts the cluster entry point. Keep one background owner; an
off-traffic standby uses `API_BACKGROUND_TASKS_ENABLED=false` and the single
`apps/backend/lib/core/infrastructure/http/api.js` entry point from the backend
working directory, not `start:api`. Standbys must not run migrations/background
writers. Inspect logs and the readiness endpoints before proceeding.

On an **empty checkout with no Next aliases or processes**, build the first fixed
slot directly. The ordinary staging/promotion helper requires an existing valid
production slot/BUILD_ID for rollback; it cannot bootstrap that first build.

```bash
cd apps/frontend-v4
mkdir .next-slot-a
ln -s .next-slot-a .next-production
pnpm docs:generate
node ../../scripts/refuse-root.mjs frontend-v4 first-build
node ../../scripts/refuse-live-next-build.mjs .next-slot-a
NEXT_DEPLOYMENT_ID="$(git rev-parse HEAD)" NEXT_DIST_DIR=.next-slot-a pnpm exec next build
test -s .next-slot-a/BUILD_ID
pnpm start
```

Do not run the first-install `mkdir`/`ln` sequence over existing aliases. The
guard inspects Linux `/proc`; build and serve as the same unprivileged owner.
Use this build's complete output on replicas, not independently generated builds.
The frontend normally binds loopback port 3104; staging uses 3114. Supervise each
component independently, with graceful SIGTERM, bounded restart backoff, resource
limits and logs. Do not use `start:all` to provision an unreviewed service set.

## 7. Public ingress and optional services

Terminate TLS with your chosen proxy; forward the frontend origin to loopback
3104 and the API origin to loopback 3000. Preserve `Host` and forwarded protocol
under a deliberately configured trusted-proxy boundary. Route GraphQL/REST to
the API without swallowing frontend `/api` routes. Forward WebSocket upgrades
with HTTP/1.1 `Upgrade`/`Connection` handling; disable buffering/cache for SSE,
use adequate streaming timeouts, and do not cache authenticated/private responses.
Keep databases, NATS and management ports private. Test HTTP-to-HTTPS redirect,
certificate renewal and both ordinary and streaming routes through the proxy.

`/v1/stream/data` is a restricted first-party publication-hint WebSocket, not a
universal subscription/replay API. `/v1/live` is a distinct live network surface.
Changing a proxy does not remove application Origin checks. Verify your actual
allowed origin before advertising streams on a custom domain.

Add workers one at a time after their dependencies: network scanner
(`pnpm start:scan-network 0 0` for one real scan), SCP collector with its configured
read model, then archive workers after their authenticated coordinator/broker.
Use [history-scanner configuration](apps/history-scanner/.env.dist) and
[service templates](ops/systemd/); network fetching is real external activity.
Start small, observe aggregate connections/pools and keep total concurrency capped.

Optional [analytics](ops/analytics/README.md) needs isolated databases, private
dashboard access and qualified producer/privacy settings. Optional status lives
under [ops/cloudflare/status](ops/cloudflare/status/); its package references
untracked/missing build/publish files in this revision, so those npm scripts are
not a fresh-clone deployment recipe. Failover requires independently retained
snapshots and truthful freshness/readiness, not only a second frontend. Review
authentication/provider configuration and users-service schema separately;
never enable OAuth, notifications or outbound mail just to make a health badge green.

## 8. Smoke checks, upgrades and rollback

From the host, then through TLS ingress, inspect bounded responses:

```bash
curl --fail-with-body http://127.0.0.1:3000/v1/status
curl --fail-with-body http://127.0.0.1:3000/v1/status/api
curl --fail-with-body http://127.0.0.1:3000/v1/status/data-freshness
curl --fail-with-body http://127.0.0.1:3104/docs
```

Check response contents/timestamps, not HTTP 200 alone. An empty installation
may correctly report unavailable data. Confirm one known bounded record only
inside completed imported coverage, inspect GraphQL `errors`, verify one linked
page/return journey, and test stream connection/reconnect when enabled. No full
dataset scan is needed. Record revision, BUILD_ID, configuration identity,
schema version, checks and limitations; processes being active is not acceptance.

For upgrades, keep **current plus candidate** source/builds and a tested database
backup. Build off-traffic using the shared dependency caches; never overwrite a
running API's compiled files or a served Next directory. Review migration backward
compatibility first. Qualify the candidate API on a separate loopback port without
background ownership, then candidate frontend against the intended API. Switch
proxy/service selection only after health/content checks; restart only changed
workers after API acceptance. Do not restart the entire target for a normal deploy.

For an established two-slot frontend, the tracked
[release helper](scripts/frontend-v4-release.mjs) prepares the inactive slot,
requires a complete BUILD_ID, and captures a rollback slot/build identity. Its
promotion refuses a running production-alias process: the older stop/start
procedure is **not** a zero-downtime HA deployment. Keep a separately supervised
healthy listener/proxy target serving during any required stop, or use a maintenance
window. Never bypass the guards. Save the helper's exact rollback command and
do not rebuild/reuse the rollback slot before acceptance.

On failure, return traffic to the retained healthy API/frontend artifacts and
configuration, then verify readiness/content again. Roll back database changes
only through an explicitly reviewed restore/migration plan; binary rollback does
not undo schema or immutable history writes. Keep durable data and backups intact.
