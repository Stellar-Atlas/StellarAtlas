# Native Stellar RPC build

The RPC 29.0.1 patch stack publishes a coherent, immutable ledger-head snapshot after a successful database commit. Protocol reads and stale-health rejection can use that snapshot without waiting on the ingestion writer mutex. Failed commits preserve the previous snapshot. Startup falls back to the database, and fresh-health checks retain the authoritative retained range and freshness validation.

The ordered patches are based on upstream commit `055dc9c7a9a9e038c6807a555c09bd94b85c9e2c`. Their corrected source identity is `1191d4b3040e2eda370e3f6a0849081f6c3d3b3f`, with tree `c6b8513313678382d0d924b94d650b70777abdd2`. They retain the committed-head correction and include focused regression tests. Protocol versions, database schema, durability, retention, freshness thresholds, and request timeouts remain unchanged.

## Optional pager controls

`sqlite-cache-kib` sets a suggested SQLite pager target per serving connection, and `sqlite-max-open-connections` bounds the serving pool. Both default to zero, preserving the existing DSN and pool defaults. A positive pager target requires an explicit serving connection count from 2 through 7. The cache setting applies to newly opened serving connections.

Validation reserves the existing 32 MiB index target and a 16 MiB auxiliary allowance from an aggregate suggested 2 GiB budget before checking the per-connection target. These values are pager suggestions, not an RSS limit or a bound on total query, native, Rust preflight, or OS file-cache memory. No live settings or performance improvement are implied by building this package.

Read transactions reserve a SQL connection before acquiring the cache read lock, preventing a full-pool wait from blocking the writer commit needed to release a connection. The retained driver uses deferred BEGIN, so acquisition does not establish a database snapshot before the cache lock is held.

## Build

Use Linux amd64, Python 3, Git, GCC and the exact Go, Rust and Cargo versions recorded in `build-inputs.json`. A GNU libc development environment is required for CGo. Put those tools on PATH. The script creates a new directory, fetches the pinned upstream commit, verifies each ordered patch and the resulting tree, and builds the locked native libraries and RPC binary. Existing Go and Cargo caches can be reused through their standard environment variables. Initial dependency preparation requires network access.

```sh
python3 ops/stellar-rpc/build-native.py /var/tmp/stellar-rpc-build
```

The output directory contains `stellar-rpc` and `build-result.json`. The recorded timestamp and source metadata are fixed in the build inputs. Identical input versions do not by themselves guarantee byte-identical output across different C toolchains or system libraries. Check the resulting ELF dependencies against the intended runtime before installation.

## Validation

Focused race-detector checks passed for database behavior and configuration round trips. They cover zero-default parity, per-connection pager application, pool and budget validation, overflow boundaries, and the connection-acquisition cycle. Retained committed-head checks passed for the database package and the touched handler, protocol, and health files. These cover committed-head publication, failed-commit preservation, immutable returns, reads while the writer mutex is held, startup/reset behavior, stale-health rejection, and retained-range authority. This is focused qualification, not a claim that the entire upstream suite ran.

The source correction does not establish that historical catch-up throughput or current ledger freshness has recovered. Runtime selection requires the built artifact's compatibility and health checks.
