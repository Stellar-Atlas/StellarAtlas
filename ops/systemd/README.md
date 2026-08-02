# StellarAtlas systemd units

## Runtime services

These templates split the production app into independently managed services.
The VM-facing services run as `observe`; storage-heavy services run as
`admins` on the bare-metal host. `ops/systemd` is the tracked source of truth;
systemd consumes root-owned regular-file copies installed under
`/etc/systemd/system`.

- `stellaratlas.target` starts the production service set.
- `stellaratlas-api.service` serves the API on `127.0.0.1:3000`.
- `stellaratlas-frontend-v4.service` serves the production Next.js frontend from
  `.next-production` on `127.0.0.1:3104`.
- `stellaratlas-frontend-v4-staging.service` serves the staging Next.js frontend
  from `.next-staging` on `127.0.0.1:3114`.
- `stellaratlas-frontend-legacy.service` starts the existing legacy frontend
  build without rebuilding it.
- `stellaratlas-meilisearch-network.service` serves the rebuildable network
  inventory search projection on `127.0.0.1:7701`.
- `stellaratlas-network-scanner.service` runs the network scanner.
- `stellaratlas-scp-live-scanner.service` continuously indexes live SCP
  observations into the live search read model.
- `stellaratlas-history-scanner@.service` runs the bounded history object
  scanner with 24 total object worker processes and one scanner loop per worker.
- `stellaratlas-full-history-operation-backfill.service` continuously catches up
  operation, operation-result, and account-reference facts for canonical
  batches.
- `stellaratlas-users.service` runs the user/mail service.

## Host-native storage runtime

The VM keeps the public API, frontends, network scanner, SCP collector, and
users service. PostgreSQL, archive verification, full-history ingestion,
Horizon, Stellar RPC, and network Meilisearch run on the bare-metal host so
their database and object I/O reaches the XFS array directly instead of through
VirtioFS.

The host exposes those services to the VM on `192.168.1.153`. That address is
owned by the host's `bridge0`; the VM tap is attached to the same bridge, so
VM-to-host service traffic remains inside the machine. The host's physical
management address is not used for runtime traffic.

`setup-host-systemd.sh` installs and verifies the host units without copying,
deleting, or rebuilding data. It does not store private environment files in
Git. `/etc/stellaratlas/meilisearch-network.env` remains an operator-owned
secret file.

```bash
sudo /mnt/bulk/stellarbeat-data/Observer/setup-host-systemd.sh --install
sudo /mnt/bulk/stellarbeat-data/Observer/setup-host-systemd.sh --verify
```

The VM marker `/etc/stellaratlas/host-native-runtime` activates condition
guards on every migrated VM unit. `setup-systemd.sh` installs those guards and
refuses to leave a duplicate VM writer active. The VM PostgreSQL service also
remains masked while the host owns the shared database directory.

## Isolated network search

Network inventory search and live SCP search use independent connection
settings. Each workload-specific value falls back to the legacy setting when
its override is empty or absent:

| Workload | Host | API key | Index |
| --- | --- | --- | --- |
| Network inventory | `MEILISEARCH_NETWORK_HOST` | `MEILISEARCH_NETWORK_API_KEY` | `MEILISEARCH_NETWORK_INDEX` |
| Live SCP | `MEILISEARCH_SCP_HOST` | `MEILISEARCH_SCP_API_KEY` | `MEILISEARCH_SCP_STATEMENT_INDEX` |
| Legacy fallback | `MEILISEARCH_HOST` | `MEILISEARCH_API_KEY` | n/a |

The dedicated network service uses `192.168.1.153:7701` and the host-native
rebuildable data path `/mnt/bulk/stellarbeat-data/meilisearch/network`. It is
separate from the SCP instance on port `7700`. The cutover reuses the same
underlying index directory in place; it does not copy or delete either index.
Search continues from Postgres while the projection is absent, stale,
rebuilding, or unavailable.

