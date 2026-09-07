# Exact archive scan progress: accounting decision

Audit and bounded seed implementation, 2026-09-07. The seed is a manually invoked,
finite operation; it does not run at startup or authorize an unlimited backfill,
extra admission gate, or runtime restart.

## What the number must mean

Count distinct checkpoint positions per advertised archive identity for which
there is a recorded terminal category result or conclusive listing-absence
evidence. Count a position once even when several categories, retries, failures,
or overlapping listing ranges cover it.

- Category types: checkpoint-state, ledger, transactions, results, and SCP.
- Exclude root-state observations and buckets' incidental checkpoint tags. One
  bucket can serve many checkpoints; its first-reference tag is not scan coverage.
- Exclude untouched pending objects/proofs, discovery, reservations, published
  broker messages, claimed-only attempts, and the scheduler cursor.
- Keep scan coverage separate from verified proofs, unavailable files, scanner
  issues, analytics ingestion, and successful complete archive coverage.
- A listing-confirmed absence is coverage by listing evidence, not a successful
  GET, matching bytes, or a cryptographic proof. A listed next filename does not
  establish that its contents were fetched.

Important limit: existing attempts are not exact physical HTTP-request receipts.
The legacy claimant increments attempts when claiming work, before a response is
fetched; a claimed job can fail before any GET/body. Broker terminal writes record
the accepted claim attempt after a reported result. Count only accepted terminal
results (verified or failed), including scanner-side failures, not attempts > 0
alone. Call this **recorded scan coverage**, not downloaded checkpoints, successful
files, or complete archive verification. A scanner-side setup failure is still a
recorded result but does not assert the archive received an HTTP request.

## Existing evidence and missing projection

Sources below are repository-relative file:line references:

- apps/backend/src/history-scan-coordinator/infrastructure/repositories/database/HistoryArchiveObjectClaimSql.ts:234
  increments legacy attempts at claim.
- apps/backend/src/history-scan-coordinator/infrastructure/repositories/database/HistoryArchiveObjectLeaseWrite.ts:329
  starts the fenced verified batch update; line 360 records broker attempts.
  Only its accepted RETURNING rows may feed a completion projection.
- apps/backend/src/history-scan-coordinator/infrastructure/repositories/database/HistoryArchiveObjectFailureWrite.ts:38
  records broker failure attempts; line 70 rejects stale/unaccepted writes before
  listing evidence persistence.
- apps/backend/src/history-scan-coordinator/infrastructure/repositories/database/HistoryArchiveListingGapWrite.ts:8
  validates root-bound evidence after accepted checkpoint-state 404; line 44
  persists a compact interval rather than inferred per-file failures.
- apps/backend/src/history-scan-coordinator/use-cases/record-history-archive-object-event/HistoryArchiveObjectEventRecorder.ts:42
  skips current durable verified events; the batch path also filters them at
  line 50. Consequently an event-only seed misses successful attempts.
- apps/backend/src/history-scan-coordinator/infrastructure/database/migrations/1784370000000-HistoryArchiveObjectEventMigration.ts:10
  retains category/checkpoint/attempt evidence independently of queue rows.
- apps/backend/src/history-scan-coordinator/infrastructure/database/migrations/1785420000000-HistoryArchiveCheckpointProofAttestationMigration.ts:94
  defines distinct durable verified positions, not all attempted positions.
- apps/backend/src/history-scan-coordinator/infrastructure/repositories/database/HistoryArchiveEvidenceRootSummarySteadyStateSql.ts:1
  maintains object counts, not a distinct checkpoint union.
- apps/backend/src/history-scan-coordinator/infrastructure/repositories/database/KnownArchiveListingGapQuery.ts:8
  caps public listing samples at 20; the sample cannot seed/count all intervals.

There is no maintained cheap exact union in these sources. Neither summing file
counts nor adding verified-count and missing-range lengths is correct.

## Implemented bounded projection

Use a rebuildable sparse bitmap-page table, not one row per checkpoint:

    archive_identity text
    ordinal_page integer
    checked_bitmap bit(4096)
    listing_bitmap bit(4096)
    checked_count, listing_count, union_count generated from bit_count
    primary key (archive_identity, ordinal_page)

