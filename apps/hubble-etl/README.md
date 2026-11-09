# Hubble parsed-history importer

The authoritative source is the VM checkout. The host executes its built binary
through `/mnt/fast/stellaratlas/bin/stellaratlas-hubble-etl-current`; the
tracked service is `ops/systemd/stellaratlas-hubble-etl.service`.

There is one importer service. Its existing workers consume retained immutable
LCM batches into the existing ClickHouse warehouse. The shared I/O pressure
guard, immutable source-digest checks, and completed-batch deduplication apply
to every batch, including a priority batch.

The importer and warehouse maintenance commands connect directly to
`CLICKHOUSE_URL`; they do not inherit forward proxies from `HTTP_PROXY` or
`HTTPS_PROXY` and do not follow redirects. Set the URL to a directly reachable
HTTP(S) endpoint, which may be loopback, private, or a reverse proxy explicitly
serving ClickHouse at that URL.

## Warehouse readiness admission

Both workers share one cached readiness gate. It resolves the ingestion manifest
and all 20 required dataset tables using sequential `DESCRIBE TABLE` requests,
without reading dataset rows. A running ClickHouse process or successful ping
does not prove that its asynchronously loaded tables are available.

A successful probe is cached for 60 seconds; only one probe runs at a time.
Probes have a 10-second total deadline. An unavailable warehouse pauses new batch
admission and is rechecked after 15 seconds, with cancellation-aware waits.
ClickHouse request failures invalidate the cache; local source/digest/decoder
failures and normal shutdown do not. The gate runs before catalog loading and
again before source decoding, including after a long I/O-pressure wait.
Already admitted batches retain their normal completion/failure handling.

`warehouse-unavailable` journal events include the table/request failure and
paused-admission action; `warehouse-ready` records recovery. Once table readiness
returns, the same workers resume automatically under unchanged I/O limits.
Startup initialization failures wait for readiness before one initialization
retry, rather than repeatedly issuing schema statements while tables are down.

This is availability supervision, not corruption repair: it does not move or
delete parts, raise corruption thresholds, replay source data, restart ClickHouse,
or send an external alert. Damaged parts still require the separately validated
recovery procedure. Observe transitions with
`journalctl -u stellaratlas-hubble-etl.service`; a healthy gate does not claim
complete historical coverage or validate every stored row/checksum.

## Optional historical admission hold

`HUBBLE_ETL_HISTORY_HOLD_FILE` is disabled when unset, with no marker access.
When configured, it names a regular root-owned marker in a dedicated directory
under the existing Linux `/run` tmpfs. All parent directories must be root-owned,
non-symlink directories without group/world write access. The marker must also
be non-symlink, singly linked, non-group/world-writable and at most 4 KiB;
its contents are never read.

Presence holds new historical admissions, including baseline history. Absence in
a valid directory resumes them under the existing guards. Unsafe or unavailable
control state holds history only. Checks occur at admission boundaries and once
per second while held; logs report only held/resumed transitions. Current-ledger
workers never consult this control, and admitted imports finish normally.
This is a coordination control, not instantaneous cancellation or a guarantee
that shared I/O contention will disappear.

## Optional current-first bulk headroom

`HUBBLE_ETL_HISTORY_BULK_CAPACITY_POLICY` enables an additional history-only
admission check in continuous reserved-current mode. Leave it unset or empty
to retain the ordinary checks. When set, supply one JSON object with these
exact fields: `bulkRoot`, `sourceMinimumFreeBytes`,
`sourceMinimumFreeBasisPoints`, `sourceCycleOutputBytes`,
`currentWarehouseMarginBytes`, and `unreservedGrowthPerHistorySlotBytes`.
Use the source's configured bulk root, floors, and full cycle output allowance.
The two growth margins require explicit operator sizing; request/chunk limits
do not bound whole-batch disk growth.

Enable only when the Linux publisher talks directly to local ClickHouse on a
literal loopback endpoint and both services see the same underlying bulk
filesystem. Each new historical import checks paired filesystem and ClickHouse
capacity immediately before ingestion. The gate deducts current ClickHouse
reservations once and leaves room for every configured historical slot. It is
an admission check, not an allocation or quota; other writers can still consume
space. Current work and admitted imports keep their existing checks and
lifecycle. History retries automatically after capacity recovers.