`setup-systemd.sh` creates `/etc/stellaratlas/meilisearch-network.env` when it
is absent, using a generated 256-bit key for both the Meilisearch master key and
the network projection client. It never prints the key. Later installer runs
preserve the file contents verbatim while enforcing `root:observe` ownership and
mode `0640`. The same installer creates `data`, `dumps`, and `snapshots` under
the array path as `observe:observe` mode `0700`. The `--verify` command remains
read-only; provisioning happens only during an explicit privileged install.

The generated private env file has this shape:

```text
MEILI_MASTER_KEY=<network-instance-master-key>
MEILISEARCH_NETWORK_HOST=http://192.168.1.153:7701
MEILISEARCH_NETWORK_API_KEY=<network-instance-master-key>
```

The host unit caps indexing at four threads and 4 GiB, the process at eight CPU
cores and 8 GiB, and the search queue at 256 requests. This instance does not
carry SCP traffic.

Safe activation order after the generated env metadata has been verified:

```bash
sudo /mnt/bulk/stellarbeat-data/Observer/setup-host-systemd.sh --install
systemctl start stellaratlas-meilisearch-network.service
node scripts/wait-for-url.mjs http://192.168.1.153:7701/health 90
systemctl restart stellaratlas-api.service
node scripts/wait-for-url.mjs http://127.0.0.1:3000/v1/status 90
```

Verify network autocomplete/search and live SCP independently before treating
the isolation as deployed. Rollback is configuration-only: stop the dedicated
unit, remove its workload-specific variables from the API environment, and
restart only the API. Leave both Meilisearch data directories intact; Postgres
fallback restores network search while SCP remains on its legacy connection.

## Boot contract

Never symlink system units into `/home/observe/stellarbeat-data`. That path is a
virtiofs mount and is not available when the system manager first loads enabled
units during boot. A broken early-boot symlink leaves `stellaratlas.target`
unloaded even after the mount appears.

`setup-systemd.sh` atomically installs regular-file unit copies in
`/etc/systemd/system`. The copied definitions remain loadable before virtiofs is
mounted, while `WorkingDirectory` and `ExecStart` continue to run the checked-in
application from `/home/observe/stellarbeat-data`. `stellaratlas.target` also
uses `RequiresMountsFor=/home/observe/stellarbeat-data/Observer`, so its service
transaction waits for the repo mount.

Repo unit edits do not change the installed copies. Rerun `setup-systemd.sh`
after every `ops/systemd` unit change, then restart only the services whose
runtime behavior must change. The installer reloads systemd and starts the
target only when it is inactive; it does not restart an active production
target.

## Full-history operation catch-up

`stellaratlas-full-history-operation-backfill.service` is the autonomous
consumer for canonical batches created by the promotion runtime. Starting the
dedicated unit is sufficient authorization; it does not use the one-shot
`FULL_HISTORY_OPERATION_BACKFILL_OPERATOR_CONFIRM` guard.

Each cycle selects at most 12 batches by default and uses 12 total decoder
worker threads. `FULL_HISTORY_OPERATION_BACKFILL_BATCHES` can be set from 1 to
24, while `FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS` is hard-capped at 12.
The batch window does not create a worker pool per batch: active batches and
decoder workers share the same total worker cap. The unit also applies process
caps of 12 CPU cores, 32 GiB, and 32 tasks.

Every cycle acquires the existing operation-backfill Postgres advisory lock,
runs one bounded invocation, and releases the lock before backing off. Lock
contention, idle work, and failures use separate bounded delays. JSON journal
events are capped at 4 KiB and include selected/completed batch counts, durable
batch IDs, operation/account-reference counts, active-worker peaks, failures,
and worker memory high-water marks. A one-minute heartbeat remains active while
a long decoder cycle runs.

On `SIGTERM`, the runtime interrupts its current backoff immediately. If a cycle
is active, it stops scheduling new cycles, lets that bounded invocation finish,
releases the advisory lock, and closes its Postgres pool. The unit's 65-minute
stop timeout allows the default single wave of 12 worker tasks to reach the
worker and database timeout boundaries cleanly.

Inspect the runtime without changing production state:

```bash
systemctl status stellaratlas-full-history-operation-backfill.service --no-pager
journalctl -u stellaratlas-full-history-operation-backfill.service -n 100 --no-pager
```

