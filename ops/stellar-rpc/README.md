# Native Stellar RPC build

The RPC 29.0.1 patch publishes a coherent, immutable ledger-head snapshot after a successful database commit. Protocol reads and stale-health rejection can use that snapshot without waiting on the ingestion writer mutex. Failed commits preserve the previous snapshot. Startup falls back to the database, and fresh-health checks retain the authoritative retained range and freshness validation.

The patch is based on upstream commit `055dc9c7a9a9e038c6807a555c09bd94b85c9e2c`. Its corrected source identity is `1e9c2c0ad9586bb6db779ea3efbd13bc1ec662d4`, with tree `d82c752913cddeb7e5a8e3c0aa2a12d49cfbbb94`. The patch includes focused regression tests. It does not change protocol versions, database schema, durability, retention, connection limits, or timeouts.

## Build

Use Linux amd64, Python 3, Git, GCC and the exact Go, Rust and Cargo versions recorded in `build-inputs.json`. A GNU libc development environment is required for CGo. Put those tools on PATH. The script creates a new directory, fetches the pinned upstream commit, verifies the patch and resulting tree, and builds the locked native libraries and RPC binary. Existing Go and Cargo caches can be reused through their standard environment variables. Initial dependency preparation requires network access.

```sh
python3 ops/stellar-rpc/build-native.py /var/tmp/stellar-rpc-build
```

The output directory contains `stellar-rpc` and `build-result.json`. The recorded timestamp and source metadata are fixed in the build inputs. Identical input versions do not by themselves guarantee byte-identical output across different C toolchains or system libraries. Check the resulting ELF dependencies against the intended runtime before installation.

## Validation

Focused race-detector checks passed for the database package and the touched handler, protocol, and health files. These cover committed-head publication, failed-commit preservation, immutable returns, reads while the writer mutex is held, startup/reset behavior, stale-health rejection, and retained-range authority. This is focused qualification, not a claim that the entire upstream suite ran.

The source correction does not establish that historical catch-up throughput or current ledger freshness has recovered. Runtime selection requires the built artifact's compatibility and health checks.
