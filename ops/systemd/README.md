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
