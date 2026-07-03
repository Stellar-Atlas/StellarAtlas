# History Scan Coordinator

Coordinates and schedules history archive scanning jobs across multiple scanner
instances (workers). Part of the apps/backend service. See apps/history-scanner

## Overview

The coordinator:

- Manages scan chains and scheduling for Stellar history archives
- Provides REST endpoints for workers to fetch jobs and submit results
- Persists scan results and error states
- Uses configurable scheduling strategies to determine which archives to scan
  and which archives to RE-scan fully

## Architecture

### Key Components

- **GetScanJob**: Schedules new scan jobs based on configured strategy
- **Scan**: Represents a segment in a scan chain for an archive
- **ScanScheduler**: Determines which archives to scan next
- **HistoryArchiveRepository**: Manages list of archives to scan

### Scan Chain Concept

A scan chain represents the full verification history of an archive over time:

- Each scan has an `initDate` that groups it into a chain
- Chains are continued by passing previous scan details to the workers
- New chains are started periodically to re-verify from the beginning

## Community Scanner Blocks

Community scanner block state lives on `community_scanners`.

- Temporary blocks must leave `is_blacklisted = false` and set
  `blacklisted_until` to a future timestamp.
- Permanent blocks must set `is_blacklisted = true` and should clear
  `blacklisted_until`.
- Clearing a block must set `is_blacklisted = false` and
  `blacklisted_until = null`.

The coordinator treats a future `blacklisted_until` as blocked for heartbeat and
job-claim admission. Once that timestamp expires, the scanner is eligible again
without another database write. If `is_blacklisted` is true, the scanner remains
blocked even when `blacklisted_until` is null or in the past.

Temporary block:

```sql
update community_scanners
set is_blacklisted = false,
    blacklisted_until = now() + interval '1 hour'
where id = '<scanner-id>';
```

Permanent block:

```sql
update community_scanners
set is_blacklisted = true,
    blacklisted_until = null
where id = '<scanner-id>';
```

Clear block:

```sql
update community_scanners
set is_blacklisted = false,
    blacklisted_until = null
where id = '<scanner-id>';
```

## API Usage

### Get Scan Job

```http
GET /v1/history-scan/job
```

Schedules and return a new Scan job:

### Submit results

```http
POST /v1/history-scan
```
