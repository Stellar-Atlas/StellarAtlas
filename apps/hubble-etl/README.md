# Hubble parsed-history importer

The authoritative source is the VM checkout. The host executes its built binary
through `/mnt/fast/stellaratlas/bin/stellaratlas-hubble-etl-current`; the
tracked service is `ops/systemd/stellaratlas-hubble-etl.service`.

There is one importer service. Its existing workers consume retained immutable
LCM batches into the existing ClickHouse warehouse. The shared I/O pressure
guard, immutable source-digest checks, and completed-batch deduplication apply
to every batch, including a priority batch.

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
