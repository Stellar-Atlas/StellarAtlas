# Archive dispatcher consumer recovery — 2026-09-08

## Observed cause and scope

At 05:11:35Z and again 05:14:55Z, NATS 2.10.7 reported the archive durable
consumer with 211 unacknowledged jobs, zero pending jobs, and 120 waiting pulls.
Its configured capacity was 120. The WorkQueue stream contained only 105
messages. Consumer delivered stream sequence 74,157,583 exceeded the stream's
last sequence 74,156,560. This persisted impossible position made dispatcher
capacity zero; its workers were connected but did no useful work.

The process/service stayed active. The originating storage/restart event has not
been established; old pre-boot PostgreSQL timeout logs do not prove it.

## Narrow recovery performed

At 05:15:45Z, removed and recreated only consumer
`stellaratlas-history-object-workers` on existing stream
`STELLARATLAS_HISTORY_OBJECTS`, using its identical configuration below. After
consumer removal and before recreation the stream still held all 105 messages
with the same last sequence. No stream purge, stream deletion, database
deletion, capacity change, API restart, worker restart, or proof rewrite
occurred.

Exact saved consumer configuration:

```json
{
	"durable_name": "stellaratlas-history-object-workers",
	"name": "stellaratlas-history-object-workers",
	"deliver_policy": "all",
	"ack_policy": "explicit",
	"ack_wait": 120000000000,
	"max_deliver": -1,
	"filter_subject": "stellaratlas.history.object.verify",
	"replay_policy": "instant",
	"max_waiting": 512,
	"max_ack_pending": 120,
	"num_replicas": 0
}
```

The preserved stream uses WorkQueue retention, file storage, discard-new,
max_msgs 240, max_bytes 67108864, no max_age, and one replica. NATS WorkQueue
messages are removed by acknowledgment or stream limits, not by consumer
removal. See
[official retention documentation](https://docs.nats.io/nats-concepts/jetstream/streams).

Workers retry a failed pull through their existing loop. Their terminal database
writes require the exact ready-row dispatch token and claim attempt, preventing
replayed deliveries from applying stale evidence twice.

## Verified progress and remaining frontier defect

The recreated consumer acknowledged 114 deliveries by 05:16:09Z. By 05:21:00Z it
had delivered 6,101 jobs and had 76 in flight with current publications. A
single short sample from response timestamps 05:21:32.753Z to 05:21:55.384Z
showed durable source attestations increase 11,440,320 to 11,440,501 (+181).
These are source attestations, not 181 unique canonical checkpoint positions.

Canonical proof position remained 64,322,943. Its cursor was 64,323,007, but
that exact next checkpoint had no queued category objects and no proof-refresh
request. Dispatcher frontier materialization ran only after an empty
reservation; unrelated root backlog kept reservations nonempty. The fix calls
existing bounded `ensurePrefetch` in the existing 15-second recovery pass,
before missing-ready repair. It preserves oldest-first planner predicates and
the existing 2-second statement/250-ms lock maintenance guard; there is no new
polling loop.

## Additional performance evidence, not an untested rewrite

The first cold post-recovery reservation waited over 95 seconds on DataFileRead.
Its EXPLAIN (without ANALYZE) showed approximately 29,350 ready rows joined by
random object UUID before final batch LIMIT 120 and host admission. It later
completed and sustained useful dispatch. The ready table lacks checkpoint/order/
host/retry metadata, so pre-limiting arbitrary UUID rows would change fairness
and oldest-first ordering. No such pre-limit or new index was deployed.

A safe follow-up needs either an exact indexed candidate strategy or a compact
admission projection retaining those ordering fields, differential fairness
tests, and bounded migration cost. Repeatedly timing out the cold scan at a
short new deadline would not fix this I/O pattern.

## Prevention added in source

Broker occupancy reads confirm an apparent future consumer sequence with a fresh
stream read, avoiding a concurrent-publication false alarm. A persistent
mismatch reports an explicit error immediately and at most once per minute;
recovery is also logged. The healthy path retains its existing two parallel
metadata calls. This safeguard does not automatically delete consumers or ignore
backpressure.