If service isolation denies the reported directory's parent paths, optionally
set all three of `clickhouseReportedPath`, `clickhouseMetadataPath`, and
`clickhouseMetadataInode`. The metadata path must be a service-private
read-only bind of that exact directory, with searchable parents but no read
or search permission on the directory itself for the publisher. A read-only
mount by itself does not prevent reading database files. The publisher checks
the reported path, bound inode, effective permissions, and shared filesystem
before accepting capacity. Do not grant directory read/search access to enable
this check.

`HUBBLE_ETL_CURRENT_WRITE_BUDGET_BYTES` opts the reserved current slot into
bounded publication. It requires `HUBBLE_ETL_CURRENT_WRITE_MIN_LEDGER` (current
slot only), the paired
history policy with the full 8 GiB source cap and 64 GiB warehouse runway, and
one source batch of 64–128 ledgers. Use canonical decimal bytes (1–32 GiB)
and enable it together with the source's standing bulk commit guard. The
publisher writes `HUBBLE_ETL_CURRENT_WRITE_READY_FILE` into its systemd
runtime directory after initialization. Give the source read-only access to
that same file at the matching path; let systemd remove the runtime directory
on service stop. The source rejects a missing or previous-boot publisher.
The
configured cap covers cumulative INSERT bodies, a debit for the staged
holder and pool promotions, and a small reserved status allowance; it is not
a limit on bytes ClickHouse writes to disk. Current inserts are synchronous
and each takes a fresh paired capacity measurement. A known low-capacity
result pauses new writes and retries the check without replaying the batch.
The independent history threshold and ordinary publishing remain unchanged
when this mode is not configured. Do not qualify a smaller storage runway
from serialized payload length alone: check actual part and reservation
growth with the installed ClickHouse configuration before enabling it.

## Optional one-time retained batch priority

Set `HUBBLE_ETL_PRIORITY_BATCH_ID` in the existing host file
`/etc/stellaratlas/hubble-etl.env` to an exact batch UUID already present in the
network-scoped immutable catalog. Do not put credentials in this repository.

This moves that batch ahead of ordinary ascending admission, before the
configured maximum-batch limit. It does not add workers, download another
source, bypass pressure, or skip incomplete ingestion. A completed batch with
the same source digest is skipped normally. An unknown ID or changed immutable
digest is an error.

The initial modern-data publication selects:

- Batch: `3dca0dce-5e01-4620-a95b-e95ce4a58323`
- Inclusive ledgers: **63,490,179–63,491,202** (1,024 ledgers)
- Existing retained raw LCM source; no second importer or parallel replay.

Apply a built candidate only through the existing service. Preserve its previous
binary target, update the existing symlink atomically, and restart only Hubble.
Do not change the worker count or pressure thresholds to force priority
admission.

Before calling the batch published, verify its latest `_ingestion_batches` state
is `complete` with the expected source digest, then verify its parsed
operations, events and classification through the analytics API. Progress logs
include the completed batch ID and ledger range.

Remove the one-time priority setting after publication. The running process may
retain that ID until its next normal restart, but completed-digest deduplication
prevents a replay. All remaining work continues in its original ascending order.

Modern supplemental coverage does **not** fill the earlier unparsed gap. The
analytics catalog reports contiguous and supplemental coverage separately.

## Heterogeneous contract-event input

Tables with Dynamic columns are encoded using the pinned official ClickHouse Go
Native encoder over the existing HTTP client. Each nested value is explicitly
typed: objects use Map(String, Dynamic), arrays use Array(Dynamic), and strings,
booleans, numbers, nulls and empty containers retain their meaning. Original XDR
strings and retained raw LCM remain unchanged. No warehouse schema changes or
additional connection pools are involved. Tables without Dynamic columns retain
their existing JSONEachRow input path.

Permissive JSON inference is intentionally not used: it can coerce numeric
strings or discard empty objects/null-valued keys. Unknown columns, unsupported
types and integer overflow fail closed.

Native chunks use a deterministic native-v1 token suffix. The batch UUID, source
SHA256 and row numbers do not change. Before replaying an incomplete batch from
an older, lossy encoding, isolate only its proven-exclusive partial data; do not
publish old and repaired rows together. Completed source digests remain skipped.

The focused real-parser regression uses installed clickhouse-local to verify
exact scalar/container/XDR round trips, including numeric strings and UInt64
maximum values. The HTTP contract test verifies deterministic tokens and
immutable row identities across retries. Run go test -race ./... on the host.
The installed-ClickHouse gate is explicitly skipped if clickhouse-local is absent.
