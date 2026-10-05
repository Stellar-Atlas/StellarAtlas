# Transaction-table merge budget

## Scope and policy

`stellar_hubble_v2.history_transactions` uses a 32 GiB maximum total input size
for ordinary future background merges. This is not a global concurrency limit,
an ingestion pause, a row deletion, or a query-deduplication guarantee. Other
tables and existing storage layouts are unchanged. New transaction tables get
the same setting from `apps/hubble-etl/internal/schema/clickhouse.go`;
`CREATE TABLE IF NOT EXISTS` does not update existing tables.

The 2026-10-05 decision used system metadata only: 138 active parts across 37
partitions, at most 10 parts per partition. Of these, 103 parts were at most
32 GiB and 35 were larger. Five regular vertical merges were rewriting about
695 GiB of input to reduce 22 source parts to five. This was optional large-part
consolidation, not an emergency involving thousands of small parts.

## Applied change and rollback

The original `SHOW CREATE TABLE` had no explicit merge-size override. The live
change was applied at 2026-10-05 01:10:08 UTC:

```sql
ALTER TABLE stellar_hubble_v2.history_transactions
    MODIFY SETTING max_bytes_to_merge_at_max_space_in_pool = 34359738368;
```

The exact preimage, source-part names, rows/bytes and merge metadata are retained
on the host at:

`/var/lib/stellaratlas/recovery/ch-transactions-merge-cap-20261005-YLqByY`

Rollback restores the inherited policy, rather than assuming a fixed default:

```sql
ALTER TABLE stellar_hubble_v2.history_transactions
    RESET SETTING max_bytes_to_merge_at_max_space_in_pool;
```

An initial table-only `SYSTEM STOP MERGES` attempt was made after the ALTER, with a
45-second cancellation observation window. All five running merges remained.
Independent cleanup `SYSTEM START MERGES` succeeded at 01:10:54 UTC. Do not
report that initial 45-second observation as completed cancellation. The cap
governs future merge selection and does not shrink already-running merges.

At 01:11:55 UTC all 22 source parts were still active; 138 total active parts,
1,654,854,306 metadata rows and 2,077,579,159,627 on-disk bytes were exactly
unchanged. The five older merge tasks were still present then.

The deployed ClickHouse build is `26.8.1.2041`, commit
`537693a9b20b947a3cf0c4ac90c7c966eee963c9`. Its STOP blocker is checked
cooperatively, and cancellation becomes permanent once a merge task observes
it. START removes the temporary blocker but does not revive a cancelled task.
After reviewing this implementation, an extended 300-second attempt was
authorized with an independent 330-second systemd START restoration timer.
Its preflight at 01:15:47 UTC already found zero merges: the original tasks had
finished cancellation asynchronously. The second STOP found zero tasks, START
succeeded immediately, and only then was the independent timer cancelled.
This final operation is recorded in sibling snapshot directory
`ch-transactions-merge-cap-20261005-HB0feI`.

At 01:16:03 UTC, all original 22 merge source parts remained active; parts, rows
and bytes were still exactly equal to the original snapshot. There were zero
target-table merges. The restoration timer and service were both inactive.
No source parts, warehouse records, services, other tables or RAID settings
were changed. Partial temporary merge output was discarded, not source data.

## Correctness and operating limits

The engine remains `ReplacingMergeTree(_ingested_at)`, ordered by transaction
identity plus `_batch_id` and `_row_number`. Normal retry inserts retain stable
batch/dataset/chunk deduplication tokens and a 65,536-entry deduplication window.
API queries filter against the latest complete batch and source digest, but do
not universally use `FINAL` or `argMax` for fact-row versions. Background merging
is eventual cleanup, not a sufficient query correctness contract. Existing
duplicate versions were not assessed with a full-table scan.

Parts above 32 GiB may retain historical versions longer. If version collapse
becomes necessary, review the query semantics and workload, and consider the
documented setting rollback. Do not run `OPTIMIZE FINAL` as routine maintenance;
it can bypass the ordinary merge-size budget and recreate large rewrites.
Continue observing bounded system metadata for part growth and ingestion
health. This setting does not bound simultaneous smaller merges or remove
ongoing RAID resynchronization pressure.
