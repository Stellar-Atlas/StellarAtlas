# History Archive Scanner Architecture

Date: 2026-07-06

This note documents how StellarAtlas history archive scanning is supposed to
work, what the current worker stages are, and what observability must exist for
status, node, organization, and archive pages to show truthful evidence.

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

## Legacy Range Scanner Flow

The older scanner contract is archive-root/range based. It remains in source as
historical scan evidence and for compatibility, but it is not the target live
scanner contract.

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

Range scan rows are historical range verification evidence. They must not be the
primary public current-worker view once object workers are deployed.

## Current Object Queue Flow

The deployed object queue contract is concrete-file based, but it is not yet a
whole-archive proof system.

Current behavior:

1. Network scans discover archive roots from scanner-owned organization TOML.
2. The coordinator schedules one root history archive state object per archive
   root.
3. When a root state is available, the coordinator schedules objects for the
   latest checkpoint only:
   - checkpoint history JSON,
   - ledger category file,
   - transaction category file,
   - result category file,
   - current and hot archive buckets referenced by the root state.
4. The coordinator also schedules a bounded backward page of checkpoint history
   JSON objects from the latest/oldest scheduled checkpoint for the archive
   root.
5. Object workers claim one archive object at a time.
6. Heartbeats update worker stage and downloaded byte counts.
7. Completion/failure writes the object row and a compact object event.
8. When a checkpoint history JSON object verifies, the scanner sends parsed
   checkpoint history archive state as structured facts. The coordinator then
   schedules supported sibling objects for that checkpoint: ledger,
   transactions, results, and bucket objects referenced by the checkpoint
   state. SCP category files are not scheduled yet.

This is enough to prove that scanner-owned object telemetry works. It is not
enough to prove an archive is fully verified, because whole-archive discovery
and cross-category consistency are still open.

Production observation on 2026-07-06:

- the live queue had 75 archive roots, 24 active bucket downloads, 3 pending
  buckets, 188 failed objects, and 5,074 verified objects;
- only 3 distinct checkpoint ledgers were represented before the bounded
  checkpoint-state cursor, proving discovery was latest/current scoped rather
  than whole-archive scoped;
- all 75 root history archive state rows were due for refresh but still
  `verified`, proving root refresh needs a cursor-driven path;
- legacy `history_archive_scan_job_queue` still contained pending range jobs,
  so range claiming must be gated or reconciled before object mode is the only
  scanner contract;
- object heartbeats now coalesce per active object and use jittered timers so a
  large bucket stream cannot pile overlapping coordinator writes onto the API.
- object queue rows now carry `hostIdentity`, and production claim checks
  enforce both one active object per archive root and a bounded active count
  per host. This is a first host-level pressure guard; it is not yet the full
  host throttle/backoff table.

Post-deploy observation on 2026-07-06 after the bounded checkpoint cursor and
checkpoint fan-out slices:

- a coordinator scheduler pass against existing persisted archive states inserted
  4,494 object rows without a network crawl;
- `/v1/archive-scans/objects?limit=500` showed 3,390 pending, 24 active, 5,174
  verified, and 37 failed object rows;
- the production status page rendered checkpoint-state rows as active scanner
  work with BrowserOS/CDP proof at
  `.codex/screenshots/prod-status-checkpoint-queue-20260706.png`;
- `http://atgc.node.sl8.online` had checkpoint-state rows and ledger,
  transactions, results, and bucket descendants in pending/verified states;
- a verified checkpoint-state row carried `checkpointHistoryArchiveState`
  verification facts whose state ledger matched the object checkpoint ledger
  `63,351,935`.

## Target Object Queue Flow

The target scanner contract is one durable row per archive object, not one row
per archive root/range.

1. Persist root history archive state for every archive root.
2. Enumerate checkpoint history state objects from the archive start point
   through the root state's current checkpoint, in bounded batches.
3. Verify each checkpoint history state object and extract bucket hashes.
4. Schedule sibling category objects for the checkpoint:
   ledger, transactions, results, and SCP where the network/checkpoint requires
   SCP archive files.
5. Schedule bucket objects by bucket hash and archive root, deduplicating stored
   bucket content by bucket hash.
6. Rotate claims across archive roots and hosts so one archive or host cannot
   monopolize all worker slots.
7. Enforce total scanner caps and per-host caps before any HTTP fetch.
8. Store object facts once: checkpoint state facts, category hashes, ledger
   header facts, transaction/result hashes, bucket-list hashes, and bucket
   content hashes.
9. Mark an object as fetched/parsed/hash-verified only for the proof it actually
   has. Mark checkpoint or archive coverage as verified only after the required
   sibling facts agree.
10. Expose object queue, object events, bucket coverage, range history, and
    state snapshots through scanner-owned APIs.

Object-mode category `verified` must not be presented as full archive proof
until ledger, transaction, result, previous-ledger, and bucket-list facts are
checked together.

Minimum additive schema needed for the target flow:

- `hostIdentity` on the object queue, backfilled from `archiveUrl`;
- a discovery cursor per archive URL identity with latest root ledger,
  next checkpoint ledger, oldest discovered checkpoint ledger, root refresh
  timing, and last scheduling timestamp;
- checkpoint state rows that store parsed checkpoint state, bucket-list hash,
  bucket hashes, raw state, and validation status;
- checkpoint verification rows that join checkpoint state, ledger,
  transactions, results, and bucket-list facts into a single proof record;
- host throttle rows with active cap, failure counters, failure class,
  `backoffUntil`, and last success/failure timestamps.

## Scheduler Fairness Requirements

The scheduler must rotate across archive URLs, not repeatedly schedule the same
archive object or host while other archives wait.

Required behavior:

- all pending jobs count as active unfinished work;
- stale release applies to claimed jobs, not pending jobs;
- object queue rows are unique by normalized archive URL, object type, and
  object key;
- archive roots are rotated fairly; workers must not exhaust all slots on a
  single archive root or host;
- host backoff is separate from object retry timing, so a rate-limited host
  cannot create noisy repeated failures while other hosts wait;
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
host identity
stage code
checkpoint ledger
category code
bucket hash
object key
bytes downloaded
started at
last heartbeat at
```

Historical activity is a bounded structured event log:

```text
job remote id
archive url identity
host identity
sequence number
stage code
status code
checkpoint ledger
category code
bucket hash
object key
bytes downloaded
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
| 3 | plan object discovery |
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
- Workers: every scanner process/thread slot and its current object, stage, byte
  count, host, and heartbeat.
- Events: bounded recent object events with claim, heartbeat, verified, failed,
  and released transitions.
- Range history: older completed range scans with attempted range, verified
  range, duration, and error classes, clearly labeled historical.
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
