# StellarAtlas Backend

Backend for the StellarAtlas platform that monitors and analyzes the Stellar
network validators and organizations. It uses a database (pgsql recomended) for
storage. And it exposes a REST API for all the necessary functions.

Built with Nodejs/TypeScript and follows Clean Architecture principles.

Follows 12 factor app and can be easily run on heroku hosting.

## Modules

The backend follows clean architecture and is divided into modules that are
loosely coupled. Every module has a domain folder for domain code. An
infrastructure folder for the database, cli scripts, ... and use-cases that
describe and execute the available functionality.

### Network Scanner

- Crawls and monitors the Stellar network using the crawler package
- Collects node and organization data through TOML files and direct connections
- Tracks network health, node versions, and quorum set configurations
- Provides network metrics via REST APIs

### Notifications

- Manages user subscriptions for network events
- Sends email notifications through the users microservice
- Alerts on network outages, validator failures, and quorum set changes

### History Archive Scan coordinator

- Schedules ScanJobs to scan history archives
- Workers can fetch ScanJobs to execute.
- Allows parallel executing of History Archive Scans

### Core

The core module contains app wide functionality like kernel initiation,
configuration, database, etc.

## install

Should be executed from the root of the monorepo

```
> pnpm install # install dependencies
> pnpm build # build the code into the lib folder
# Database migrations are run automatically when the code is first run.
```

Copy env.dist to .env and configure the environment variables.

## Usage

Every module has a README.md file with more detailed information.

### Run dev environment

Note: these commands are also exposed in the monorepo root.

1. Provide the necessary environment variables. (todo: automate)
2. Start a network scan to get some data into the system

```
pnpm start:scan-network
```

3. start api and frontend dev environment

```
pnpm dev
```

Dev environment hosted on http://localhost:5173/

### Run the api

```

pnpm start-api

```

### Run the history-scan

```

pnpm verify-archives

```

### Run the network-scan

```

pnpm scan-network

```

### Restrict ledger-close-meta capture to current work

Ordinary current-priority scheduling still offers historical work. To opt in to
current-only capture, keep admission and current priority enabled, use one
typed shard per cycle, one processing slot and no bounded replay, and set
`FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_ONLY_MIN_LEDGER` and
`FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_ONLY_MINIMUM_FREE_BYTES` together with
`FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_ONLY_PAIRED_ADMISSION`. Leave all three
unset for ordinary scheduling; do not combine them with an expiring allowance.

The paired policy is a JSON object with `bootId`, the exact
`warehouseReportedPath`, a service-private read-only `warehouseMetadataPath`,
its `warehouseMetadataInode` as a decimal string, and the measured
`minimumUnreservedBytes` as a decimal string. Set it only for a supervised
activation. The source uses the explicitly configured local
`HUBBLE_CLICKHOUSE_URL` and `HUBBLE_CLICKHOUSE_DATABASE` with the existing
warehouse credential. A boot change restores ordinary source policy.

The separate absolute floor must be positive and below the ordinary absolute
floor. The larger configured proportional floor (with a minimum of five
percent), full cycle output reservation, and store-size limit still apply.
No eligible current range means idle, not historical fallback. Capacity is
checked before saving the plan and again before conversion. The existing plan
is retained until the warehouse confirms the same batch, range, source digest
and all twenty dataset declarations. An uncommitted eligible plan can resume;
incompatible plans are refused and preserved. Verify advancing source and warehouse
publication after activation. This is a source admission check, not a disk
quota or a bound on concurrent warehouse writes.

A separate, default-off scoped current attempt can be prepared with
`FULL_HISTORY_LEDGER_CLOSE_META_SCOPED_CURRENT_ATTEMPT` (version 1, a unique
permit ID, exact bulk device and exact current ledger range). It requires the
paired configuration, one shard of up to 128 ledgers and an operator-owned,
expiring arm bound to the running entrypoint, invocation and owned history hold. It retains the
full source, warehouse, drain and startup allowances. Do not set it as a
persistent boot configuration. The attempt is consumed durably before capture;
restart or disarm can settle exact published work but cannot retry conversion.
Preserve an ambiguous plan and its spent receipt for operator-reviewed recovery
with the same geometry. Before arming, separately verify the entire release,
protected warehouse and publisher generations, the publisher's effective hold
and that already-admitted history has drained. A hold file alone does not prove
that drain or cap independent writes. Keep the hold through a clean drain and
verified ordinary source restoration; the source does not create or remove it.

### Run tests

The test folder contains both unit and integration tests. A test database is
required for the integration tests that you can configure with the
DATABASE_TEST_URL env variable.

```

pnpm test pnpm test:unit pnpm test:integration

```

### Create migration

```

pnpm build
cd apps/backend
pnpm typeorm migration:generate src/core/infrastructure/database/migrations/{{MIGRATION_DESCRIPTION}} -d lib/core/infrastructure/database/AppDataSource.js

```

### Revert latest migration

```
pnpm typeorm migration:revert -d lib/core/infrastructure/database/AppDataSource.js
```

## API Documentation

OpenAPI spec available at openapi.json Swagger UI available at /api-docs when
running in development

## history

Code from https://github.com/Stellar-Atlas/js-stellaratlas-backend was moved to
this monorepo. For history consult this archive.
