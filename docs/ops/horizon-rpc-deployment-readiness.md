# Horizon/RPC Deployment Readiness

Date: 2026-07-06

This is the public-safe readiness checklist for StellarAtlas-owned Horizon and
Stellar RPC on Pubnet. It documents prerequisites only. Do not use it as
approval to install binaries, create root-owned files, start services, restart
production, or add these units to the production target.

## Current State

- `ops/systemd/stellaratlas-horizon.service` and
  `ops/systemd/stellaratlas-stellar-rpc.service` are optional templates.
- `setup-systemd.sh` links both optional units, but `stellaratlas.target` does
  not want either unit today.
- The optional units are guarded by `ConditionFileIsExecutable` and
  `ConditionPathExists`, so missing artifacts are deployment prerequisites, not
  live service crashes.
- The status page must keep Horizon/RPC labeled as planned or not deployed until
  local loopback endpoints are configured, caught up, and probed.

## Source Of Truth

- Unit templates: `ops/systemd/stellaratlas-horizon.service` and
  `ops/systemd/stellaratlas-stellar-rpc.service`.
- Production target: `ops/systemd/stellaratlas.target`.
- App service env: `/etc/stellaratlas/stellaratlas.env`.
- Full-history service env: `/etc/stellaratlas/full-history.env`.
- Horizon admin guide:
  `https://developers.stellar.org/docs/data/apis/horizon/admin-guide`.
- Stellar RPC admin guide:
  `https://developers.stellar.org/docs/data/apis/rpc/admin-guide`.

## Required Artifacts

| Area | Required artifact | Public-safe validation |
| :--- | :--- | :--- |
| Horizon binary | `/home/observe/stellarbeat-data/horizon/bin/horizon` | `test -x /home/observe/stellarbeat-data/horizon/bin/horizon` |
| Stellar Core binary | `/home/observe/stellarbeat-data/stellar-core/bin/stellar-core` | `test -x /home/observe/stellarbeat-data/stellar-core/bin/stellar-core` |
| Horizon env | `/etc/stellaratlas/full-history.env` | `sudo test -r /etc/stellaratlas/full-history.env` |
| Horizon database | Separate Horizon Postgres database, not the Atlas app DB | verify database exists without printing credentials |
| Horizon storage | `/home/observe/stellarbeat-data/horizon/captive-core/pubnet` | `test -d /home/observe/stellarbeat-data/horizon/captive-core/pubnet` |
| Horizon logs | `/home/observe/stellarbeat-data/horizon/logs` | `test -d /home/observe/stellarbeat-data/horizon/logs` |
| RPC binary | `/home/observe/stellarbeat-data/stellar-rpc/bin/stellar-rpc` | `test -x /home/observe/stellarbeat-data/stellar-rpc/bin/stellar-rpc` |
| RPC config | `/home/observe/stellarbeat-data/stellar-rpc/pubnet/config/rpc.toml` | `test -r /home/observe/stellarbeat-data/stellar-rpc/pubnet/config/rpc.toml` |
| RPC working tree | `/home/observe/stellarbeat-data/stellar-rpc/pubnet` | `test -d /home/observe/stellarbeat-data/stellar-rpc/pubnet` |

Never print `DATABASE_URL`, passwords, tokens, private keys, or full RPC TOML
contents into public issues or status payloads.

## Expected Local Ports

- Horizon public API: `http://127.0.0.1:8000`.
- Horizon admin/metrics: `http://127.0.0.1:8001/metrics`.
- Stellar RPC public JSON-RPC: `http://127.0.0.1:8002`.
- RPC admin/metrics, if enabled: loopback only, not internet exposed.

The RPC config must bind the JSON-RPC endpoint to loopback on the port that will
be placed in `STELLAR_RPC_URL`. The documented Atlas target is
`http://127.0.0.1:8002`.

## Env And Config Checklist

- [ ] `/etc/stellaratlas/full-history.env` exists with file permissions that do
  not expose secrets to non-operators.
- [ ] `DATABASE_URL` in `full-history.env` points at a dedicated Horizon
  database.
- [ ] Horizon database schema has been initialized for the installed Horizon
  version.
- [ ] Horizon runs with `NETWORK=pubnet`, `PORT=8000`, `ADMIN_PORT=8001`,
  `INGEST=true`, `DISABLE_TX_SUB=true`, and `HISTORY_RETENTION_COUNT=0` unless
  an operator explicitly chooses a different retention policy.
- [ ] Horizon captive-core storage is
  `/home/observe/stellarbeat-data/horizon/captive-core/pubnet`.
- [ ] Horizon captive-core log path is
  `/home/observe/stellarbeat-data/horizon/logs/captive-core.log`.
- [ ] RPC config includes Pubnet network settings, history archive sources,
  bounded retention, local storage paths, and loopback endpoint binding.
- [ ] RPC config includes captive-core or equivalent network/quorum settings
  required by the installed RPC version.
- [ ] Binary versions are pinned, recorded, and compatible with the current
  Pubnet protocol target before public traffic is moved.
- [ ] `/etc/stellaratlas/stellaratlas.env` still uses the public Horizon
  fallback and no local RPC URL until local probes pass.
- [ ] No status page or issue file contains secret env values or raw config
  dumps.

## Data Directory Checklist

- [ ] `/home/observe/stellarbeat-data/horizon` is owned by `observe:observe`.
- [ ] `/home/observe/stellarbeat-data/horizon/captive-core/pubnet` is writable
  by `observe`.