For valid checkpoint C (C >= 63 and C % 64 = 63), ordinal = C / 64 using
integer division, page = ordinal / 4096, and offset = ordinal % 4096.
Each 512-byte mask covers 4,096 checkpoint positions. Approximately one million
positions need 245 pages per root, about 250 KiB for both masks plus row/index overhead.
Adjacent and sparse history have the same bounded per-page update cost.

For accepted completion batches, group by root/page and OR incoming bits. Upsert
each mask = old | incoming only WHERE the value changes. Further categories and
retries at an already covered position cause no physical bitmap rewrite.
Apply listing ranges at page granularity; a million-position gap needs about
245 masks, not a million insertions. Preserve detailed original failure/listing
evidence in its existing tables.

Implementation hooks cover accepted verified batches, accepted failures, and
accepted listing-gap inserts. Only recorded terminal outcomes are counted;
legacy claims alone are deliberately excluded.
Do not create a second per-job event stream.

Sum the small maintained page counts through the existing source-summary cache,
not the object/event/proof fact tables. If a persistent per-root total is added,
maintain it from actual old/new page-count deltas in batches with one consistent
lock order. An unguarded read-sum-write can lose concurrent updates. Do not add
per-object advisory locks or rewrite one growing whole-root bitmap per completion.

An interval/multirange representation can be smaller for dense runs, but unknown
legacy fragmentation makes its whole-root rewrite cost unbounded. Bitmap pages
are the safer bounded default. A result's percentage must use an explicit target
height; stale advertised heads must not silently clamp or relabel the raw count.

## Seed cost and release gates

Catalog estimates, not COUNT queries, observed during this audit:

| Source | Estimated rows | Heap bytes |
| --- | ---: | ---: |
| Object queue | 101,507,248 | 69,836,382,208 |
| Retained object events | 53,082,648 | 23,363,952,640 |
| Listing gaps | Tiny interval table | 8,192 |

The ordinary checkpoint index does not include attempts, so an index-only seed
cannot be promised. A complete retained-evidence seed needs a resumable narrow
PK-keyset pass over retained terminal category queue rows, retained terminal
events (including removed queue rows), compact durable attested checkpoint
positions, and all conclusive listing ranges.
Do not read large JSON facts, run a giant DISTINCT transaction, build a new large
index just for this metric, or start an unlimited read loop.

Install and test prospective capture first; then record seed boundaries and OR
bounded chunks idempotently while new work continues. Record resumable offsets
and four-source seed completeness. Until coverage is fully seeded and reconciled,
return unknown or an explicit lower bound; never display an invented exact count
or 100%. Describe the metric as recorded evidence, not every physical request
that might historically have occurred without a durable receipt.

Tests required: repeated categories/retries; attempts-zero pending exclusion;
legacy claim versus terminal-result semantics; stale claim rejection; bucket
exclusion; page boundaries; overlapping/adjacent listing intervals and attempts;
malformed/incomplete listing rejection; concurrent OR updates; restart during
seeding; new work during seed; alias isolation; target-height clipping and no
false percentage while seed is incomplete. Resolving a genuine old absence does
not erase the fact that the position was scanned; invalidated evidence needs a
separate correction/rebuild rule, not an arbitrary decrement.

### Manual resumable entry point

After the migration and prospective hooks are deployed, invoke from apps/backend:

    node lib/history-scan-coordinator/infrastructure/cli/archive-scan-seed/run-history-archive-checkpoint-scan-seed.js --run --rows=1000 --chunks=1 --duration-ms=10000

Default is one chunk, one database connection, 1,500 ms statement timeout and
250 ms lock timeout. Each subsequent invocation resumes the persisted cursor.
The duration limit is checked between chunks; an in-flight bounded transaction
may finish after that deadline. Maximum accepted flags are 10,000 metadata rows,
100 chunks and 60,000 ms, never an unlimited run. A listing chunk handles one
range because a single interval may already cover a million checkpoints.
This entry point is not scheduled automatically; choose an explicit bounded
invocation after observing existing storage pressure. No seed was run on live
data while implementing or testing it.

