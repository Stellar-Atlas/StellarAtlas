# Network Scan Runbook

## Purpose

The network scanner observes the live Stellar network and persists current
validator, organization, quorum, ledger, TOML, and archive-scheduling state. It
does not verify archive contents itself. It discovers archive URLs and asks the
history-scan coordinator to schedule verification jobs.

## Scan Stages

1. Crawl known peers and bootstrap peers.
2. Update active node observations, ledgers, versions, and overlay facts.
3. Read node home domains and organization metadata from `stellar.toml`.
4. Apply latest persisted archive up-to-date and archive-error state to nodes.
5. Schedule archive verification jobs for discovered history archive URLs.
6. Update geo and ISP metadata.
7. Compute node indexes and network measurements.
8. Archive inactive nodes according to retention rules.

## Persisted Outputs

- Node and organization snapshots.
- Node measurements and daily rollups.
- Latest network scan time, processed ledgers, latest ledger, and close time.
- TOML metadata and fetch warning evidence.
- Archive scheduling counters copied into `network_scan`.
- SCP observations from the crawler path when enabled.

## Archive Scheduling Relationship

Network scans only discover archive URLs. `ScheduleScanJobs` is a compatibility
wrapper used by the network scanner; it releases stale legacy range jobs and
then delegates to the archive object scheduler.

The active scheduler creates durable object rows, not whole-archive range rows.
Object identities are:

```text
normalized archive URL + object type + object key
```

Examples:

```text
history-archive-state:root
checkpoint-state:03c6b47f
ledger:03c6b47f
transactions:03c6b47f
results:03c6b47f
bucket:178b2f3801db8ee5f01098169c7d7174a7bb3070804ea0fe4a5becab9c3763fd
```

The object queue suppresses duplicate active work by that identity. The scanner
workers claim one object at a time with a global active cap and a per-archive
active cap. This prevents one archive from monopolizing workers and lets the
same object position be checked across many archive sources.

## Archive Scheduling Counters

Each completed network scan exposes four archive scheduling counters:

- `discoveredArchiveUrlCount`: number of history archive URLs discovered from
  the current node/TOML state.
- `scheduledArchiveScanJobCount`: number of new archive object rows inserted
  into the coordinator queue. The field name is legacy API compatibility; the
  value is object-row count.
- `duplicateSuppressedArchiveScanJobCount`: number of candidate archive object
  rows already covered by object queue state or duplicate discovery.
- `schedulerErrorCount`: `0` for a successful scheduling call, `1` when the
  scheduler failed or threw during that network scan.

These counters explain scheduling activity. They do not prove archive integrity.
Archive verification evidence lives in history archive scan rows and bucket
evidence rows.

## Operator Notes

- A network scan with zero scheduled jobs can be healthy when all discovered
  archive objects are already pending, scanning, or verified.
- Archive verification errors are validator/archive evidence.
- Worker issues are StellarAtlas scanner infrastructure evidence.
- Do not treat missing local Horizon/RPC services as network-scan failures.
- Do not run broad live scans without an explicit operator decision.