- [ ] `/home/observe/stellarbeat-data/horizon/logs` is writable by `observe`.
- [ ] Horizon database disk, WAL, backup, and monitoring capacity are reviewed
  for full-retention ingestion.
- [ ] `/home/observe/stellarbeat-data/stellar-rpc` is owned by
  `observe:observe`.
- [ ] `/home/observe/stellarbeat-data/stellar-rpc/pubnet/config` is readable by
  `observe`.
- [ ] RPC database/cache/captive-core paths named in `rpc.toml` are writable by
  `observe`.
- [ ] Any rebuildable read models are documented as rebuildable from canonical
  Postgres/archive data.

## Read-Only Preflight Commands

These commands should not mutate production state.

```bash
git diff -- ops/systemd/stellaratlas-horizon.service \
  ops/systemd/stellaratlas-stellar-rpc.service \
  ops/systemd/stellaratlas.target

systemd-analyze verify \
  ops/systemd/stellaratlas-horizon.service \
  ops/systemd/stellaratlas-stellar-rpc.service

systemctl show -p Wants stellaratlas.target
systemctl list-dependencies --plain stellaratlas.target | rg 'horizon|rpc' || true

test -x /home/observe/stellarbeat-data/horizon/bin/horizon
test -x /home/observe/stellarbeat-data/stellar-core/bin/stellar-core
sudo test -r /etc/stellaratlas/full-history.env
test -x /home/observe/stellarbeat-data/stellar-rpc/bin/stellar-rpc
test -r /home/observe/stellarbeat-data/stellar-rpc/pubnet/config/rpc.toml
```

If the target dependency command returns Horizon or RPC before the explicit
target-membership decision below, stop and review the unit graph.

## Operator Activation Checklist

Run only after an operator approves service activation.

- [ ] Review binary provenance and checksums.
- [ ] Initialize or migrate the Horizon database with the installed Horizon
  binary and the dedicated Horizon `DATABASE_URL`.
- [ ] Reload systemd only after unit templates and linked system units are
  reviewed.
- [ ] Start `stellaratlas-horizon.service` manually, without adding it to
  `stellaratlas.target`.
- [ ] Watch Horizon logs until startup, captive-core, and ingestion state are
  understandable.
- [ ] Probe Horizon root and admin metrics on loopback.
- [ ] Start `stellaratlas-stellar-rpc.service` manually, without adding it to
  `stellaratlas.target`.
- [ ] Watch RPC logs until ingestion and network state are understandable.
- [ ] Probe RPC `getHealth` and `getLatestLedger` on loopback.
- [ ] Compare Horizon latest ledger, RPC latest ledger, and public network
  latest ledger. Record lag without exposing secrets.
- [ ] Only after local probes pass, update `/etc/stellaratlas/stellaratlas.env`
  to use:

```bash
HORIZON_URL=http://127.0.0.1:8000
STELLAR_RPC_URL=http://127.0.0.1:8002
```

- [ ] Restart only the services explicitly approved for the config change.
- [ ] Verify `/v1/status/horizon`, `/v1/status/rpc`, `/status`, and
  `/explorer` messaging after the approved restart.

## Probe Commands

Horizon root and latest-ledger API:

```bash
curl -fsS http://127.0.0.1:8000/ | jq .
curl -fsS 'http://127.0.0.1:8000/ledgers?order=desc&limit=1' | jq .
```

Horizon admin metrics:

```bash
curl -fsS http://127.0.0.1:8001/metrics | rg 'horizon_(ingest|history|db|stellar_core)'
```

Stellar RPC health and latest ledger:

```bash
curl -fsS http://127.0.0.1:8002 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq .

curl -fsS http://127.0.0.1:8002 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"getLatestLedger"}' | jq .
```

Atlas API status after approved app env switch:

```bash
curl -fsS http://127.0.0.1:3000/v1/status/horizon | jq .
curl -fsS http://127.0.0.1:3000/v1/status/rpc | jq .
curl -fsS http://127.0.0.1:3000/v1/status/full-history | jq .
```

Expected readiness evidence:

- Horizon returns HTTP 200 on loopback root.
- Horizon metrics include ingestion, history, DB, or captive-core metrics.
- RPC `getHealth` returns a healthy result.
- RPC `getLatestLedger` returns a recent ledger.
- Atlas status rows report configured local URLs only after the app env switch.

## Target Membership Decision

Keep Horizon/RPC out of `stellaratlas.target` until all of these are true:

- [ ] Horizon and RPC have run manually through restart/catch-up drills.
- [ ] Loopback probes are implemented or operator-run probes are mandatory for
  release verification.
- [ ] Public `/status` distinguishes required production outages from optional
  roadmap services.
- [ ] On-call ownership, dashboards, alert thresholds, backups, and restore
  steps exist.
- [ ] The `observe` systemd permission model is reviewed. The current polkit
  allow-list does not include the optional Horizon/RPC units.
- [ ] A rollback plan returns Atlas to public Horizon fallback and an
  unconfigured local RPC without hiding the reason.

After the decision, make a separate reviewed change to `stellaratlas.target` and
the polkit allow-list if operators should manage these units without sudo. Do
not combine target membership with binary installation or first production
start.

## Public Status Rules

- Missing local Horizon/RPC artifacts mean `planned` or `not_deployed`, not
  `down`.
- `probe: "not_run"` is configuration evidence only.
- A configured URL is not health proof.
- Public status may show loopback URL class and readiness state, but not secret
  env values, database names with credentials, private key material, or raw
  config files.
- Explorer contract and transaction reads must continue to disclose whether
  they use public fallback services, local Horizon, local RPC, or local read
  models.
