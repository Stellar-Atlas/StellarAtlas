# ClickHouse interrupted-merge recovery handoff — 2026-09-07

Status: diagnosis and read-only verification complete; **recovery has NOT run**.
Automatic review rejected the recovery command before execution. Explicit user
approval for the brief Hubble/ClickHouse interruption and exact recoverable move
is pending. Do not retry indirectly or broaden the repair.

## Exact incident and evidence

- Host boot: 2026-09-07 23:07:49 UTC. ClickHouse started 23:08:28–23:08:52 UTC,
  PID 3982, `NRestarts=0`, version 26.8.1.2041.
- Kernel reports journal corruption **or** unclean shutdown, md0 resync, and XFS
  log recovery at boot. Several system-log parts contained zero-byte files.
  This is consistent with interrupted writes; reboot cause/hardware fault is NOT proven.
- 23:09:12 UTC: `stellar_hubble_v2.ledger_transactions` failed asynchronous load.
  Table UUID: `8c86111b-b3b2-4956-afc7-f4b01c4b6f3d`.
- API dataset catalog returned HTTP 503 at 23:27:23 UTC. Direct metadata query
  returned Code 722 → 696/695 → 231: one broken 1.71 GiB part exceeds the
  existing 1 GiB safety threshold. Do not raise that threshold.
- Exact table directory (`BASE` below):
  `/mnt/bulk/clickhouse/data/store/8c8/8c86111b-b3b2-4956-afc7-f4b01c4b6f3d`.
- Broken merged part: `28_56957_56992_3`; partition 28, blocks 56957–56992.
  `count.txt`: **2,318,735 rows**; ledger min/max **29,491,331–29,503,493**.
  `checksums.txt` and `tx_envelope.bin` mtime: 22:59:16 UTC, before the reboot.
- Recorded versus actual sizes:

| File | Recorded bytes | Actual bytes |
| --- | ---: | ---: |
| `tx_envelope.bin` | 742,380,262 | 645,922,816 |
| `tx_meta.bin` | 821,953,442 | 801,112,064 |

Despite a startup “Detaching broken part” log, the size guard prevented completed
recovery: the broken directory remains in `BASE`; the checked detached listing was empty.

## Verified predecessor parts — preserve every one

| Part under BASE | Rows | Total file bytes |
| --- | ---: | ---: |
| `28_56957_56963_2` | 445,741 | 346,211,221 |
| `28_56964_56969_2` | 409,513 | 344,563,311 |
| `28_56970_56976_2` | 446,879 | 383,397,010 |
| `28_56977_56983_2` | 445,642 | 388,675,292 |
| `28_56984_56989_2` | 381,414 | 333,243,758 |
| `28_56990_56990_1` | 81,856 | 68,211,452 |
| `28_56991_56991_1` | 79,725 | 68,198,186 |
| `28_56992_56992_1` | 27,965 | 25,393,982 |
| **Total** | **2,318,735** | **1,957,894,212** |

These cover the complete block interval without gaps. Individual ledger ranges
overlap because inserts ran concurrently; their row sum matches the merged part.
All 317 recorded file-size entries match. No zero-byte files were present.
The installed `clickhouse compressor -d` validated all **280 compressed streams**:
1,957,724,000 compressed bytes, sequential 25 MiB/s cap, nice 19/idle I/O,
77.01 seconds, no checksum/decompression errors. Pressure-stop guard did not fire.
This verifies compressed-block checksums plus manifest sizes, **not** a completed
native `CHECK TABLE ... PART` whole-file checksum comparison.

At 23:44:50 UTC, the small `_ingestion_batches FINAL` manifest query returned
12 complete source batches spanning 29,491,331–29,503,618 with source SHA-256s.
Raw lake files were not reread. No source replay is needed if predecessor recovery passes.

## Approved-scope recovery proposal — requires explicit user approval

Only the existing Hubble importer and ClickHouse may be stopped. Last verified
proof units: scanner PID 49041 and dispatcher PID 48556, both active, zero restarts.
Hubble PID 48577 was active. Reconfirm identities immediately before proceeding.