## Owned full-history APIs

Horizon and Stellar RPC run on the host against their existing persisted state:

- Horizon API: `http://192.168.1.153:18000`
- Stellar RPC: `http://192.168.1.153:8002`
- Horizon PostgreSQL: host-local Unix socket on port `5433`

Horizon uses port `18000` because another host workload owns `8000`. Horizon
PostgreSQL uses a peer-authentication map from host user `admins` to database
role `observe`; no database password is embedded in a unit or committed file.
RPC keeps its SQLite and captive-core state under
`/mnt/bulk/stellarbeat-data/stellar-rpc/pubnet`.

The services are enabled for autonomous restart, but public StellarAtlas
configuration must continue using external fallbacks until each owned service
is caught up to the current ledger and passes its native health check. Their
being active is not sufficient evidence of readiness.

`10-stellaratlas-observe.rules` lets the `observe` user start, stop, restart,
reload, try-restart, and reset only the listed StellarAtlas units without an
interactive password. It also permits `systemctl daemon-reload` for `observe` so
installed unit changes can be loaded after the privileged copy step.

Install or migrate deliberately:

```bash
./setup-systemd.sh --verify
sudo ./setup-systemd.sh
./setup-systemd.sh --verify-installed
```

The script validates every tracked unit, replaces existing repo symlinks with
root-owned mode `0644` copies, installs the polkit rule, and masks the old
root-run all-in-one `stellaratlas.service` with `/dev/null`. It then reloads
systemd, enables the split target, and starts it if needed.

Production split units use `PartOf=stellaratlas.target`, so target restarts
propagate to the API, frontend, public ingress, network scanner, SCP collector,
users service, `history-scanner@1`, and full-history promotion/backfill runtimes
without reviving the old monolithic unit. That behavior is for boot recovery
and deliberate full-stack maintenance only. Do not restart the target during a
normal component deploy: stopping the legacy frontend also removes the public
`8080` Cloudflare origin.

After changing a unit template, install the new copies, then restart only the
units whose definitions or runtime code changed:

```bash
sudo ./setup-systemd.sh
systemctl restart stellaratlas-api.service
systemctl restart stellaratlas-frontend-v4.service
```

Use `systemctl restart stellaratlas.target` only when an explicit full-stack
maintenance window allows the public origin to stop.

Production frontend deploy uses only `.next-slot-a` and `.next-slot-b`. The
staging build command refuses if staging is still running, repoints
`.next-staging` to the slot not used by production, invalidates its old
`BUILD_ID`, and builds there. Promotion stops if production is still running or
the staging slot has no complete `BUILD_ID`, then atomically repoints
`.next-production`.

```bash
systemctl stop stellaratlas-frontend-v4-staging.service
pnpm build:frontend-v4:staging
systemctl start stellaratlas-frontend-v4-staging.service
systemctl status stellaratlas-frontend-v4-staging.service --no-pager
# Verify staging on 127.0.0.1:3114 before promotion.
systemctl stop stellaratlas-frontend-v4.service
pnpm --filter frontend-v4 run release:promote-staging
systemctl start stellaratlas-frontend-v4.service
systemctl status stellaratlas-frontend-v4.service --no-pager
```

To refresh staging without promoting it:

```bash
systemctl stop stellaratlas-frontend-v4-staging.service
pnpm build:frontend-v4:staging
systemctl start stellaratlas-frontend-v4-staging.service
systemctl status stellaratlas-frontend-v4-staging.service --no-pager
```

Backend/API deploy:

```bash
pnpm build:api
systemctl restart stellaratlas-api.service
node scripts/wait-for-url.mjs http://127.0.0.1:3000/v1/status 90
```

Restart a scanner after the API readiness check only when that scanner's built
backend code changed:

```bash
systemctl restart stellaratlas-network-scanner.service
systemctl restart stellaratlas-scp-live-scanner.service
systemctl restart stellaratlas-history-scanner@1.service
```

Live SCP collector deploy:

