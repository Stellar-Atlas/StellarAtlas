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
- `stellaratlas-network-scanner.service` runs the network scanner.
- `stellaratlas-scp-live-scanner.service` continuously indexes live SCP
  observations into the live search read model.
- `stellaratlas-history-scanner@.service` runs the bounded history object
  scanner with 24 total object worker processes and one scanner loop per worker.
- `stellaratlas-users.service` runs the user/mail service.

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
propagate to the API, frontend, legacy frontend, network scanner, SCP collector,
users service, and `history-scanner@1` without reviving the old monolithic unit.

After changing a unit template, install the new copies before restarting:

```bash
sudo ./setup-systemd.sh
systemctl restart stellaratlas.target
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
systemctl restart stellaratlas.target
```

Live SCP collector deploy:

```bash
pnpm build:scp-live-scanner
systemctl restart stellaratlas.target
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
