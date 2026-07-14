# StellarAtlas systemd units

## Runtime services

These templates split the production app into independently managed services
that all run as `observe`, not root. `ops/systemd` is the tracked source of
truth; systemd consumes root-owned regular-file copies installed under
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

## Isolated network search

Network inventory search and live SCP search use independent connection
settings. Each workload-specific value falls back to the legacy setting when
its override is empty or absent:

| Workload | Host | API key | Index |
| --- | --- | --- | --- |
| Network inventory | `MEILISEARCH_NETWORK_HOST` | `MEILISEARCH_NETWORK_API_KEY` | `MEILISEARCH_NETWORK_INDEX` |
| Live SCP | `MEILISEARCH_SCP_HOST` | `MEILISEARCH_SCP_API_KEY` | `MEILISEARCH_SCP_STATEMENT_INDEX` |
| Legacy fallback | `MEILISEARCH_HOST` | `MEILISEARCH_API_KEY` | n/a |

The dedicated network service uses port `7701` and the rebuildable data path
`/home/observe/stellarbeat-data/meilisearch/network`. It is intentionally
separate from the existing SCP instance on port `7700`; activation does not
copy, delete, or migrate that instance or either index. The network index starts
empty and is rebuilt from canonical Postgres inventory by the API projection
writer. Search continues from Postgres while the new projection is absent,
stale, rebuilding, or unavailable.

This VM has no separate FAST mount attached. The current storage target is the
51 TiB `/home/observe/stellarbeat-data` virtiofs array, so the dedicated network
index uses that array now rather than the VM root disk. A future distinct FAST
mount can override `MEILI_DB_PATH`, `MEILI_DUMP_DIR`, and `MEILI_SNAPSHOT_DIR`
through the private env file before service start; its absence does not block
the current deployment.

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
MEILISEARCH_NETWORK_HOST=http://127.0.0.1:7701
MEILISEARCH_NETWORK_API_KEY=<network-instance-master-key>
```

The unit caps indexing at two threads and 2 GiB, the process at four CPU cores
and 4 GiB, and the search queue at 256 requests. Change those caps only after
observing sustained network-index workload; this instance does not carry SCP
traffic.

Safe activation order after the generated env metadata has been verified:

```bash
sudo ./setup-systemd.sh
systemctl start stellaratlas-meilisearch-network.service
node scripts/wait-for-url.mjs http://127.0.0.1:7701/health 90
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

## Optional full-history services

These units are installed by `setup-systemd.sh` but are intentionally not part
of `stellaratlas.target` yet:

- `stellaratlas-horizon.service` runs the local Horizon binary from
  `/home/observe/stellarbeat-data/horizon/bin/horizon`.
- `stellaratlas-stellar-rpc.service` runs the local Stellar RPC binary from
  `/home/observe/stellarbeat-data/stellar-rpc/bin/stellar-rpc`.

They use `ConditionPath...` guards and will not start unless the required
binary/config files exist. Do not add them to `stellaratlas.target` until the
local Horizon and RPC endpoints are proven healthy on loopback.

Current prerequisites:

- install `stellar-core` at
  `/home/observe/stellarbeat-data/stellar-core/bin/stellar-core`;
- create a separate Horizon Postgres database and put `DATABASE_URL=...` in
  `/etc/stellaratlas/full-history.env`;
- keep Horizon storage under
  `/home/observe/stellarbeat-data/horizon/captive-core/pubnet`;
- install `stellar-rpc` at
  `/home/observe/stellarbeat-data/stellar-rpc/bin/stellar-rpc`;
- create `/home/observe/stellarbeat-data/stellar-rpc/pubnet/config/rpc.toml`.

Safe activation order:

```bash
systemctl daemon-reload
systemctl start stellaratlas-horizon.service
systemctl status stellaratlas-horizon.service --no-pager --lines=80
curl -fsS http://127.0.0.1:8000 | jq .
systemctl start stellaratlas-stellar-rpc.service
systemctl status stellaratlas-stellar-rpc.service --no-pager --lines=80
```

Only after local services catch up and pass API checks should
`/etc/stellaratlas/stellaratlas.env` move Atlas from public Horizon to loopback:

```bash
HORIZON_URL=http://127.0.0.1:8000
STELLAR_RPC_URL=http://127.0.0.1:8002
```

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
