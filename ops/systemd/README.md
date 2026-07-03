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
- `stellaratlas-history-scanner@.service` runs bounded history scanner
  instances.
- `stellaratlas-users.service` runs the user/mail service.

`10-stellaratlas-observe.rules` lets the `observe` user start, stop, restart,
and reset only the listed StellarAtlas units without an interactive password.

Install or migrate deliberately:

```bash
sudo ./setup-systemd.sh
```

The script installs the split units, installs the polkit rule, disables and masks
the old root-run all-in-one `stellaratlas.service`, reloads systemd, and starts
`stellaratlas.target`.

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
systemctl restart stellaratlas-api.service
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

## Install

Review these values in the service before installing:

- `User=observe`
- `WorkingDirectory=/home/observe/stellarbeat-data/Observer`
- `Environment=HOME=/home/observe`
- `Environment=PATH=...`
- `EnvironmentFile=-/etc/stellaratlas/stellaratlas.env`

Then install deliberately:

```bash
sudo install -m 0644 ops/systemd/stellaratlas-api-docs-comparison-refresh.service /etc/systemd/system/
sudo install -m 0644 ops/systemd/stellaratlas-api-docs-comparison-refresh.timer /etc/systemd/system/
sudo install -m 0644 ops/systemd/stellaratlas-radar-network-comparison-refresh.service /etc/systemd/system/
sudo install -m 0644 ops/systemd/stellaratlas-radar-network-comparison-refresh.timer /etc/systemd/system/
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
