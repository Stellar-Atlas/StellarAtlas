# History Archive Scanner Architecture

Date: 2026-07-06

This note documents how StellarAtlas history archive scanning is supposed to
work, what the current worker stages are, and what observability must be added
before the status page can show per-thread activity and recent scan timelines.

This document is a design and verification guide. It is not approval to delete
downloaded buckets, parsed ledgers, scan rows, state rows, or queue rows.

## Archive State Model

A Stellar history archive URL is the archive root advertised by validator TOML
metadata. The root state document lives at:

```text
<archive-root>/.well-known/stellar-history.json
```

StellarAtlas calls this the history archive state. It is archive URL scoped, not
organization scoped, even when the URL is discovered through an organization's
`stellar.toml`.

The root state document tells the scanner:

- the archive state version,
- the publishing stellar-core server string,
- the latest published checkpoint ledger,
- the current bucket list,
- the optional hot archive bucket list.

Checkpoint state files then live under:

```text
<archive-root>/history/xx/xx/xx/history-XXXXXXXX.json
```

Category files live under:

```text
<archive-root>/ledger/xx/xx/xx/ledger-XXXXXXXX.xdr.gz
<archive-root>/transactions/xx/xx/xx/transactions-XXXXXXXX.xdr.gz
<archive-root>/results/xx/xx/xx/results-XXXXXXXX.xdr.gz
```

Bucket files live under:

```text
<archive-root>/bucket/aa/bb/cc/bucket-<bucket-hash>.xdr.gz
```

The scanner must persist the latest history archive state per normalized
archive URL, including fetch/parse failures. Node and organization pages should
read that scanner-owned state; they must not fetch archive state directly from
remote validators during page render.

## Current Scanner Flow

1. Network scan discovers node archive URLs from organization TOML validator
   entries.
2. Network scan performs a bounded freshness check against every discovered
   archive URL's history archive state.
3. Network scan schedules archive verification jobs for discovered archive
   URLs.
4. Coordinator inserts pending jobs with archive URL, range, and normalized
   archive identity.
5. History scanner processes claim jobs using coordinator lease/heartbeat APIs.
6. Worker determines scan settings:
   - fetch latest history archive state when scanning to latest,
   - use explicit range when a fixed recheck is assigned,
   - preserve history archive state when available.
7. Worker scans checkpoint ranges in 64-ledger checkpoint increments.
8. For each range, worker fetches checkpoint state files and extracts bucket
   hashes.
9. Worker fetches ledger, transaction, and result category files.
10. Worker streams XDR and verifies ledger-header, transaction-set,
    result, previous-ledger, and bucket-list hashes.
11. Worker downloads bucket files required for referenced bucket hashes and
    verifies the bucket hash.
12. Worker reports scan result, archive errors, worker issues, verified bucket
    evidence, and parsed ledger headers back to the coordinator.
13. Coordinator persists scan rows, structured evidence, latest state, parsed
    headers, and queue progress.

Verified contiguous progress must only advance through ledgers whose dependency
chain verified cleanly. Attempted progress may advance past a bad range and is
separate evidence.

## Scheduler Fairness Requirements

The scheduler must rotate across archive URLs, not repeatedly schedule the same
archive/range while other archives wait.

Required behavior:

- all pending jobs count as active unfinished work;
- stale release applies to claimed jobs, not pending jobs;
- active pending/claimed jobs are unique by normalized archive URL and range;
- object queue rows are unique by normalized archive URL, object type, and
  object key;
- failed object rows are eligible only when `nextAttemptAt` is due;
- root history archive state rows are refreshed through `refreshAfter`, while
  immutable checkpoint/category/bucket objects remain deduped by identity;
- claim-time host limiting prevents all workers from hitting one host at once;
- overdue archive-error rechecks cannot starve regular archive coverage;
- scheduler decisions are recorded as counts: discovered, scheduled,
  duplicate-suppressed, and scheduler errors.

The fairness policy should use normalized archive identity, object identity, and
host identity as first-class fields, not ad hoc URL string comparison.

## Worker Stage Visibility

The status page needs two data classes.

Current activity is one row per worker slot or worker thread:

```text
scanner id
process id
thread id or slot id
job remote id
archive url identity
stage code
range from/to
checkpoint ledger
category code
bucket hash
started at
last heartbeat at
```

Historical activity is a bounded structured event log:

```text
job remote id
archive url identity
sequence number
stage code
status code
range from/to
checkpoint ledger
category code
bucket hash
started at
ended at
duration ms
error class code
retry eligible at
verification fact summary
```

Do not store long free-form log strings for every worker action. Use compact
stage/status/error codes plus normalized identifiers. Human-readable labels are
derived in the API/frontend.

Suggested stage codes:

| Code | Stage |
| ---: | :---- |
| 1 | claim job |
| 2 | fetch history archive state |
| 3 | plan range |
| 4 | fetch checkpoint state |
| 5 | fetch category file |
| 6 | parse category XDR |
| 7 | verify checkpoint hashes |
| 8 | fetch bucket |
| 9 | verify bucket hash |
| 10 | persist parsed ledger headers |
| 11 | persist scan result |
| 12 | release or complete job |

Suggested status codes:

| Code | Status |
| ---: | :----- |
| 1 | started |
| 2 | completed |
| 3 | archive error |
| 4 | worker issue |
| 5 | skipped |
| 6 | retried |

Retention should be bounded:

- keep current activity until the job is completed or released;
- keep detailed events for the last five scan jobs per archive URL;
- keep detailed events for the last seven days globally;
- roll older detail into per-archive/per-day aggregates before deletion;
- never delete raw archive cache or parsed data as part of log retention.

## Status Page Tabs

The archive section of the status page should have at least these tabs:

- Queue: pending, claimed, stale, duplicate-suppressed, and next eligible jobs.
- Workers: every scanner process/thread slot and its current stage.
- Runs: recent completed runs with attempted range, verified range, duration,
  and error classes.
- Archive state: latest history archive state per archive URL, including
  invalid/unreachable state fetch evidence.
- Buckets: recent bucket verification evidence and cross-archive bucket status.
- Scheduler: last scheduling cycle, fairness counters, host caps, and backoff.

The node page should show the node's archive state, run log, and bucket evidence.
The organization page should aggregate all known node archive URLs assigned to
that organization and show whether equivalent buckets are verified elsewhere in
the same organization or network.

## Data Safety

The scanner and observability work must not delete:

- downloaded bucket cache,
- parsed ledger headers,
- parsed transaction/result data,
- scan result rows,
- archive state rows,
- bucket evidence rows,
- organization/node TOML evidence.

Allowed cleanup is limited to bounded observability event retention and
no-delete queue reconciliation that marks duplicate active queue rows inactive
without removing historical evidence.