Implementation files (repository-relative):

- apps/backend/src/history-scan-coordinator/infrastructure/repositories/database/HistoryArchiveCheckpointScanSeed.ts
- apps/backend/src/history-scan-coordinator/infrastructure/repositories/database/HistoryArchiveCheckpointScanSeedSource.ts
- apps/backend/src/history-scan-coordinator/infrastructure/cli/archive-scan-seed/run-history-archive-checkpoint-scan-seed.ts

Initialization captures indexed upper PK boundaries for four sources. Priority
is listings, compact verified attested positions, events, then queue. Numeric
queue/event IDs remain numeric in ORDER BY even though serialized cursors are
strings; UUID keysets are never used. Each chunk reads at most its limit of
narrow metadata rows BEFORE terminal filtering, avoiding an unbounded search
through pending jobs. The OR writes and source cursor commit in one transaction.
New accepted results use the same OR helper, so overlap cannot double count.

Complete means the four retained-evidence cutoffs have been traversed while new
results are captured prospectively AND current-root scan union is at least each
root's existing durable verified-position rollup. The final audit compares only
the small source snapshot/rollup tables. Deficits return complete=false with the
affected root/counts, even when all source cursors have reached their cutoffs;
the UI must likewise keep an affected root reconciling. It cannot reconstruct physical requests for
which every receipt was previously removed. While incomplete, the UI must show
an explicit lower bound, optionally max(durable verified positions, seeded
union), never the sum of overlapping counts or a fabricated exact percentage.

## Hubble and RAID: separate audit, not a proof metric

At 04:21Z, the live Hubble importer used two workers and buffers capped at 250,000
rows or 256 MiB per table. It flushes residual rows once per immutable source
batch. Admission repeatedly deferred on the existing md0 in-flight threshold
256 (logs included 416 and 1,825 requests). Do not add a dirty-cache hard stop
without proving writeback will drain independently; that can prevent resumption.

There was no active ClickHouse merge in the one metadata snapshot, zero
level-zero active parts, and the largest fact tables had 150-208 active parts,
generally hundreds of MiB to GiB. This does not support changing insert sizes or
disabling merges as an immediate remedy.

Confirmed avoidable duplication: the projector emits both history_transactions
and ledger_transactions from each transaction. Both official transforms marshal
the same tx_envelope, tx_meta, and tx_fee_meta. Those three columns occupy
347,715,404,081 compressed bytes in ledger_transactions alone. The tx_result
encodings are different (result body versus result pair), and tx_ledger_history
is distinct: do not blindly remove them.

Small forward-only write-reduction candidate: preserve existing physical rows,
write a thin ledger-transaction extension containing its distinct fields and
immutable batch/row identity, and reconstruct the shared fields through a
compatibility read/view. Gate old/new visibility by a tested manifest/storage
version so incomplete retries cannot duplicate or hide rows. Require row/XDR/API
contract equivalence before cutover; no deletion, bulk rewrite, or changed public
schema is implied. Reusing the already serialized three strings is a smaller
CPU/allocation-only improvement, but does not remove duplicate disk writes.

Relevant source: apps/hubble-etl/internal/projector/projector.go:89 and :99;
apps/hubble-etl/internal/clickhouse/writer.go:106 and :113;
apps/hubble-etl/cmd/stellaratlas-hubble-etl/main.go:149;
apps/hubble-etl/internal/backfill/selection.go:19; and
apps/full-history-etl/pkg/lcmbatch/batch.go:48, :55, and :136.
Completed source digests are skipped before decoding, and raw LCM is read once
then decoded from memory; this path is not reparsing the same source per archive.

Coverage snapshots: parsed complete union at 04:21Z was 28,742,785 ledgers,
ranges 2-28,741,762 and 63,490,179-63,491,202. Raw-LCM watermark/rollup at 04:24Z
reported 45,800,577 retained ledger records, contiguous 2-45,713,538 plus 87,040
supplemental records whose exact ranges were not read. These are separate from
archive verification coverage. No fact-table counts or production mutations
were performed for this audit.
