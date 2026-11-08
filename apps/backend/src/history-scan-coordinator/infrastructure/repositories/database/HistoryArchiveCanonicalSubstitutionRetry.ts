import type { EntityManager } from 'typeorm';
import { historyArchiveHostScanAllowedSql } from '../../../domain/history-archive-object/HistoryArchiveScanPolicy.js';
import { getCanonicalFallbackRoot } from './HistoryArchiveCanonicalFallbackAnchorSql.js';
import { historyArchiveInconclusiveTransportFailureSql } from './HistoryArchiveFailureAttributionSql.js';
import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

const pageSize = 8;
const scanIntervalMs = 2_000;

/**
 * Revisit only preserved canonical failures that were substituted by a
 * successful same-network archive, and only after the canonical archive has
 * proved its currently advertised head. The in-memory keyset is rebuildable;
 * the substitution and failed queue rows remain the durable source of truth.
 */
export const admitCanonicalSubstitutionRetrySql = `
with canonical as materialized (
	select state."networkPassphrase" as network_passphrase,
		state."currentLedger" as current_ledger,
		cursor."nextHistoricalCheckpointLedger" as next_historical,
		((state."currentLedger"::bigint + 1) / 64 * 64 - 1)::integer as head_ledger
	from "history_archive_state_snapshot" state
	join "history_archive_checkpoint_scan_cursor" cursor
		on cursor."archiveUrlIdentity" = state."archiveUrlIdentity"
	where state."archiveUrlIdentity" = $1::text
		and state.status = 'available'
		and state."networkPassphrase" is not null
		and cursor."nextHistoricalCheckpointLedger" > state."currentLedger"
), trusted_head as materialized (
	select canonical.*
	from canonical
	where exists (
		select 1 from "history_archive_checkpoint_proof" proof
		where proof."archiveUrlIdentity" = $1::text
			and proof."checkpointLedger" = canonical.head_ledger
			and proof.status = 'verified'
			and proof."requiredObjectsComplete" = true
			and proof."proofFactsComplete" = true
			and proof."failureKind" is null
			and coalesce(proof."failedBucketCount", 0) = 0
		)
		or exists (
			select 1
			from "history_archive_checkpoint_substitution" substitution
			join "history_archive_checkpoint_proof" source_proof
				on source_proof.id = substitution."sourceCheckpointProofId"
			join "history_archive_state_snapshot" source_state
				on source_state."archiveUrlIdentity" = substitution."sourceArchiveUrlIdentity"
			where substitution."archiveUrlIdentity" = $1::text
				and substitution."checkpointLedger" = canonical.head_ledger
				and source_state.status = 'available'
				and source_state."networkPassphrase" = canonical.network_passphrase
				and source_proof."archiveUrlIdentity" = substitution."sourceArchiveUrlIdentity"
				and source_proof."checkpointLedger" = canonical.head_ledger
				and source_proof.status = 'verified'
				and source_proof."requiredObjectsComplete" = true
				and source_proof."proofFactsComplete" = true
				and source_proof."failureKind" is null
				and coalesce(source_proof."failedBucketCount", 0) = 0
		)
), substitution_page as materialized (
	select substitution."checkpointLedger", substitution."failedCheckpointProofId",
		substitution."sourceArchiveUrlIdentity", substitution."sourceCheckpointProofId"
	from trusted_head
	join "history_archive_checkpoint_substitution" substitution
		on substitution."archiveUrlIdentity" = $1::text
	where substitution.reason = 'remote-source-failure'
		and substitution."checkpointLedger" > $2::integer
	order by substitution."checkpointLedger"
	limit ${pageSize}

), required_object_keys as materialized (
	select substitution."checkpointLedger" as checkpoint_ledger,
		keys.object_type, keys.object_key, keys.object_order
	from substitution_page substitution
	cross join lateral (values
		('checkpoint-state'::text, 'checkpoint-state:' || lpad(to_hex(substitution."checkpointLedger"), 8, '0'), 10),
		('ledger'::text, 'ledger:' || lpad(to_hex(substitution."checkpointLedger"), 8, '0'), 20),
		('transactions'::text, 'transactions:' || lpad(to_hex(substitution."checkpointLedger"), 8, '0'), 30),
		('results'::text, 'results:' || lpad(to_hex(substitution."checkpointLedger"), 8, '0'), 40)
	) keys(object_type, object_key, object_order)
	union all
	select substitution."checkpointLedger", 'bucket'::text,
		'bucket:' || dependency."bucketHash", 60
	from substitution_page substitution
	cross join lateral (
		${historyArchiveCheckpointBucketDependenciesSql(
			'$1::text',
			'substitution."checkpointLedger"'
		)}
	) dependency
	where dependency."archiveUrlIdentity" = $1::text
		and dependency."checkpointLedger" = substitution."checkpointLedger"
), last_scanned as (
	select max("checkpointLedger")::integer as checkpoint_ledger
	from substitution_page
), eligible as materialized (
	select object."remoteId", object."archiveUrlIdentity", object."hostIdentity",
		object."checkpointLedger", object."objectOrder", object."objectKey",
		ready."dispatchToken" as ready_dispatch_token
	from trusted_head
	join substitution_page substitution on true
	join "history_archive_checkpoint_proof" failed_proof
		on failed_proof.id = substitution."failedCheckpointProofId"
		and failed_proof."archiveUrlIdentity" = $1::text
		and failed_proof."checkpointLedger" = substitution."checkpointLedger"
		and (
			(failed_proof.status = 'not-evaluable'
				and failed_proof."failureKind" in ('object-failed', 'bucket-missing'))
			or failed_proof.status = 'pending'
		)
	join "history_archive_checkpoint_proof" source_proof
		on source_proof.id = substitution."sourceCheckpointProofId"
		and source_proof."archiveUrlIdentity" = substitution."sourceArchiveUrlIdentity"
		and source_proof."checkpointLedger" = substitution."checkpointLedger"
		and source_proof.status = 'verified'
		and source_proof."requiredObjectsComplete" = true
		and source_proof."proofFactsComplete" = true
		and source_proof."failureKind" is null
		and coalesce(source_proof."failedBucketCount", 0) = 0
	join "history_archive_state_snapshot" source_state
		on source_state."archiveUrlIdentity" = substitution."sourceArchiveUrlIdentity"
		and source_state.status = 'available'
		and source_state."networkPassphrase" = trusted_head.network_passphrase
	join required_object_keys required
		on required.checkpoint_ledger = substitution."checkpointLedger"
	join "history_archive_object_queue" object
		on object."archiveUrlIdentity" = $1::text
		and object."objectType" = required.object_type
		and object."objectKey" = required.object_key
	left join "history_archive_object_ready" ready
		on ready."objectRemoteId" = object."remoteId"
	where object.status = 'failed'
		and object."executionDisposition" = 'executable'
		and object."dependencyReady" = true
		and (object."transitionEffectsRequiredAt" is null
			or object."transitionEffectsCompletedAt" is not null)
		and (coalesce(object."httpStatus" between 500 and 599, false)
			or ${historyArchiveInconclusiveTransportFailureSql('object')})
		and (object."lastClaimedAt" is null
			or object."lastClaimedAt" < now() - interval '24 hours')
		and coalesce(object."nextAttemptAt", object."updatedAt" + interval '1 hour') <= now()
		and ${historyArchiveHostScanAllowedSql('object')}
		and (ready."objectRemoteId" is null or (
			ready."publishedAt" is null and ready."claimAttempt" is null
		))
	order by substitution."checkpointLedger", object."objectOrder", object."objectKey"
	limit 1
	for update of object skip locked
), scheduled as (
	update "history_archive_object_queue" object
	set "nextAttemptAt" = now(), "updatedAt" = now()
	from eligible
	where object."remoteId" = eligible."remoteId"
		and eligible.ready_dispatch_token is null
	returning object."remoteId", object."archiveUrlIdentity"
), admitted as (
	insert into "history_archive_object_ready" (
		"objectRemoteId", "archiveUrlIdentity", priority, "availableAt",
		"dispatchToken", "recheckRequestedAt", "createdAt", "updatedAt"
	)
	select scheduled."remoteId", scheduled."archiveUrlIdentity", 1, now(),
		gen_random_uuid(), now(), now(), now()
	from scheduled
	where not exists (
		select 1 from "history_archive_object_ready" ready
		where ready."objectRemoteId" = scheduled."remoteId"
	)
	on conflict ("objectRemoteId") do nothing
	returning "objectRemoteId"
), promoted as (
	update "history_archive_object_ready" ready
	set priority = 1, "availableAt" = now(),
		"dispatchToken" = coalesce(ready."dispatchToken", gen_random_uuid()),
		"recheckRequestedAt" = now(), "updatedAt" = now()
	from scheduled
	where ready."objectRemoteId" = scheduled."remoteId"
		and ready."publishedAt" is null and ready."claimAttempt" is null
		and ready."dispatchToken" is null
	returning ready."objectRemoteId"
)
select ((select count(*) from admitted) + (select count(*) from promoted))::integer as admitted,
	(select checkpoint_ledger from last_scanned) as "lastScannedLedger",
	(select count(*)::integer from eligible) as "retryAvailable"
`;