```bash
pnpm build:scp-live-scanner
systemctl restart stellaratlas-api.service
node scripts/wait-for-url.mjs http://127.0.0.1:3000/v1/status 90
systemctl restart stellaratlas-scp-live-scanner.service
systemctl status stellaratlas-scp-live-scanner.service --no-pager
```

Legacy frontend rebuild is intentionally separate:

```bash
pnpm build:legacy-frontend
systemctl restart stellaratlas-frontend-legacy.service
```

Verify the tracked templates without touching `/etc` or production:

```bash
./setup-systemd.sh --verify
```

Verify the deployed copies and boot dependency after installation:

```bash
./setup-systemd.sh --verify-installed
systemctl show stellaratlas.target \
  -p FragmentPath -p RequiresMountsFor -p UnitFileState -p ActiveState
```

# Cross-Check Refresh Timers

These templates schedule one-shot RADAR/StellarAtlas cross-check refreshes
outside API request paths.

The timers do not restart `stellaratlas.service`, do not run network scans, and
do not install themselves. Operators must review paths and install them
explicitly.

## Files

- `stellaratlas-api-docs-comparison-refresh.service` runs one refresh.
- `stellaratlas-api-docs-comparison-refresh.timer` starts the service every six
  hours with jitter and persistent catch-up after downtime.
- `stellaratlas-radar-network-comparison-refresh.service` runs one bounded RADAR
  `/api/v1` network comparison refresh.
- `stellaratlas-radar-network-comparison-refresh.timer` starts the service every
  six hours with jitter and persistent catch-up after downtime.

## Install Timers

Review these values in the service before installing:

- `User=observe`
- `WorkingDirectory=/home/observe/stellarbeat-data/Observer`
- `Environment=HOME=/home/observe`
- `Environment=PATH=...`
- `EnvironmentFile=-/etc/stellaratlas/stellaratlas.env`

Then install regular-file copies deliberately. Do not symlink these units into
the virtiofs-backed repo.

```bash
sudo install -o root -g root -m 0644 -T "$PWD/ops/systemd/stellaratlas-api-docs-comparison-refresh.service" /etc/systemd/system/stellaratlas-api-docs-comparison-refresh.service
sudo install -o root -g root -m 0644 -T "$PWD/ops/systemd/stellaratlas-api-docs-comparison-refresh.timer" /etc/systemd/system/stellaratlas-api-docs-comparison-refresh.timer
sudo install -o root -g root -m 0644 -T "$PWD/ops/systemd/stellaratlas-radar-network-comparison-refresh.service" /etc/systemd/system/stellaratlas-radar-network-comparison-refresh.service
sudo install -o root -g root -m 0644 -T "$PWD/ops/systemd/stellaratlas-radar-network-comparison-refresh.timer" /etc/systemd/system/stellaratlas-radar-network-comparison-refresh.timer
sudo systemctl daemon-reload
sudo systemctl enable --now stellaratlas-api-docs-comparison-refresh.timer
sudo systemctl enable --now stellaratlas-radar-network-comparison-refresh.timer
```

## Operate

```bash
systemctl list-timers stellaratlas-api-docs-comparison-refresh.timer
sudo systemctl start stellaratlas-api-docs-comparison-refresh.service
journalctl -u stellaratlas-api-docs-comparison-refresh.service -n 100 --no-pager
systemctl list-timers stellaratlas-radar-network-comparison-refresh.timer
sudo systemctl start stellaratlas-radar-network-comparison-refresh.service
journalctl -u stellaratlas-radar-network-comparison-refresh.service -n 100 --no-pager
```

Each refresh command exits after one attempt. If another refresh is already
holding its advisory lock, the command logs `skipped_locked`; if the latest
snapshot is still fresh, it logs `skipped_fresh`.

The RADAR network comparison refresh performs one bounded fetch of
`https://radar.withobsrvr.com/api/v1` only when the service is run. It is not
part of the API request path.

## Verify Templates

```bash
systemd-analyze verify ops/systemd/stellaratlas-api-docs-comparison-refresh.service ops/systemd/stellaratlas-api-docs-comparison-refresh.timer ops/systemd/stellaratlas-radar-network-comparison-refresh.service ops/systemd/stellaratlas-radar-network-comparison-refresh.timer
```
