# StellarAtlas systemd units

## Runtime services

These templates split the production app into independently managed services
that all run as `observe`, not root.

- `stellaratlas.target` starts the production service set.
- `stellaratlas-api.service` serves the API on `127.0.0.1:3000`.
- `stellaratlas-frontend-v4.service` serves the production Next.js frontend from
  `.next-production` on `127.0.0.1:3104`.
- `stellaratlas-frontend-v4-staging.service` serves the staging Next.js frontend
  from `.next-staging` on `127.0.0.1:3114`.
- `stellaratlas-frontend-legacy.service` starts the existing legacy frontend
  build without rebuilding it.
- `stellaratlas-network-scanner.service` runs the network scanner.
- `stellaratlas-scp-live-scanner.service` continuously indexes live SCP
  observations into the live search read model.
- `stellaratlas-history-scanner@.service` runs a bounded history-scanner process
  cluster. The production template sets `HISTORY_SCAN_PROCESSES=24`,
  `HISTORY_MAX_REQUESTS=24`, and `HISTORY_HASHER_WORKERS=24`; the cluster
  wrapper partitions those totals across child processes and forces each child
  to one scanner loop. The service command repeats those caps through
  `/usr/bin/env` so stale values in `/etc/stellaratlas/stellaratlas.env` cannot
  turn the production template back into a single-process scanner.
- `stellaratlas-users.service` runs the user/mail service.

## Optional full-history services

These units are linked by `setup-systemd.sh` but are intentionally not part of
`stellaratlas.target` yet:

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
repo unit-template changes can be reloaded after the one-time system link setup.

Link or migrate deliberately:

```bash
sudo ./setup-systemd.sh
```

The script links each active StellarAtlas unit in `/etc/systemd/system` back to
the matching file under `ops/systemd`. `/etc` is not the source of truth; it
only contains symlinks that systemd requires for system units. The script also
installs the polkit rule, disables and masks the old root-run all-in-one
`stellaratlas.service`, reloads systemd, and starts `stellaratlas.target`.

After this migration, editing `ops/systemd/*.service` is enough. Reload and
restart without sudo:

```bash
systemctl daemon-reload
systemctl restart stellaratlas-api.service
systemctl restart stellaratlas-scp-live-scanner.service
systemctl restart stellaratlas-history-scanner@1.service
```

Production frontend deploy:

```bash
pnpm build:frontend-v4
systemctl restart stellaratlas-frontend-v4.service
systemctl status stellaratlas-frontend-v4.service --no-pager
```

Staging frontend deploy:

```bash
pnpm build:frontend-v4:staging
systemctl restart stellaratlas-frontend-v4-staging.service
systemctl status stellaratlas-frontend-v4-staging.service --no-pager
```

Backend/API deploy:

```bash
pnpm build:api
systemctl daemon-reload
systemctl restart stellaratlas-api.service
```

Live SCP collector deploy:

```bash
pnpm build:scp-live-scanner
systemctl daemon-reload
systemctl restart stellaratlas-scp-live-scanner.service
systemctl status stellaratlas-scp-live-scanner.service --no-pager
```

Legacy frontend rebuild is intentionally separate:

```bash
pnpm build:legacy-frontend
systemctl restart stellaratlas-frontend-legacy.service
```

Verify templates:

```bash
systemd-analyze verify \
  ops/systemd/stellaratlas.target \
  ops/systemd/stellaratlas-api.service \
  ops/systemd/stellaratlas-frontend-v4.service \
  ops/systemd/stellaratlas-frontend-v4-staging.service \
  ops/systemd/stellaratlas-frontend-legacy.service \
  ops/systemd/stellaratlas-network-scanner.service \
  ops/systemd/stellaratlas-scp-live-scanner.service \
  ops/systemd/stellaratlas-users.service \
  ops/systemd/stellaratlas-history-scanner@.service
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

## Link Timers

Review these values in the service before linking:

- `User=observe`
- `WorkingDirectory=/home/observe/stellarbeat-data/Observer`
- `Environment=HOME=/home/observe`
- `Environment=PATH=...`
- `EnvironmentFile=-/etc/stellaratlas/stellaratlas.env`

Then link deliberately:

```bash
sudo ln -sfnT "$PWD/ops/systemd/stellaratlas-api-docs-comparison-refresh.service" /etc/systemd/system/stellaratlas-api-docs-comparison-refresh.service
sudo ln -sfnT "$PWD/ops/systemd/stellaratlas-api-docs-comparison-refresh.timer" /etc/systemd/system/stellaratlas-api-docs-comparison-refresh.timer
sudo ln -sfnT "$PWD/ops/systemd/stellaratlas-radar-network-comparison-refresh.service" /etc/systemd/system/stellaratlas-radar-network-comparison-refresh.service
sudo ln -sfnT "$PWD/ops/systemd/stellaratlas-radar-network-comparison-refresh.timer" /etc/systemd/system/stellaratlas-radar-network-comparison-refresh.timer
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