Use the configured VM SSH route, then **only** `admins@192.168.122.1` for the host.
Use the normal authorized ClickHouse operator client; never print credentials.
The following is a proposal, not a record of commands executed:

```bash
set -euo pipefail
BASE=/mnt/bulk/clickhouse/data/store/8c8/8c86111b-b3b2-4956-afc7-f4b01c4b6f3d
BAD="$BASE/28_56957_56992_3"
SAVED="$BASE/detached/recovery_20260907_28_56957_56992_3"
sudo systemctl stop stellaratlas-hubble-etl.service
# Arm recovery before stopping ClickHouse; never auto-resume Hubble on failure.
trap 'sudo systemctl start clickhouse-server.service' EXIT
sudo systemctl stop clickhouse-server.service
sudo systemctl show clickhouse-server.service -p MainPID -p ActiveState
test "$(sudo systemctl show clickhouse-server.service -p MainPID --value)" = 0
test "$(sudo systemctl show clickhouse-server.service -p ActiveState --value)" = inactive
# REQUIRE MainPID=0 and inactive. Revalidate the exact eight parts above against
# their row counts, total sizes and checksums.txt file-size entries before moving.
test "$(sudo readlink -f "$BAD")" = "$BAD"
sudo test -d "$BAD"
sudo test ! -e "$SAVED"
test "$(sudo stat -c %d "$BAD")" = "$(sudo stat -c %d "$BASE/detached")"
sudo mv -T --no-clobber -- "$BAD" "$SAVED"
sudo test ! -e "$BAD"
sudo test -d "$SAVED"
sudo systemctl start clickhouse-server.service
trap - EXIT
```

Run with fail-fast shell behavior and retain the ClickHouse restart trap on any
intermediate error. This changes no threshold, table schema, data payload, worker
count or batch status. Do not delete the saved directory or any predecessor.
Table-only DETACH/ATTACH clearing this failed asynchronous load was NOT established;
normal table lookup currently throws the cached load failure. Do not invent a reload command.

### Data gate before resuming Hubble

1. Confirm ClickHouse active and `ledger_transactions` attached. If another corrupt
   table emerges, stop and report; do not quarantine anything else.
2. Query `system.parts` for this exact database/table and the eight named parts.
   Require active row sum 2,318,735. If an automatic merge already replaced them,
   reconcile only exact covering part/block metadata, not an unbounded table scan.
3. For native full-file verification, run sequential named-part checks through the
   normal operator client: `CHECK TABLE stellar_hubble_v2.ledger_transactions
   PART '28_56957_56963_2'`, then the other seven exact names (or verified successor).
   Keep reads bounded/sequential; do not run whole-database CHECK or OPTIMIZE.
4. Require analytics catalog and a known bounded typed transaction/balance request
   to succeed; preserve actual contiguous/supplemental coverage distinctions.
5. Only after the gate passes: `sudo systemctl start stellaratlas-hubble-etl.service`.
   Confirm unchanged configuration and one normal completed batch. Verify scanner
   and dispatcher remain active with their pre-recovery PIDs unchanged.

## Rollback / retained evidence

The saved directory is recoverable at the exact `SAVED` path above. No data is
discarded. Moving it back would restore the **previous broken-table state**, not
working availability. Only with a new explicit rollback decision: stop Hubble and
ClickHouse, confirm `BAD` absent and same filesystem, then
`sudo mv -T --no-clobber -- "$SAVED" "$BAD"`; restart ClickHouse even if the move
fails. Do not resume Hubble unless the data gate passes. Never overwrite a new
part of the same name, remove predecessors, or adjust corruption thresholds.

References: [DETACH preservation](https://clickhouse.com/docs/reference/statements/detach),
[CHECK TABLE](https://clickhouse.com/docs/reference/statements/check-table),
[MergeTree settings / old_parts_lifetime](https://clickhouse.com/docs/reference/settings/merge-tree-settings),
[official checksum format](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeDataPartChecksum.cpp).