export class HistoryArchiveCanonicalSubstitutionRetry {
	private readonly cursors = new Map<string, number>();
	private readonly nextRunAt = new Map<string, number>();

	async admitOne(manager: EntityManager): Promise<number> {
		const canonicalRoot = getCanonicalFallbackRoot();
		if (canonicalRoot === null) return 0;
		const now = Date.now();
		if ((this.nextRunAt.get(canonicalRoot) ?? 0) > now) return 0;
		this.nextRunAt.set(canonicalRoot, now + scanIntervalMs);
		const afterLedger = this.cursors.get(canonicalRoot) ?? 0;
		const [result] = (await manager.query(admitCanonicalSubstitutionRetrySql, [
			canonicalRoot,
			afterLedger
		])) as readonly {
			admitted: number;
			lastScannedLedger: number | null;
			retryAvailable: number;
		}[];
		if ((result?.retryAvailable ?? 0) > 0) {
			// Keep the keyset before an eligible row until reservation publishes it;
			// a temporary host cap must not strand its tokenized ready item.
		} else if (
			result?.lastScannedLedger === null ||
			result?.lastScannedLedger === undefined
		)
			this.cursors.set(canonicalRoot, 0);
		else this.cursors.set(canonicalRoot, result.lastScannedLedger);
		return Math.max(result?.admitted ?? 0, result?.retryAvailable ?? 0);
	}
}

export interface IdleCapacityRetryCallbacks<T> {
	readonly currentJobs: readonly T[];
	readonly capacity: number;
	readonly admitOne: () => Promise<number>;
	readonly reserveOne: () => Promise<readonly T[]>;
}

/** Called only after normal first-pass reservation and frontier work are empty. */
export async function reserveCanonicalRetryWhenIdle<T>(
	callbacks: IdleCapacityRetryCallbacks<T>
): Promise<readonly T[]> {
	if (callbacks.currentJobs.length > 0 || callbacks.capacity < 1)
		return callbacks.currentJobs;
	if ((await callbacks.admitOne()) < 1) return callbacks.currentJobs;
	return await callbacks.reserveOne();
}
