# API Docs Comparison Refresh Timer

These templates schedule the existing one-shot RADAR/StellarAtlas API-doc
comparison refresh outside the API request path.

The timer does not restart `stellaratlas.service`, does not run network scans,
and does not install itself. Operators must review paths and install it
explicitly.

## Files

- `stellaratlas-api-docs-comparison-refresh.service` runs one refresh.
- `stellaratlas-api-docs-comparison-refresh.timer` starts the service every six
  hours with jitter and persistent catch-up after downtime.

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
sudo systemctl daemon-reload
sudo systemctl enable --now stellaratlas-api-docs-comparison-refresh.timer
```

## Operate

```bash
systemctl list-timers stellaratlas-api-docs-comparison-refresh.timer
sudo systemctl start stellaratlas-api-docs-comparison-refresh.service
journalctl -u stellaratlas-api-docs-comparison-refresh.service -n 100 --no-pager
```

The refresh command exits after one attempt. If another refresh is already
holding the advisory lock, the command logs `skipped_locked`; if the latest
snapshot is still fresh, it logs `skipped_fresh`.

## Verify Templates

```bash
systemd-analyze verify ops/systemd/stellaratlas-api-docs-comparison-refresh.service ops/systemd/stellaratlas-api-docs-comparison-refresh.timer
```
